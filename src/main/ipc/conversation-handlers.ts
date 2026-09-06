import { ipcMain } from 'electron'
import type { HomePlannerService } from '../../application/conversations/home-planner-service'
import { cancelHomeStreamInputSchema, sendHomeMessageInputSchema, streamHomeMessageInputSchema, type HomeStreamEvent } from '../../shared/contracts/conversation-contract'
import { CONVERSATION_CHANNELS } from '../../shared/contracts/conversation-channels'
import { assertTrustedSender } from './trusted-sender'

export function registerConversationHandlers(service: HomePlannerService): void {
  const activeStreams = new Map<string, { controller: AbortController; senderId: number }>()
  let homeStreamActive = false
  ipcMain.handle(CONVERSATION_CHANNELS.listHomeMessages, (event) => {
    assertTrustedSender(event)
    return service.listMessages()
  })

  ipcMain.handle(CONVERSATION_CHANNELS.sendHomeMessage, (event, payload: unknown) => {
    assertTrustedSender(event)
    return service.sendMessage(sendHomeMessageInputSchema.parse(payload))
  })

  ipcMain.handle(CONVERSATION_CHANNELS.streamHomeMessage, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const input = streamHomeMessageInputSchema.parse(payload)
    if (activeStreams.has(input.requestId)) throw new Error('Duplicate stream request')
    if (homeStreamActive) {
      event.sender.send(CONVERSATION_CHANNELS.homeStreamEvent, { requestId: input.requestId, type: 'error', code: 'THREAD_BUSY' } satisfies HomeStreamEvent)
      return
    }
    const controller = new AbortController()
    activeStreams.set(input.requestId, { controller, senderId: event.sender.id })
    homeStreamActive = true
    const destroyed = () => controller.abort()
    event.sender.once('destroyed', destroyed)
    const send = (streamEvent: HomeStreamEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send(CONVERSATION_CHANNELS.homeStreamEvent, streamEvent)
    }
    send({ requestId: input.requestId, type: 'started' })
    try {
      for await (const content of service.streamMessage(input, controller.signal)) {
        send({ requestId: input.requestId, type: 'text-delta', content })
      }
      send({ requestId: input.requestId, type: 'completed', messages: await service.listMessages() })
    } catch (error) {
      send(controller.signal.aborted
        ? { requestId: input.requestId, type: 'cancelled' }
        : { requestId: input.requestId, type: 'error', code: 'PROVIDER_UNAVAILABLE' })
    } finally {
      activeStreams.delete(input.requestId)
      homeStreamActive = false
      event.sender.removeListener('destroyed', destroyed)
    }
  })

  ipcMain.handle(CONVERSATION_CHANNELS.cancelHomeStream, (event, payload: unknown) => {
    assertTrustedSender(event)
    const input = cancelHomeStreamInputSchema.parse(payload)
    const stream = activeStreams.get(input.requestId)
    if (stream?.senderId === event.sender.id) stream.controller.abort()
  })
}
