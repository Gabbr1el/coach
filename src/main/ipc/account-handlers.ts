import { ipcMain } from 'electron'
import { ACCOUNT_CHANNELS } from '../../shared/contracts/account-channels'
import { loginInputSchema, recoverInputSchema, reconciliationInputSchema, resetInputSchema, revokeSessionInputSchema, signupInputSchema, verifyInputSchema } from '../../shared/contracts/account-contract'
import type { DesktopSessionService } from '../account/session-service'
import { assertTrustedSender } from './trusted-sender'

export function registerAccountHandlers(service: DesktopSessionService): void {
  const handle = <T>(channel: string, schema: { parse(input: unknown): T } | null, action: (input: T) => unknown) => ipcMain.handle(channel, (event, input) => { assertTrustedSender(event); return action(schema ? schema.parse(input) : undefined as T) })
  handle(ACCOUNT_CHANNELS.status, null, () => service.status())
  handle(ACCOUNT_CHANNELS.signup, signupInputSchema, (input) => service.signup(input.email, input.password))
  handle(ACCOUNT_CHANNELS.verify, verifyInputSchema, (input) => service.verify(input.tokenHash))
  handle(ACCOUNT_CHANNELS.login, loginInputSchema, (input) => service.login(input.email, input.password))
  handle(ACCOUNT_CHANNELS.recover, recoverInputSchema, (input) => service.recover(input.email))
  handle(ACCOUNT_CHANNELS.reset, resetInputSchema, (input) => service.reset(input.state, input.code, input.password))
  handle(ACCOUNT_CHANNELS.logout, null, () => service.logout())
  handle(ACCOUNT_CHANNELS.listSessions, null, () => service.listSessions())
  handle(ACCOUNT_CHANNELS.revokeSession, revokeSessionInputSchema, (input) => service.revokeSession(input.sessionId))
  handle(ACCOUNT_CHANNELS.revokeOtherSessions, null, () => service.revokeOtherSessions())
  handle(ACCOUNT_CHANNELS.syncStatus, null, () => service.syncStatus())
  handle(ACCOUNT_CHANNELS.syncNow, null, () => service.syncNow())
  handle(ACCOUNT_CHANNELS.listReconciliation, null, () => service.listReconciliation())
  handle(ACCOUNT_CHANNELS.resolveReconciliation, reconciliationInputSchema, (input) => service.resolveReconciliation(input.mutationId))
  handle(ACCOUNT_CHANNELS.discardReconciliation, reconciliationInputSchema, (input) => service.discardReconciliation(input.mutationId))
}
