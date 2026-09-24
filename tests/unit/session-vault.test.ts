import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RotatingSessionVault, type VaultFailurePoint } from '../../src/main/account/session-vault'

const directories: string[] = []
const codec = {
  isAvailable: () => true,
  encrypt: (value: string) => Buffer.from(Buffer.from(value, 'utf8').map((byte) => byte ^ 0xa5)),
  decrypt: (value: Buffer) => Buffer.from(Buffer.from(value).map((byte) => byte ^ 0xa5)).toString('utf8'),
}
const tokens = (suffix: string) => ({ userId: 'user-a', email: 'safe@example.test', accessToken: `access-${suffix}`, refreshToken: `refresh-${suffix}`, expiresAt: 10_000 })

afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('RotatingSessionVault', () => {
  for (const point of ['after-slot-write', 'after-journal-write', 'after-old-slot-delete'] as VaultFailurePoint[]) {
    it(`recovers a usable generation after ${point}`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'coach-vault-')); directories.push(directory)
      await new RotatingSessionVault(directory, codec).rotate(tokens('old'))
      const crashing = new RotatingSessionVault(directory, codec, (current) => { if (current === point) throw new Error('simulated_crash') })
      await expect(crashing.rotate(tokens('new'))).rejects.toThrow('simulated_crash')
      const recovered = await new RotatingSessionVault(directory, codec).read()
      expect(['refresh-old', 'refresh-new']).toContain(recovered?.refreshToken)
      expect(recovered?.accessToken).toBe(recovered?.refreshToken.replace('refresh', 'access'))
    })
  }

  it('does not write plaintext tokens', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'coach-vault-')); directories.push(directory)
    await new RotatingSessionVault(directory, codec).rotate(tokens('secret'))
    const slot = await readFile(join(directory, 'session-b.bin'), 'utf8')
    expect(slot).not.toContain('refresh-secret')
    expect(slot).not.toContain('access-secret')
  })

  it('persists and consumes recovery state exactly once across instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'coach-vault-')); directories.push(directory)
    const first = new RotatingSessionVault(directory, codec)
    const state = '00000000-0000-4000-8000-000000000001'
    await first.putAuthFlow({ kind: 'recovery', state, verifier: 'verifier', expiresAt: Date.now() + 60_000 })
    await new RotatingSessionVault(directory, codec).completeAuthFlow(state, 'code')
    expect(await new RotatingSessionVault(directory, codec).takeAuthFlow(state)).toMatchObject({ verifier: 'verifier', code: 'code' })
    expect(await new RotatingSessionVault(directory, codec).takeAuthFlow(state)).toBeNull()
  })

  it('persists a refresh request id until rotation is committed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'coach-vault-')); directories.push(directory)
    const vault = new RotatingSessionVault(directory, codec)
    const intent = { requestId: '00000000-0000-4000-8000-000000000002', generation: 3, userId: 'user-a', recoverySecret: 'recovery-secret', capability: 'capability', expiresAt: Date.now() + 60_000 }
    await vault.writeRefreshIntent(intent)
    expect(await new RotatingSessionVault(directory, codec).readRefreshIntent()).toEqual(intent)
    await vault.clearRefreshIntent()
    expect(await vault.readRefreshIntent()).toBeNull()
  })
})
