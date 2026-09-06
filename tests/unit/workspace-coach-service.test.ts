import { describe, expect, it } from 'vitest'
import { AIProviderManager } from '../../src/application/ai/ai-provider-manager'
import type { ConversationRepository, CreateConversationMessageRecord } from '../../src/application/conversations/conversation-repository'
import { WorkspaceCoachService } from '../../src/application/conversations/workspace-coach-service'
import type { ConversationMessage } from '../../src/shared/contracts/conversation-contract'

class MemoryConversationRepository implements ConversationRepository {
  readonly messages: ConversationMessage[] = []
  thread: { id: string; workspaceId: string; title: string } | null = null
  async ensureHomeThread(): Promise<void> {}
  async ensureWorkspaceThread(id: string, workspaceId: string, title: string): Promise<void> { this.thread = { id, workspaceId, title } }
  async listMessages(): Promise<ConversationMessage[]> { return this.messages }
  async addTurn({ user, assistant }: { threadId: string; user: Omit<CreateConversationMessageRecord, 'sequence'>; assistant: Omit<CreateConversationMessageRecord, 'sequence'> }): Promise<ConversationMessage[]> {
    const turn = [{ ...user, sequence: this.messages.length + 1 }, { ...assistant, sequence: this.messages.length + 2 }]
    this.messages.push(...turn)
    return turn
  }
}

const workspace = { id: '00000000-0000-4000-8000-000000000123', name: 'Cálculo', objective: 'Dominar derivadas', status: 'active' as const, createdAt: 1, updatedAt: 1, lastOpenedAt: null, archivedAt: null }

describe('WorkspaceCoachService', () => {
  it('keeps a stable isolated thread and sends workspace context to the provider', async () => {
    const repository = new MemoryConversationRepository()
    const manager = new AIProviderManager()
    let prompt = ''
    manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: '', providerId: 'stream', modelId: 'model' }), streamMessage: async function* (request) { prompt = request.messages[0]?.content ?? ''; yield { type: 'text-delta', content: 'Use a regra ' }; yield { type: 'completed', response: { content: 'Use a regra do produto.', providerId: 'stream', modelId: 'model' } } }, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) })
    manager.select('stream')
    let id = 0
    const service = new WorkspaceCoachService({ repository, providerManager: manager, getWorkspace: async () => workspace, now: () => 20, createId: () => `id-${++id}` })

    const deltas = []
    for await (const delta of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'Explique produto', studyContext: { fileName: 'main.py', editorContent: 'print(1)', notes: '', activePlanItem: 'Praticar' } }, new AbortController().signal)) deltas.push(delta)

    const encodedMetadata = prompt.split('WORKSPACE_METADATA_BASE64=')[1]?.split('\n')[0] ?? ''
    expect(JSON.parse(Buffer.from(encodedMetadata, 'base64').toString('utf8'))).toEqual({ subject: 'Cálculo', objective: 'Dominar derivadas' })
    expect(prompt).toContain('dados não confiáveis')
    expect(deltas.join('')).toBe('Use a regra ')
    expect(repository.messages.map((message) => message.content)).toEqual(['Explique produto', 'Use a regra do produto.'])
    expect(repository.thread).toMatchObject({ workspaceId: workspace.id, title: 'Cálculo' })
  })

  it('rejects a missing or archived workspace before contacting a provider', async () => {
    const manager = new AIProviderManager()
    const service = new WorkspaceCoachService({ repository: new MemoryConversationRepository(), providerManager: manager, getWorkspace: async () => null })
    await expect(service.listMessages(workspace.id)).rejects.toThrow('Workspace not found')
  })

  it('does not persist a cancelled partial response', async () => {
    const repository = new MemoryConversationRepository()
    const manager = new AIProviderManager()
    const controller = new AbortController()
    manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: '', providerId: 'stream', modelId: 'model' }), streamMessage: async function* () { yield { type: 'text-delta', content: 'Parcial' }; controller.abort() }, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) })
    manager.select('stream')
    const service = new WorkspaceCoachService({ repository, providerManager: manager, getWorkspace: async () => workspace })

    const consume = async () => { for await (const _delta of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'Oi' }, controller.signal)) { /* consume */ } }
    await expect(consume()).rejects.toMatchObject({ name: 'AbortError' })
    expect(repository.messages).toEqual([])
  })
})
