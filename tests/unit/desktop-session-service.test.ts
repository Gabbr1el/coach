import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountDatabaseManager } from '../../src/main/account/account-cache'
import { DesktopSessionService } from '../../src/main/account/session-service'
import { RotatingSessionVault } from '../../src/main/account/session-vault'
import type { CoachDesktopCloudClient } from '../../packages/backend/src/client/desktop-client'

const directories: string[] = []
const codec = { isAvailable: () => true, encrypt: (value: string) => Buffer.from(value), decrypt: (value: Buffer) => value.toString() }
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
const jwt = (sub: string, expires = Date.now() + 60_000) => ({ accessToken: `x.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.x`, refreshToken: `refresh-${sub}`, expiresAt: expires })

async function fixture(cloud: object) { const root = await mkdtemp(join(tmpdir(), 'coach-session-')); directories.push(root); const vault = new RotatingSessionVault(join(root, 'vault'), codec); const databases = new AccountDatabaseManager(join(root, 'accounts')); const service = new DesktopSessionService(vault, databases, cloud as CoachDesktopCloudClient, join(root, 'device'), 'test', 'linux', '1'); await service.initialize(); return { service, vault, databases } }

describe('DesktopSessionService', () => {
  it('serializes concurrent refresh and reuses one request id after a persistence crash', async () => {
    const requestIds: string[] = []
    const cloud = { login: async () => jwt('user-a', 0), api: async () => undefined, reserveRefresh: async (_access:string,requestId:string)=>{requestIds.push(requestId);return{capability:'cap',expiresAt:new Date(Date.now()+150_000).toISOString()}}, executeRefresh: async () => jwt('user-a') }
    const { service } = await fixture(cloud)
    await service.login('a@example.test', 'password1')
    await Promise.all([service.listSessions().catch(() => []), service.listSessions().catch(() => [])])
    expect(new Set(requestIds).size).toBe(1)
    await service.shutdown()
  })

  it('stops the old account before opening the new cache', async () => {
    const events: string[] = []
    const cloud = { login: async (email: string) => jwt(email.startsWith('a') ? 'user-a' : 'user-b'), api: async (path: string) => { if (path === '/v1/account/provision') events.push('provision'); return undefined } }
    const { service, databases } = await fixture(cloud)
    await service.login('a@example.test', 'password1'); const first = databases.current()!.path
    await service.login('b@example.test', 'password1'); const second = databases.current()!.path
    expect(first).not.toBe(second); expect(service.status()).toMatchObject({ state: 'signed_in', profile: { id: 'user-b' } }); expect(events).toHaveLength(2)
    await service.shutdown()
  })

  it('does not let a late refresh for A overwrite adopted account B', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const cloud = { login: async (email: string) => jwt(email.startsWith('a') ? 'user-a' : 'user-b', email.startsWith('a') ? 0 : Date.now() + 60_000), api: async (path: string) => path === '/v1/account/sessions' ? { sessions: [] } : undefined, reserveRefresh:async()=>({capability:'cap',expiresAt:new Date(Date.now()+150_000).toISOString()}), executeRefresh: async () => { await blocked; return jwt('user-a') } }
    const { service, vault } = await fixture(cloud)
    await service.login('a@example.test', 'password1')
    const refresh = service.listSessions()
    const switchAccount = service.login('b@example.test', 'password1')
    release(); await Promise.allSettled([refresh, switchAccount])
    expect((await vault.read())?.userId).toBe('user-b')
    expect(service.status()).toMatchObject({ profile: { id: 'user-b' } })
    await service.shutdown()
  })

  it('accepts a persisted recovery deep link once after restart', async () => {
    const cloud = { recover: async () => undefined, exchangeRecovery: async () => jwt('user-a'), updatePassword: async () => undefined }
    const { service } = await fixture(cloud)
    const { state } = await service.recover('a@example.test')
    await service.handleDeepLink(`coach://auth/recovery?state=${state}&code=recovery-code`)
    await service.reset(state, 'recovery-code', 'password1')
    await expect(service.reset(state, 'recovery-code', 'password1')).rejects.toThrow('invalid_or_expired_recovery_state')
  })

  it('keeps recovery state after a transient reset failure and emits the accepted URL', async () => {
    let redirect = ''; let attempts = 0
    const cloud = { recover: async (_email: string, state: string) => { redirect = `coach://auth/recovery?state=${state}` }, exchangeRecovery: async () => jwt('user-a'), updatePassword: async () => { if (attempts++ === 0) throw new TypeError('network') } }
    const { service } = await fixture(cloud)
    const { state } = await service.recover('a@example.test')
    expect(redirect).toBe(`coach://auth/recovery?state=${state}`)
    await service.handleDeepLink(`${redirect}&code=recovery-code`)
    await expect(service.reset(state, 'recovery-code', 'password1')).rejects.toThrow('network')
    await expect(service.reset(state, 'recovery-code', 'password1')).resolves.toBeUndefined()
  })

  it('restarts password update from a persisted temporary session without reusing the code', async () => {
    let exchanges = 0; let updates = 0
    const cloud = { recover: async () => undefined, exchangeRecovery: async () => { exchanges += 1; return jwt('user-a') }, updatePassword: async () => { updates += 1; if (updates === 1) throw new TypeError('crash after exchange') } }
    const root = await mkdtemp(join(tmpdir(), 'coach-session-')); directories.push(root)
    const vault = new RotatingSessionVault(join(root, 'vault'), codec)
    const first = new DesktopSessionService(vault, new AccountDatabaseManager(join(root, 'accounts-a')), cloud as unknown as CoachDesktopCloudClient, join(root, 'device'), 'test', 'linux', '1')
    await first.initialize(); const { state } = await first.recover('a@example.test'); await first.handleDeepLink(`coach://auth/recovery?state=${state}&code=one-use`)
    await expect(first.reset(state, 'one-use', 'password1')).rejects.toThrow('crash after exchange')
    const second = new DesktopSessionService(new RotatingSessionVault(join(root, 'vault'), codec), new AccountDatabaseManager(join(root, 'accounts-b')), cloud as unknown as CoachDesktopCloudClient, join(root, 'device'), 'test', 'linux', '1')
    await second.initialize(); await expect(second.reset(state, 'one-use', 'password1')).resolves.toBeUndefined()
    expect(exchanges).toBe(1); expect(updates).toBe(2)
  })
})
