import { describe, expect, it } from 'vitest'
import { HomePlannerService } from '../../src/application/conversations/home-planner-service'
import type { ConversationRepository, CreateConversationMessageRecord } from '../../src/application/conversations/conversation-repository'
import type { ConversationMessage } from '../../src/shared/contracts/conversation-contract'
import { AIProviderManager } from '../../src/application/ai/ai-provider-manager'

class MemoryConversationRepository implements ConversationRepository {
  readonly messages: ConversationMessage[] = []

  async ensureHomeThread(): Promise<void> {}
  async ensureWorkspaceThread(): Promise<void> {}
  async listMessages(): Promise<ConversationMessage[]> { return this.messages }
  async addTurn({ user, assistant }: { threadId: string; user: Omit<CreateConversationMessageRecord, 'sequence'>; assistant: Omit<CreateConversationMessageRecord, 'sequence'> }): Promise<ConversationMessage[]> {
    const sequence = this.messages.length + 1
    const sequencedUser = { ...user, sequence }
    const sequencedAssistant = { ...assistant, sequence: sequence + 1 }
    this.messages.push(sequencedUser, sequencedAssistant)
    return [sequencedUser, sequencedAssistant]
  }
}

describe('HomePlannerService', () => {
  it('stores the student message and a transparent local response', async () => {
    const repository = new MemoryConversationRepository()
    let id = 0
    const service = new HomePlannerService({ repository, now: () => 100, createId: () => `message-${++id}` })

    const messages = await service.sendMessage({ content: ' Tenho prova de C dia 16 ' })

    expect(messages[0]).toMatchObject({ role: 'user', content: 'Tenho prova de C dia 16' })
    expect(messages[1]).toMatchObject({ role: 'assistant', providerId: 'coach-local', modelId: 'planner-rules-v1' })
    expect(repository.messages).toHaveLength(2)
  })

  it('uses the active provider while keeping the turn in Coach storage', async () => {
    const repository = new MemoryConversationRepository()
    const manager = new AIProviderManager()
    manager.register({ id: 'test-provider', name: 'Test', testConnection: async () => {}, sendMessage: async () => ({ content: 'Plano remoto', providerId: 'test-provider', modelId: 'test-model' }), getCapabilities: () => ({ streaming: false, usageInformation: false, supportedInput: ['text'] }) })
    manager.select('test-provider')
    let id = 0
    const service = new HomePlannerService({ repository, providerManager: manager, now: () => 200, createId: () => `remote-${++id}` })

    const messages = await service.sendMessage({ content: 'Organize C' })

    expect(messages[1]).toMatchObject({ content: 'Plano remoto', providerId: 'test-provider', modelId: 'test-model' })
    expect(repository.messages).toHaveLength(2)
  })

  it('preserves the turn locally when the active provider fails', async () => {
    const repository = new MemoryConversationRepository()
    const manager = new AIProviderManager()
    manager.register({ id: 'broken', name: 'Broken', testConnection: async () => {}, sendMessage: async () => { throw new Error('offline') }, getCapabilities: () => ({ streaming: false, usageInformation: false, supportedInput: ['text'] }) })
    manager.select('broken')
    const service = new HomePlannerService({ repository, providerManager: manager, now: () => 300, createId: () => crypto.randomUUID() })

    const messages = await service.sendMessage({ content: 'Minha prova é amanhã' })

    expect(messages).toHaveLength(2)
    expect(messages[1]?.modelId).toBe('provider-failure-v1')
    expect(repository.messages).toHaveLength(2)
  })

  it('bounds provider conversation context to four short user messages', async () => { const repository = new MemoryConversationRepository(); for (let index = 0; index < 6; index += 1) repository.messages.push({ id: `u-${index}`, role: 'user', content: `${index}:${'x'.repeat(400)}`, createdAt: index, sequence: index + 1, providerId: null, modelId: null }); let request: any; const manager = new AIProviderManager(); manager.register({ id: 'bounded', name: 'Bounded', testConnection: async () => {}, sendMessage: async (value) => { request = value; return { content: 'ok', providerId: 'bounded', modelId: 'test' } }, getCapabilities: () => ({ streaming: false, usageInformation: false, supportedInput: ['text'] }) }); manager.select('bounded'); const service = new HomePlannerService({ repository, providerManager: manager, now: () => 300, createId: () => crypto.randomUUID() }); const recent = await service.listRecentUserMessages(); expect(recent).toHaveLength(4); expect(recent.every((message) => message.content.length <= 300)).toBe(true); await service.sendMessage({ content: 'nova' }); const history = request.messages.slice(1, -1); expect(history).toHaveLength(4); expect(history.map((message: any) => message.content.slice(0, 2))).toEqual(['2:', '3:', '4:', '5:']) })

  it('persists a streamed turn only after successful completion', async () => {
    const repository = new MemoryConversationRepository()
    const manager = new AIProviderManager()
    manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: '', providerId: 'stream', modelId: 'stream-model' }), streamMessage: async function* () { yield { type: 'text-delta', content: 'Plano ' }; yield { type: 'text-delta', content: 'pronto' }; yield { type: 'completed', response: { content: 'Plano pronto', providerId: 'stream', modelId: 'stream-model' } } }, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) })
    manager.select('stream')
    let id = 0
    const service = new HomePlannerService({ repository, providerManager: manager, now: () => 400, createId: () => `stream-${++id}` })

    const deltas = []
    for await (const delta of service.streamMessage({ content: 'Planeje' }, new AbortController().signal)) deltas.push(delta)

    expect(deltas.join('')).toBe('Plano pronto')
    expect(repository.messages.map((message) => message.content)).toEqual(['Planeje', 'Plano pronto'])
  })
})
