import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface SessionTokens {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
}

export interface StoredSession extends SessionTokens {
  readonly generation: number
  readonly userId: string
  readonly email: string | null
}

export interface PendingAuthFlow { readonly kind: 'recovery' | 'verification'; readonly state: string; readonly verifier: string; readonly expiresAt: number; readonly code?: string; readonly temporarySession?: SessionTokens }
export interface RefreshIntent { readonly requestId: string; readonly generation: number; readonly userId: string; readonly recoverySecret: string; readonly capability?: string; readonly expiresAt: number }

export interface SecretCodec {
  isAvailable(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

export type VaultFailurePoint = 'after-slot-write' | 'after-journal-write' | 'after-old-slot-delete'

export class RotatingSessionVault {
  constructor(
    private readonly directory: string,
    private readonly codec: SecretCodec,
    private readonly onFailurePoint?: (point: VaultFailurePoint) => void,
  ) {}

  isAvailable(): boolean { return this.codec.isAvailable() }

  async read(): Promise<StoredSession | null> {
    this.assertAvailable()
    const candidates = await Promise.all(['a', 'b'].map((slot) => this.readSlot(slot)))
    return candidates.filter((item): item is StoredSession => item !== null).sort((left, right) => right.generation - left.generation)[0] ?? null
  }

  async rotate(input: Omit<StoredSession, 'generation'>): Promise<void> {
    this.assertAvailable()
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const current = await this.read()
    const generation = (current?.generation ?? 0) + 1
    const slot = generation % 2 === 0 ? 'a' : 'b'
    const oldSlot = slot === 'a' ? 'b' : 'a'
    await this.atomicWrite(this.slotPath(slot), this.codec.encrypt(JSON.stringify({ ...input, generation })))
    this.onFailurePoint?.('after-slot-write')
    await this.atomicWrite(this.journalPath(), Buffer.from(JSON.stringify({ generation, slot }), 'utf8'))
    this.onFailurePoint?.('after-journal-write')
    await rm(this.slotPath(oldSlot), { force: true })
    this.onFailurePoint?.('after-old-slot-delete')
  }

  async clear(): Promise<void> {
    await Promise.all(['a', 'b'].map((slot) => rm(this.slotPath(slot), { force: true })))
    await rm(this.journalPath(), { force: true })
    let files: string[] = []; try { files = await readdir(this.directory) } catch {}
    await Promise.all(files.filter((file) => file.startsWith('flow-')).map((file) => rm(join(this.directory, file), { force: true })))
  }

  async writeRefreshIntent(intent: RefreshIntent): Promise<void> { this.assertAvailable(); await this.atomicWrite(this.refreshIntentPath(), this.codec.encrypt(JSON.stringify(intent))) }
  async readRefreshIntent(): Promise<RefreshIntent | null> { const value = await this.readEncrypted<RefreshIntent>(this.refreshIntentPath(), (item) => typeof item.requestId === 'string' && Number.isSafeInteger(item.generation) && typeof item.userId === 'string' && typeof item.recoverySecret === 'string' && typeof item.expiresAt === 'number'); return value && value.expiresAt > Date.now() ? value : null }
  async clearRefreshIntent(): Promise<void> { await rm(this.refreshIntentPath(), { force: true }) }
  async putAuthFlow(flow: PendingAuthFlow): Promise<void> { this.assertAvailable(); await this.atomicWrite(this.flowPath(flow.state), this.codec.encrypt(JSON.stringify(flow))) }
  async completeAuthFlow(state: string, code: string): Promise<void> { const flow = await this.readAuthFlow(state); if (!flow || flow.expiresAt < Date.now() || flow.code) throw new Error('invalid_or_expired_recovery_state'); await this.putAuthFlow({ ...flow, code }) }
  async persistTemporarySession(state: string, session: SessionTokens): Promise<void> { const flow=await this.readAuthFlow(state); if(!flow || flow.expiresAt<Date.now() || flow.kind!=='recovery') throw new Error('invalid_or_expired_recovery_state'); await this.putAuthFlow({...flow,temporarySession:session}) }
  async takeAuthFlow(state: string): Promise<PendingAuthFlow | null> {
    if (!/^[0-9a-f-]{36}$/i.test(state)) return null
    const path = this.flowPath(state)
    const flow = await this.readEncrypted<PendingAuthFlow>(path, (value) => (value.kind === 'recovery' || value.kind === 'verification') && value.state === state && typeof value.verifier === 'string' && typeof value.expiresAt === 'number')
    await rm(path, { force: true })
    return flow && flow.expiresAt >= Date.now() ? flow : null
  }
  async peekAuthFlow(state: string): Promise<PendingAuthFlow | null> { const flow = await this.readAuthFlow(state); return flow && flow.expiresAt >= Date.now() ? flow : null }
  async consumeAuthFlow(state: string): Promise<void> { if (/^[0-9a-f-]{36}$/i.test(state)) await rm(this.flowPath(state), { force: true }) }
  private async readAuthFlow(state: string): Promise<PendingAuthFlow | null> { if (!/^[0-9a-f-]{36}$/i.test(state)) return null; return this.readEncrypted<PendingAuthFlow>(this.flowPath(state), (value) => (value.kind === 'recovery' || value.kind === 'verification') && value.state === state && typeof value.verifier === 'string' && typeof value.expiresAt === 'number') }

  private async readSlot(slot: string): Promise<StoredSession | null> {
    try {
      const parsed = JSON.parse(this.codec.decrypt(await readFile(this.slotPath(slot)))) as Partial<StoredSession>
      if (!Number.isSafeInteger(parsed.generation) || typeof parsed.userId !== 'string' || typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string' || typeof parsed.expiresAt !== 'number') return null
      return parsed as StoredSession
    } catch { return null }
  }

  private async atomicWrite(path: string, value: Buffer): Promise<void> {
    const temporary = `${path}.${process.pid}.tmp`
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const file = await open(temporary, 'w', 0o600)
    try { await file.writeFile(value); await file.sync() } finally { await file.close() }
    await rename(temporary, path)
    const directory = await open(dirname(path), 'r')
    try { await directory.sync() } finally { await directory.close() }
  }

  private slotPath(slot: string): string { return join(this.directory, `session-${slot}.bin`) }
  private journalPath(): string { return join(this.directory, 'session-journal.json') }
  private refreshIntentPath(): string { return join(this.directory, 'refresh-intent.bin') }
  private flowPath(state: string): string { return join(this.directory, `flow-${state}.bin`) }
  private async readEncrypted<T extends object>(path: string, valid: (value: Partial<T>) => boolean): Promise<T | null> { try { const value = JSON.parse(this.codec.decrypt(await readFile(path))) as Partial<T>; return valid(value) ? value as T : null } catch { return null } }
  private assertAvailable(): void { if (!this.isAvailable()) throw new Error('secure_session_storage_unavailable') }
}
