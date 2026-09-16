import type { ConversationMessage } from '../../shared/contracts/conversation-contract'

export const CHAT_BOTTOM_THRESHOLD = 72
export const CHAT_COMPOSER_MAX_HEIGHT = 112

interface ScrollMetrics { scrollHeight: number; scrollTop: number; clientHeight: number }
interface ScrollTarget { scrollHeight: number; scrollTop: number }
interface ComposerTarget { scrollHeight: number; style: { height: string; overflowY: string } }

export function isNearChatBottom(metrics: ScrollMetrics, threshold = CHAT_BOTTOM_THRESHOLD): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold
}

export function scrollChatToLatest(element: ScrollTarget): void {
  element.scrollTop = element.scrollHeight
}

export function resizeChatComposer(element: ComposerTarget, maxHeight = CHAT_COMPOSER_MAX_HEIGHT): void {
  element.style.height = '0px'
  element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`
  element.style.overflowY = element.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

export function shouldSendChatKey(event: { key: string; shiftKey: boolean; nativeEvent: { isComposing: boolean } }): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing
}

export function optimisticMessage(content: string, sequence: number, id: string = crypto.randomUUID(), createdAt = Date.now()): ConversationMessage {
  return { id: `optimistic-${id}`, role: 'user', content, createdAt, sequence, providerId: null, modelId: null }
}

export function appendOptimisticMessage(messages: readonly ConversationMessage[], message: ConversationMessage): ConversationMessage[] {
  const duplicate = messages.some((item) => item.id === message.id)
  return duplicate ? [...messages] : [...messages, message]
}

function sameOptimisticTurn(optimistic: ConversationMessage, persisted: ConversationMessage): boolean {
  return optimistic.id.startsWith('optimistic-')
    && optimistic.role === persisted.role
    && optimistic.content === persisted.content
    && optimistic.sequence === persisted.sequence
    && persisted.createdAt >= optimistic.createdAt
}

export function reconcileConversationMessages(current: readonly ConversationMessage[], persisted: readonly ConversationMessage[]): ConversationMessage[] {
  const incomingIds = new Set(persisted.map((message) => message.id))
  const retained = current.filter((message) => !incomingIds.has(message.id) && !persisted.some((candidate) => sameOptimisticTurn(message, candidate)))
  const byId = new Map<string, ConversationMessage>()
  for (const message of retained) byId.set(message.id, message)
  for (const message of persisted) {
    const existing = current.find((candidate) => candidate.id === message.id)
    byId.set(message.id, existing?.role === 'assistant' && existing.content.length > message.content.length && existing.content.startsWith(message.content) ? existing : message)
  }
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence || left.createdAt - right.createdAt || left.id.localeCompare(right.id))
}

export interface WorkspaceChatSnapshot {
  readonly threadId: string | null
  readonly generation: number
  readonly messages: ConversationMessage[]
  readonly partial: string
}

export class WorkspaceChatController {
  private readonly histories = new Map<string, ConversationMessage[]>()
  private readonly partials = new Map<string, string>()
  private activeThreadId: string | null = null
  private generation = 0

  activate(threadId: string | null, stopActive?: () => void): WorkspaceChatSnapshot {
    if (threadId !== null && threadId === this.activeThreadId) return this.snapshot()
    if (this.activeThreadId) this.partials.delete(this.activeThreadId)
    this.generation += 1
    this.activeThreadId = threadId
    stopActive?.()
    return this.snapshot()
  }

  beginStream(threadId: string): number {
    this.generation += 1
    this.activeThreadId = threadId
    this.partials.delete(threadId)
    return this.generation
  }

  accepts(threadId: string, generation: number): boolean {
    return this.activeThreadId === threadId && this.generation === generation
  }

  appendPartial(threadId: string, generation: number, content: string): string | null {
    if (!this.accepts(threadId, generation)) return null
    const next = (this.partials.get(threadId) ?? '') + content
    this.partials.set(threadId, next)
    return next
  }

  clearPartial(threadId: string, generation: number): boolean {
    if (!this.accepts(threadId, generation)) return false
    this.partials.delete(threadId)
    return true
  }

  reconcileLoad(threadId: string, generation: number, current: readonly ConversationMessage[], persisted: readonly ConversationMessage[]): ConversationMessage[] | null {
    if (!this.accepts(threadId, generation)) return null
    const reconciled = reconcileConversationMessages(current, persisted)
    this.histories.set(threadId, reconciled)
    this.partials.delete(threadId)
    return reconciled
  }

  reconcileCurrent(threadId: string, current: readonly ConversationMessage[], persisted: readonly ConversationMessage[]): ConversationMessage[] | null {
    if (this.activeThreadId !== threadId) return null
    const reconciled = reconcileConversationMessages(current, persisted)
    this.histories.set(threadId, reconciled)
    return reconciled
  }

  cacheMessages(threadId: string, messages: readonly ConversationMessage[]): ConversationMessage[] {
    const next = [...messages]
    this.histories.set(threadId, next)
    return next
  }

  snapshot(): WorkspaceChatSnapshot {
    const threadId = this.activeThreadId
    return {
      threadId,
      generation: this.generation,
      messages: threadId ? [...(this.histories.get(threadId) ?? [])] : [],
      partial: threadId ? this.partials.get(threadId) ?? '' : '',
    }
  }
}
