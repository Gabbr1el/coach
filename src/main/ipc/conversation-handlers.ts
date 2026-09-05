import { ipcMain } from 'electron'
import type { HomePlannerService } from '../../application/conversations/home-planner-service'
import { sendHomeMessageInputSchema } from '../../shared/contracts/conversation-contract'
import { CONVERSATION_CHANNELS } from '../../shared/contracts/conversation-channels'
import { assertTrustedSender } from './trusted-sender'

export function registerConversationHandlers(service: HomePlannerService): void {
  ipcMain.handle(CONVERSATION_CHANNELS.listHomeMessages, (event) => {
    assertTrustedSender(event)
    return service.listMessages()
  })

  ipcMain.handle(CONVERSATION_CHANNELS.sendHomeMessage, (event, payload: unknown) => {
    assertTrustedSender(event)
    return service.sendMessage(sendHomeMessageInputSchema.parse(payload))
  })
}
