import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { CredentialVault } from '../../application/ai/credential-vault'

export class ElectronCredentialVault implements CredentialVault {
  constructor(private readonly directory = join(app.getPath('userData'), 'secrets')) {}

  isAvailable(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false
    return true
  }

  async set(reference: string, secret: string): Promise<void> {
    this.assertAvailable()
    const path = this.pathFor(reference)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await writeFile(path, safeStorage.encryptString(secret), { mode: 0o600 })
  }

  async get(reference: string): Promise<string | null> {
    this.assertAvailable()
    try {
      return safeStorage.decryptString(await readFile(this.pathFor(reference)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new Error('Stored provider credential could not be decrypted', { cause: error })
    }
  }

  async delete(reference: string): Promise<void> {
    await rm(this.pathFor(reference), { force: true })
  }

  private pathFor(reference: string): string {
    if (!/^[a-z0-9-]+$/.test(reference)) throw new Error('Invalid credential reference')
    return join(this.directory, `${reference}.bin`)
  }

  private assertAvailable(): void {
    if (!this.isAvailable()) throw new Error('Secure operating-system credential storage is unavailable')
  }
}
