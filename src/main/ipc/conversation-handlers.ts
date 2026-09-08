import { ipcMain } from 'electron'
import type { HomePlannerService } from '../../application/conversations/home-planner-service'
import type { HomeOrganizerService } from '../../application/conversations/home-organizer-service'
import type { WorkspaceCoachService } from '../../application/conversations/workspace-coach-service'
import { cancelHomeStreamInputSchema, cancelWorkspaceStreamInputSchema, sendHomeMessageInputSchema, streamHomeMessageInputSchema, streamWorkspaceMessageInputSchema, workspaceConversationInputSchema, type HomeStreamEvent } from '../../shared/contracts/conversation-contract'
import { CONVERSATION_CHANNELS } from '../../shared/contracts/conversation-channels'
import { assertTrustedSender } from './trusted-sender'
import type { WorkspaceActionService } from '../../application/workspaces/workspace-action-service'

export function registerConversationHandlers(service: HomePlannerService, workspaceService: WorkspaceCoachService, organizer: HomeOrganizerService, workspaceActions?: WorkspaceActionService): void {
  const activeStreams = new Map<string, { controller: AbortController; senderId: number; threadKey: string }>()
  let homeStreamActive = false
  if (workspaceActions) ipcMain.handle(CONVERSATION_CHANNELS.executeWorkspaceAction, (event, payload) => { assertTrustedSender(event); return workspaceActions.execute(payload) })
  ipcMain.handle(CONVERSATION_CHANNELS.listHomeMessages, (event) => {
    assertTrustedSender(event)
    return service.listMessages()
  })

  ipcMain.handle(CONVERSATION_CHANNELS.sendHomeMessage, (event, payload: unknown) => {
    assertTrustedSender(event)
    return organizer.organize(sendHomeMessageInputSchema.parse(payload)).then((turn) => turn.messages)
  })
  ipcMain.handle(CONVERSATION_CHANNELS.organizeHomeMessage, (event, payload: unknown) => { assertTrustedSender(event); return organizer.organize(sendHomeMessageInputSchema.parse(payload)) })
  ipcMain.handle(CONVERSATION_CHANNELS.saveHomeActionResult, (event, payload: unknown) => { assertTrustedSender(event); return service.saveSystemResult(sendHomeMessageInputSchema.parse({ content: payload }).content) })

  ipcMain.handle(CONVERSATION_CHANNELS.streamHomeMessage, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const input = streamHomeMessageInputSchema.parse(payload)
    if (activeStreams.has(input.requestId)) throw new Error('Duplicate stream request')
    if (homeStreamActive || [...activeStreams.values()].some((stream) => stream.senderId === event.sender.id)) {
      event.sender.send(CONVERSATION_CHANNELS.homeStreamEvent, { requestId: input.requestId, type: 'error', code: 'THREAD_BUSY' } satisfies HomeStreamEvent)
      return
    }
    const controller = new AbortController()
    activeStreams.set(input.requestId, { controller, senderId: event.sender.id, threadKey: 'home' })
    homeStreamActive = true
    const destroyed = () => controller.abort()
    event.sender.once('destroyed', destroyed)
    const send = (streamEvent: HomeStreamEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send(CONVERSATION_CHANNELS.homeStreamEvent, streamEvent)
    }
    send({ requestId: input.requestId, type: 'started' })
    try {
      const turn = await organizer.organize(input)
      if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError')
      send({ requestId: input.requestId, type: 'text-delta', content: turn.result.message })
      send({ requestId: input.requestId, type: 'completed', messages: turn.messages })
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

  ipcMain.handle(CONVERSATION_CHANNELS.listWorkspaceMessages, (event, payload: unknown) => {
    assertTrustedSender(event)
    return workspaceService.listMessages(workspaceConversationInputSchema.parse(payload).workspaceId)
  })

  ipcMain.handle(CONVERSATION_CHANNELS.streamWorkspaceMessage, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const input = streamWorkspaceMessageInputSchema.parse(payload)
    if (activeStreams.has(input.requestId)) throw new Error('Duplicate stream request')
    if ([...activeStreams.values()].some((stream) => stream.senderId === event.sender.id)) {
      event.sender.send(CONVERSATION_CHANNELS.workspaceStreamEvent, { requestId: input.requestId, type: 'error', code: 'THREAD_BUSY' } satisfies HomeStreamEvent)
      return
    }
    const streamKey = `workspace:${input.workspaceId}`
    if ([...activeStreams.values()].some((stream) => stream.threadKey === streamKey)) {
      event.sender.send(CONVERSATION_CHANNELS.workspaceStreamEvent, { requestId: input.requestId, type: 'error', code: 'THREAD_BUSY' } satisfies HomeStreamEvent)
      return
    }
    const controller = new AbortController()
    activeStreams.set(input.requestId, { controller, senderId: event.sender.id, threadKey: streamKey })
    const destroyed = () => controller.abort()
    event.sender.once('destroyed', destroyed)
    const send = (streamEvent: HomeStreamEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send(CONVERSATION_CHANNELS.workspaceStreamEvent, streamEvent)
    }
    send({ requestId: input.requestId, type: 'started' })
    try {
      let metadata: Extract<HomeStreamEvent, { type: 'completed' }>['metadata']
      for await (const content of workspaceService.streamMessage(input.workspaceId, input, controller.signal, (value) => { metadata = value })) send({ requestId: input.requestId, type: 'text-delta', content })
      send({ requestId: input.requestId, type: 'completed', messages: await workspaceService.listMessages(input.workspaceId), ...(metadata ? { metadata } : {}) })
    } catch {
      send(controller.signal.aborted ? { requestId: input.requestId, type: 'cancelled' } : { requestId: input.requestId, type: 'error', code: 'PROVIDER_UNAVAILABLE' })
    } finally {
      activeStreams.delete(input.requestId)
      event.sender.removeListener('destroyed', destroyed)
    }
  })

  ipcMain.handle(CONVERSATION_CHANNELS.cancelWorkspaceStream, (event, payload: unknown) => {
    assertTrustedSender(event)
    const input = cancelWorkspaceStreamInputSchema.parse(payload)
    const stream = activeStreams.get(input.requestId)
    if (stream?.senderId === event.sender.id) stream.controller.abort()
  })
}
