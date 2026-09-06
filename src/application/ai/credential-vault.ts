export interface CredentialVault {
  isAvailable(): boolean
  set(reference: string, secret: string): Promise<void>
  get(reference: string): Promise<string | null>
  delete(reference: string): Promise<void>
  removeOrphans(validReferences: ReadonlySet<string>): Promise<void>
}
