import { describe, expect, it } from 'vitest'
import type { ConversationMessage } from '../../src/shared/contracts/conversation-contract'
import { appendOptimisticMessage, isNearChatBottom, optimisticMessage, reconcileConversationMessages, resizeChatComposer, shouldSendChatKey, WorkspaceChatController } from '../../src/renderer/app/chat-experience'

const message = (sequence: number, role: 'user' | 'assistant' = sequence % 2 ? 'user' : 'assistant', content = `message-${sequence}`): ConversationMessage => ({ id: `persisted-${sequence}`, role, content, createdAt: sequence, sequence, providerId: role === 'assistant' ? 'fixture' : null, modelId: role === 'assistant' ? 'fixture-model' : null })

describe('chat experience state', () => {
  it('keeps a history longer than twenty messages while adding an optimistic turn', () => {
    const history = Array.from({ length: 24 }, (_, index) => message(index + 1))
    const next = appendOptimisticMessage(history, optimisticMessage('new question', 25, 'turn', 25))
    expect(next).toHaveLength(25)
    expect(next.slice(0, 24)).toEqual(history)
  })

  it('deduplicates only the same optimistic request id', () => {
    const pending = optimisticMessage('retry me', 3, 'stable', 10)
    expect(appendOptimisticMessage([message(1), pending], optimisticMessage('retry me', 3, 'stable', 11))).toEqual([message(1), pending])
  })

  it('keeps a new identical retry with a distinct request id', () => {
    const failed = optimisticMessage('retry me', 3, 'failed', 10)
    const retry = optimisticMessage('retry me', 3, 'retry', 11)
    expect(appendOptimisticMessage([message(1), failed], retry)).toEqual([message(1), failed, retry])
  })

  it('keeps a failed optimistic question until persisted error history arrives', () => {
    const pending = optimisticMessage('retry me', 3, 'failed', 30)
    expect(reconcileConversationMessages([message(1), message(2), pending], [message(1), message(2)])).toEqual([message(1), message(2), pending])
  })

  it('replaces a failed optimistic question during retry reload without a duplicate', () => {
    const pending = optimisticMessage('retry me', 3, 'failed', 30)
    const persistedUser = { ...message(3, 'user', 'retry me'), createdAt: 31 }
    const persistedError = { ...message(4, 'assistant', 'temporarily unavailable'), createdAt: 32 }
    expect(reconcileConversationMessages([message(1), message(2), pending], [persistedUser, persistedError])).toEqual([message(1), message(2), persistedUser, persistedError])
  })

  it('reconciles optimistic user content with its persisted stable id and sequence', () => {
    const pending = optimisticMessage('question', 3, 'temporary', 30)
    const persisted = { ...message(3, 'user', 'question'), createdAt: 31 }
    expect(reconcileConversationMessages([message(1), message(2), pending], [message(1), message(2), persisted])).toEqual([message(1), message(2), persisted])
  })

  it('does not consume a new identical retry with an older persisted turn', () => {
    const olderPersisted = { ...message(3, 'user', 'same question'), createdAt: 20 }
    const retry = optimisticMessage('same question', 5, 'new-retry', 40)
    expect(reconcileConversationMessages([olderPersisted, message(4), retry], [olderPersisted, message(4)])).toEqual([olderPersisted, message(4), retry])
  })

  it('does not consume an optimistic retry when content and time match but sequence does not', () => {
    const retry = optimisticMessage('same question', 5, 'new-retry', 40)
    const olderPersisted = { ...message(3, 'user', 'same question'), createdAt: 41 }
    expect(reconcileConversationMessages([retry], [olderPersisted])).toEqual([olderPersisted, retry])
  })

  it('keeps newer local messages when an older persisted snapshot arrives', () => {
    expect(reconcileConversationMessages([message(1), message(2), message(3), message(4)], [message(1), message(2)])).toEqual([message(1), message(2), message(3), message(4)])
  })

  it('deduplicates stable ids during completion reconciliation', () => {
    expect(reconcileConversationMessages([message(1), message(2)], [{ ...message(2), content: 'complete' }, message(3)])).toEqual([message(1), { ...message(2), content: 'complete' }, message(3)])
  })

  it('does not overwrite a longer stable assistant message with an incomplete prefix', () => {
    const complete = { ...message(2, 'assistant', 'complete response'), id: 'stable-assistant' }
    const incomplete = { ...complete, content: 'complete' }
    expect(reconcileConversationMessages([message(1), complete], [message(1), incomplete])).toEqual([message(1), complete])
  })

  it('accepts a non-prefix correction for the same stable assistant id', () => {
    const old = { ...message(2, 'assistant', 'old response'), id: 'stable-assistant' }
    const corrected = { ...old, content: 'corrected' }
    expect(reconcileConversationMessages([message(1), old], [message(1), corrected])).toEqual([message(1), corrected])
  })

  it('orders merged messages by authoritative sequence', () => {
    expect(reconcileConversationMessages([message(3)], [message(2), message(1)])).toEqual([message(1), message(2), message(3)])
  })

  it('reconciles a partial action-result turn into a retained 20+ message history', () => {
    const history = Array.from({ length: 24 }, (_, index) => message(index + 1))
    const returnedTurn = [message(25), message(26)]
    expect(reconcileConversationMessages(history, returnedTurn)).toEqual([...history, ...returnedTurn])
  })

  it('accepts repeated streaming updates without touching prior history', () => {
    const history = [message(1), message(2)]
    let streamed = ''
    for (const delta of ['continuous ', 'stream ', 'growth']) streamed += delta
    expect(history).toEqual([message(1), message(2)])
    expect(streamed).toBe('continuous stream growth')
  })

  it('recognizes the bottom threshold', () => {
    expect(isNearChatBottom({ scrollHeight: 1000, scrollTop: 728, clientHeight: 200 })).toBe(true)
    expect(isNearChatBottom({ scrollHeight: 1000, scrollTop: 727, clientHeight: 200 })).toBe(false)
  })

  it('resumes follow when the user returns near the bottom', () => {
    const readings = [{ scrollHeight: 1000, scrollTop: 300, clientHeight: 200 }, { scrollHeight: 1000, scrollTop: 750, clientHeight: 200 }]
    expect(readings.map((value) => isNearChatBottom(value))).toEqual([false, true])
  })

  it('sends on Enter', () => expect(shouldSendChatKey({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false } })).toBe(true))
  it('keeps a newline on Shift+Enter', () => expect(shouldSendChatKey({ key: 'Enter', shiftKey: true, nativeEvent: { isComposing: false } })).toBe(false))
  it('does not send while IME is composing', () => expect(shouldSendChatKey({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: true } })).toBe(false))
  it('ignores other keys', () => expect(shouldSendChatKey({ key: 'a', shiftKey: false, nativeEvent: { isComposing: false } })).toBe(false))

  it('grows the composer up to its cap', () => {
    const target = { style: { height: '', overflowY: '' }, scrollHeight: 84 }
    resizeChatComposer(target)
    expect(target.style).toEqual({ height: '84px', overflowY: 'hidden' })
  })

  it('caps the composer and enables internal scrolling', () => {
    const target = { style: { height: '', overflowY: '' }, scrollHeight: 240 }
    resizeChatComposer(target)
    expect(target.style).toEqual({ height: '112px', overflowY: 'auto' })
  })
})

describe('workspace chat controller', () => {
  it('keeps the initial A load valid when openWorkspace and its effect both navigate to A', () => {
    const controller = new WorkspaceChatController()
    const opened = controller.activate('A')
    const loadGeneration = opened.generation
    let stopped = false

    const effect = controller.activate('A', () => { stopped = true })

    expect(effect.generation).toBe(loadGeneration)
    expect(stopped).toBe(false)
    expect(controller.reconcileLoad('A', loadGeneration, [], [message(1), message(2)])).toEqual([message(1), message(2)])
  })

  it('clears A partial before stopping its stream and restores no stale partial after A -> B -> A', () => {
    const controller = new WorkspaceChatController()
    controller.activate('A')
    const generationA = controller.beginStream('A')
    expect(controller.appendPartial('A', generationA, 'partial A')).toBe('partial A')
    let snapshotDuringStop: ReturnType<WorkspaceChatController['snapshot']> | null = null

    const b = controller.activate('B', () => { snapshotDuringStop = controller.snapshot() })
    expect(snapshotDuringStop).toMatchObject({ threadId: 'B', partial: '' })
    expect(b).toMatchObject({ threadId: 'B', partial: '' })
    expect(controller.appendPartial('A', generationA, ' late')).toBeNull()

    const reopenedA = controller.activate('A')
    expect(reopenedA.partial).toBe('')
    expect(controller.appendPartial('A', generationA, ' later')).toBeNull()
  })

  it('ignores late cancellation from A after B and reopened A have newer generations', () => {
    const controller = new WorkspaceChatController()
    controller.activate('A')
    const oldA = controller.beginStream('A')
    controller.appendPartial('A', oldA, 'old')
    controller.activate('B')
    controller.activate('A')
    const newA = controller.beginStream('A')
    controller.appendPartial('A', newA, 'new')

    expect(controller.clearPartial('A', oldA)).toBe(false)
    expect(controller.snapshot()).toMatchObject({ threadId: 'A', generation: newA, partial: 'new' })
  })

  it('still invalidates A across A -> B -> A and invalidates again on unmount', () => {
    const controller = new WorkspaceChatController()
    const firstA = controller.activate('A').generation
    controller.activate('B')
    const reopenedA = controller.activate('A').generation

    expect(reopenedA).toBeGreaterThan(firstA)
    expect(controller.accepts('A', firstA)).toBe(false)

    const unmounted = controller.activate(null)
    expect(unmounted.generation).toBeGreaterThan(reopenedA)
    expect(controller.accepts('A', reopenedA)).toBe(false)
  })

  it('stores exactly the rendered reconciliation after a successful history load', () => {
    const controller = new WorkspaceChatController()
    const active = controller.activate('A')
    const pending = optimisticMessage('pending', 3, 'pending', 30)
    const current = [message(1), message(2), pending]
    const loaded = [message(1), message(2)]

    const rendered = controller.reconcileLoad('A', active.generation, current, loaded)
    expect(rendered).toEqual(current)
    controller.activate('B')
    expect(controller.activate('A').messages).toEqual(rendered)
  })

  it('retains a local error entry in the rendered and cached reconciliation', () => {
    const controller = new WorkspaceChatController()
    const active = controller.activate('A')
    const localError = { ...message(3, 'assistant', 'local error'), id: 'local-error', providerId: null, modelId: 'client-error' }
    const current = [message(1), message(2), localError]

    expect(controller.reconcileLoad('A', active.generation, current, [message(1), message(2)])).toEqual(current)
    controller.activate('B')
    expect(controller.activate('A').messages).toEqual(current)
  })

  it('does not let a stale successful load clear a newer stream partial or replace its cache', () => {
    const controller = new WorkspaceChatController()
    const load = controller.activate('A')
    const generation = controller.beginStream('A')
    const optimistic = optimisticMessage('new', 3, 'new', 30)
    controller.cacheMessages('A', [message(1), message(2), optimistic])
    controller.appendPartial('A', generation, 'answering')

    expect(controller.reconcileLoad('A', load.generation, [optimistic], [message(1), message(2)])).toBeNull()
    expect(controller.snapshot()).toMatchObject({ messages: [message(1), message(2), optimistic], partial: 'answering' })
  })
})
