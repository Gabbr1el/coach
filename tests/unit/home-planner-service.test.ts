import { describe, expect, it } from 'vitest'
import { HomePlannerService } from '../../src/application/conversations/home-planner-service'
import type { ConversationRepository, CreateConversationMessageRecord } from '../../src/application/conversations/conversation-repository'
import type { ConversationMessage } from '../../src/shared/contracts/conversation-contract'

class MemoryConversationRepository implements ConversationRepository {
  readonly messages: ConversationMessage[] = []

  async ensureHomeThread(): Promise<void> {}
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
})
