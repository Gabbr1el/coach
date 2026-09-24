import { z } from 'zod'

export const emailSchema = z.string().trim().email().max(320)
const passwordSchema = z.string().min(8).max(256)
export const signupInputSchema = z.object({ email: emailSchema, password: passwordSchema }).strict()
export const loginInputSchema = signupInputSchema
export const verifyInputSchema = z.object({ tokenHash: z.string().min(1).max(4096) }).strict()
export const recoverInputSchema = z.object({ email: emailSchema }).strict()
export const resetInputSchema = z.object({ state: z.string().uuid(), code: z.string().min(1).max(4096), password: passwordSchema }).strict()
export const revokeSessionInputSchema = z.object({ sessionId: z.string().uuid() }).strict()
export const reconciliationInputSchema = z.object({ mutationId: z.string().uuid() }).strict()

export interface AccountProfile {
  readonly id: string
  readonly email: string | null
}

export type AccountStatus =
  | { readonly state: 'signed_out'; readonly vaultAvailable: boolean }
  | { readonly state: 'verification_required'; readonly vaultAvailable: boolean }
  | { readonly state: 'signed_in'; readonly vaultAvailable: true; readonly profile: AccountProfile }
  | { readonly state: 'unavailable'; readonly vaultAvailable: false; readonly reason: string }

export type SyncState = 'signed_out' | 'idle' | 'syncing' | 'offline' | 'backoff' | 'reconciliation_required' | 'error'

export interface SyncStatus {
  readonly state: SyncState
  readonly pending: number
  readonly conflicts: number
  readonly reconciliationRequired: number
  readonly lastSyncedAt: number | null
  readonly retryAt: number | null
}

export interface ReconciliationItem {
  readonly mutationId: string
  readonly entityType: string
  readonly entityId: string
  readonly command: string
  readonly payload: Record<string, unknown> | null
  readonly reason: string
  readonly createdAt: string
}

export interface AccountSessionDevice {
  readonly id: string
  readonly deviceId: string
  readonly deviceLabel: string
  readonly platform: string
  readonly appVersion: string
  readonly lastSeenAt: string
  readonly revokedAt: string | null
}

export interface AccountApi {
  status(): Promise<AccountStatus>
  signup(input: z.input<typeof signupInputSchema>): Promise<AccountStatus>
  verify(input: z.input<typeof verifyInputSchema>): Promise<AccountStatus>
  login(input: z.input<typeof loginInputSchema>): Promise<AccountStatus>
  recover(input: z.input<typeof recoverInputSchema>): Promise<{ state: string }>
  reset(input: z.input<typeof resetInputSchema>): Promise<void>
  logout(): Promise<void>
  listSessions(): Promise<readonly AccountSessionDevice[]>
  revokeSession(input: z.input<typeof revokeSessionInputSchema>): Promise<void>
  revokeOtherSessions(): Promise<void>
  syncStatus(): Promise<SyncStatus>
  syncNow(): Promise<SyncStatus>
  listReconciliation(): Promise<readonly ReconciliationItem[]>
  resolveReconciliation(input: z.input<typeof reconciliationInputSchema>): Promise<void>
  discardReconciliation(input: z.input<typeof reconciliationInputSchema>): Promise<void>
}
