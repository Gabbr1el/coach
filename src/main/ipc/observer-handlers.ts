import { ipcMain } from 'electron'
import type { ObserverService } from '../../application/observer/observer-service'
import { OBSERVER_CHANNELS } from '../../shared/contracts/observer-channels'
import { recordFocusInputSchema } from '../../shared/contracts/observer-contract'
import { workspaceConversationInputSchema } from '../../shared/contracts/conversation-contract'
import { assertTrustedSender } from './trusted-sender'

export function registerObserverHandlers(service: ObserverService): void {
  ipcMain.handle(OBSERVER_CHANNELS.getState, (event, payload) => { assertTrustedSender(event); return service.getState(workspaceConversationInputSchema.parse(payload).workspaceId) })
  ipcMain.handle(OBSERVER_CHANNELS.recordFocus, (event, payload) => { assertTrustedSender(event); const input = recordFocusInputSchema.parse(payload); return service.recordFocus(input.workspaceId, input.focused) })
}
