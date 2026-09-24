import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { dirname } from 'node:path'
import type { AccountSessionDevice, AccountStatus } from '../../shared/contracts/account-contract'
import { AccountDatabaseManager } from './account-cache'
import type { CoachDesktopCloudClient } from '../../../packages/backend/src/client/desktop-client'
import { RotatingSessionVault, type SessionTokens } from './session-vault'
import { DesktopSyncWorker } from './sync-worker'

interface Identity { sub: string; email?: string; session_id?: string }

export class DesktopSessionService {
  private worker: DesktopSyncWorker | null = null
  private identity: Identity | null = null
  private deviceId = ''
  private refreshLock: Promise<string> | null = null
  private refreshOwner: { userId: string; generation: number } | null = null
  private lifecycle: Promise<void> = Promise.resolve()

  constructor(
    private readonly vault: RotatingSessionVault,
    private readonly databases: AccountDatabaseManager,
    private readonly cloud: CoachDesktopCloudClient,
    private readonly deviceIdPath: string,
    private readonly deviceLabel: string,
    private readonly platform: 'linux' | 'windows' | 'macos',
    private readonly appVersion: string,
  ) {}

  async initialize(): Promise<void> {
    this.deviceId = await this.loadDeviceId()
    if (!this.vault.isAvailable()) return
    const stored = await this.vault.read()
    if (!stored) return
    this.identity = { sub: stored.userId, ...(stored.email ? { email: stored.email } : {}) }
    this.databases.open(stored.userId)
    await this.startWorker(stored)
  }

  status(): AccountStatus {
    if (!this.vault.isAvailable()) return { state: 'unavailable', vaultAvailable: false, reason: 'secure_session_storage_unavailable' }
    if (!this.identity) return { state: 'signed_out', vaultAvailable: true }
    return { state: 'signed_in', vaultAvailable: true, profile: { id: this.identity.sub, email: this.identity.email ?? null } }
  }

  async signup(email: string, password: string): Promise<AccountStatus> {
    const state = crypto.randomUUID()
    await this.vault.putAuthFlow({ kind: 'verification', state, verifier: 'not-used', expiresAt: Date.now() + 24 * 60 * 60_000 })
    const result = await this.cloud.signup(email, password, state)
    if (result.status === 'verification_required') return { state: 'verification_required', vaultAvailable: this.vault.isAvailable() }
    await this.adopt(result.tokens)
    return this.status()
  }
  async verify(tokenHash: string): Promise<AccountStatus> { await this.adopt(await this.cloud.verify(tokenHash)); return this.status() }
  async login(email: string, password: string): Promise<AccountStatus> { await this.adopt(await this.cloud.login(email, password)); return this.status() }
  async recover(email: string): Promise<{ state: string }> { const state = crypto.randomUUID(); const verifier = randomBytes(32).toString('base64url'); const challenge = createHash('sha256').update(verifier).digest('base64url'); await this.vault.putAuthFlow({ kind: 'recovery', state, verifier, expiresAt: Date.now() + 10 * 60_000 }); await this.cloud.recover(email, state, challenge); return { state } }
  async reset(state: string, code: string, password: string): Promise<void> {
    let flow = await this.vault.peekAuthFlow(state)
    if (!flow || flow.kind !== 'recovery' || (flow.code && flow.code !== code)) throw new Error('invalid_or_expired_recovery_state')
    if (!flow.temporarySession) { const session = await this.cloud.exchangeRecovery(flow.code ?? code, flow.verifier); await this.vault.persistTemporarySession(state, session); flow = (await this.vault.peekAuthFlow(state))! }
    let session = flow.temporarySession!
    if (session.expiresAt <= Date.now() + 30_000) { const requestId=crypto.randomUUID(); const recoverySecret=randomBytes(32).toString('base64url'); const reservation=await this.cloud.reserveRefresh(session.accessToken,requestId,session.refreshToken,recoverySecret); session=await this.cloud.executeRefresh(requestId,session.refreshToken,reservation.capability); await this.vault.persistTemporarySession(state, session) }
    await this.cloud.updatePassword(session.accessToken, password)
    await this.vault.consumeAuthFlow(state)
    await this.logout(false)
  }
  async handleDeepLink(value: string): Promise<void> { const url = new URL(value); if (url.protocol !== 'coach:') throw new Error('invalid_auth_link'); const state = url.searchParams.get('state'); const code = url.searchParams.get('code') ?? url.searchParams.get('token_hash'); if (!state || !code) throw new Error('invalid_auth_link'); if (url.hostname === 'auth' && url.pathname === '/recovery') await this.vault.completeAuthFlow(state, code); else if (url.hostname === 'auth' && url.pathname === '/callback') { const flow = await this.vault.takeAuthFlow(state); if (!flow || flow.kind !== 'verification') throw new Error('invalid_or_expired_verification_state'); await this.verify(code) } else throw new Error('invalid_auth_link') }

  async logout(remote = true): Promise<void> {
    await this.serializeLifecycle(async () => {
      await this.awaitRefresh()
      if (remote && this.identity) { try { await this.cloud.api('/v1/account/logout', await this.accessToken(), { method: 'POST' }) } catch {} }
      await this.stopWorker(); this.databases.close(); this.identity = null
      await this.vault.clear()
    })
  }

  async listSessions(): Promise<readonly AccountSessionDevice[]> {
    const response = await this.cloud.api<{ sessions: Array<Record<string, any>> }>('/v1/account/sessions', await this.accessToken())
    return response.sessions.map((item) => ({ id: item.id, deviceId: item.device_id, deviceLabel: item.device_label, platform: item.platform, appVersion: item.app_version, lastSeenAt: item.last_seen_at, revokedAt: item.revoked_at }))
  }
  async revokeSession(sessionId: string): Promise<void> { await this.cloud.api(`/v1/account/sessions/${encodeURIComponent(sessionId)}`, await this.accessToken(), { method: 'DELETE' }) }
  async revokeOtherSessions(): Promise<void> { await this.cloud.api('/v1/account/sessions/revoke-others', await this.accessToken(), { method: 'POST' }) }
  syncStatus() { return this.worker?.getStatus() ?? { state: 'signed_out' as const, pending: 0, conflicts: 0, reconciliationRequired: 0, lastSyncedAt: null, retryAt: null } }
  async syncNow() { return this.worker?.run() ?? this.syncStatus() }
  listReconciliation() { return this.worker?.listReconciliation() ?? [] }
  resolveReconciliation(mutationId: string): void { this.worker?.resolveReconciliation(mutationId) }
  discardReconciliation(mutationId: string): void { this.worker?.discardReconciliation(mutationId) }
  async shutdown(): Promise<void> { await this.stopWorker(); this.databases.close() }

  private async adopt(tokens: SessionTokens): Promise<void> {
    const identity = decodeJwt(tokens.accessToken)
    if (!identity.sub) throw new Error('invalid_access_token_identity')
    await this.serializeLifecycle(async () => {
      await this.awaitRefresh()
      await this.stopWorker()
      this.databases.close()
      this.identity = null
      await this.cloud.api('/v1/account/provision', tokens.accessToken, { method: 'POST', body: JSON.stringify({ deviceId: this.deviceId, deviceLabel: this.deviceLabel, platform: this.platform, appVersion: this.appVersion }) })
      await this.vault.rotate({ ...tokens, userId: identity.sub, email: identity.email ?? null })
      this.databases.open(identity.sub)
      this.identity = identity
      await this.startWorker(tokens)
    })
  }

  private async accessToken(): Promise<string> {
    const stored = await this.vault.read()
    if (!stored) throw new Error('authentication_required')
    if (stored.expiresAt > Date.now() + 30_000) return stored.accessToken
    if (!this.refreshLock) { this.refreshOwner = { userId: stored.userId, generation: stored.generation }; this.refreshLock = this.refresh(stored).finally(() => { this.refreshLock = null; this.refreshOwner = null }) }
    return this.refreshLock
  }

  private async refresh(stored: Awaited<ReturnType<RotatingSessionVault['read']>> & {}): Promise<string> {
    const existing = await this.vault.readRefreshIntent()
    const isRetry = existing?.userId === stored.userId && existing.generation === stored.generation
    const requestId = isRetry ? existing.requestId : crypto.randomUUID()
    let capability = existing?.capability
    if (!isRetry) {
      const recoverySecret = randomBytes(32).toString('base64url')
      await this.vault.writeRefreshIntent({ requestId, generation: stored.generation, userId: stored.userId, recoverySecret, expiresAt: Date.now() + 150_000 })
      const reservation = await this.cloud.reserveRefresh(stored.accessToken, requestId, stored.refreshToken, recoverySecret)
      capability = reservation.capability
      const intent = { requestId, generation: stored.generation, userId: stored.userId, recoverySecret, capability, expiresAt: Math.min(Date.parse(reservation.expiresAt), Date.now() + 150_000) }
      await this.vault.writeRefreshIntent(intent)
    } else if (!capability) {
      const reservation = await this.cloud.recoverReservation(requestId, stored.refreshToken, existing.recoverySecret)
      capability = reservation.capability
      await this.vault.writeRefreshIntent({ ...existing, capability, expiresAt: Math.min(Date.parse(reservation.expiresAt), existing.expiresAt) })
    }
    if (!capability) throw new Error('refresh_capability_missing')
    const rotated = await this.cloud.executeRefresh(requestId, stored.refreshToken, capability)
    const current = await this.vault.read()
    if (!current || current.userId !== stored.userId || current.generation !== stored.generation || this.refreshOwner?.userId !== stored.userId || this.refreshOwner.generation !== stored.generation) throw new Error('account_session_changed')
    await this.vault.rotate({ ...rotated, userId: stored.userId, email: stored.email })
    await this.vault.clearRefreshIntent()
    return rotated.accessToken
  }

  private async startWorker(tokens: SessionTokens): Promise<void> {
    const cache = this.databases.current()
    if (!cache) return
    let bound = { ...tokens }
    const token = async () => { if (bound.expiresAt > Date.now() + 30_000) return bound.accessToken; const stored = await this.vault.read(); if (!stored || decodeJwt(bound.accessToken).sub !== stored.userId) throw new Error('account_session_changed'); await this.accessToken(); const updated = await this.vault.read(); if (!updated || updated.userId !== stored.userId) throw new Error('account_session_changed'); bound = updated; return updated.accessToken }
    this.worker = new DesktopSyncWorker(cache, this.cloud, this.deviceId, token)
    this.worker.start()
  }

  private async stopWorker(): Promise<void> { const worker = this.worker; this.worker = null; await worker?.stop() }
  private async awaitRefresh(): Promise<void> { try { await this.refreshLock } catch {} }
  private async serializeLifecycle(operation: () => Promise<void>): Promise<void> { const previous = this.lifecycle; let release!: () => void; this.lifecycle = new Promise<void>((resolve) => { release = resolve }); await previous; try { await operation() } finally { release() } }

  private async loadDeviceId(): Promise<string> {
    try { const value = (await readFile(this.deviceIdPath, 'utf8')).trim(); if (/^[0-9a-f-]{36}$/i.test(value)) return value } catch {}
    const value = crypto.randomUUID()
    await mkdir(dirname(this.deviceIdPath), { recursive: true, mode: 0o700 })
    await writeFile(this.deviceIdPath, value, { mode: 0o600 })
    return value
  }
}

function decodeJwt(token: string): Identity {
  const payload = token.split('.')[1]
  if (!payload) throw new Error('invalid_access_token')
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
  if (typeof parsed.sub !== 'string') throw new Error('invalid_access_token_identity')
  return { sub: parsed.sub, ...(typeof parsed.email === 'string' ? { email: parsed.email } : {}), ...(typeof parsed.session_id === 'string' ? { session_id: parsed.session_id } : {}) }
}
