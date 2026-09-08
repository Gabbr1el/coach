import { describe, expect, it, vi } from 'vitest'
import { AIProviderManager } from '../../src/application/ai/ai-provider-manager'
import type { ConversationRepository, CreateConversationMessageRecord } from '../../src/application/conversations/conversation-repository'
import { presentationIntentFor, presentationRequestFor, WorkspaceCoachService } from '../../src/application/conversations/workspace-coach-service'
import type { AIRequest } from '../../src/application/ai/ai-provider'
import type { ConversationMessage } from '../../src/shared/contracts/conversation-contract'
import type { StudyPresentationPreferences } from '../../src/shared/contracts/study-lesson-contract'

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
    for await (const delta of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'Explique produto' }, new AbortController().signal)) deltas.push(delta)

    expect(decodePromptField({ messages: [{ role: 'system', content: prompt }], maxOutputTokens: 1 }, 'WORKSPACE_METADATA_BASE64')).toBeNull()
    expect(prompt).toContain('dados não confiáveis')
    expect(deltas.join('')).toBe('Use a regra ')
    expect(repository.messages.map((message) => message.content)).toEqual(['Explique produto', 'Use a regra do produto.'])
    expect(repository.thread).toMatchObject({ workspaceId: workspace.id, title: 'Cálculo' })
  })

  it('sends no workspace, file, lesson, note, material, history or execution context when privacy is off', async () => {
    const repository = new MemoryConversationRepository()
    repository.messages.push({ id: 'private-turn', role: 'assistant', content: 'PRIVATE_HISTORY', createdAt: 1, sequence: 1, providerId: 'old', modelId: 'old' })
    const manager = new AIProviderManager()
    let providerRequest: AIRequest | null = null
    manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: '', providerId: 'stream', modelId: 'model' }), streamMessage: async function* (request) { providerRequest = request; yield { type: 'completed', response: { content: 'Resposta', providerId: 'stream', modelId: 'model' } } }, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) })
    manager.select('stream')
    const service = new WorkspaceCoachService({ repository, providerManager: manager, getWorkspace: async () => workspace, getCurrentContext: async () => currentContext(false), getWorkspaceMemory: () => { throw new Error('memory must not be read while privacy is off') }, searchMaterials: () => { throw new Error('materials must not be searched while privacy is off') } })
    const activeStudy = { roadmapId: crypto.randomUUID(), moduleId: 'module-b', module: 'Saida', topicId: 'module-b:print', topic: 'print', lessonId: 'lesson', currentBlockId: 'block', checkpointId: null, currentExcerpt: 'PRIVATE_EXCERPT' }

    for await (const _delta of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'Faça uma análise profunda', activePage: 'practice', activeStudy, practiceContext: { fileName: 'PRIVATE_FILE.py', language: 'python', code: 'PRIVATE_CODE' }, lastExecution: { stdout: 'PRIVATE_STDOUT', stderr: 'PRIVATE_STDERR', exitCode: 1, timedOut: false } }, new AbortController().signal)) { /* consume */ }

    const serialized = JSON.stringify(providerRequest)
    for (const secret of ['Cálculo', 'Dominar derivadas', 'PRIVATE_HISTORY', 'PRIVATE_FILE.py', 'PRIVATE_CODE', 'PRIVATE_STDOUT', 'PRIVATE_STDERR', 'PRIVATE_EDITOR', 'PRIVATE_NOTES', 'PRIVATE_MEMORY', 'PRIVATE_EXCERPT']) expect(serialized).not.toContain(secret)
    expect(decodePromptField(providerRequest!, 'WORKSPACE_METADATA_BASE64')).toBeNull()
    expect(decodePromptField(providerRequest!, 'STUDY_CONTEXT_BASE64')).toBeNull()
    expect(decodePromptField(providerRequest!, 'WORKSPACE_MEMORY_BASE64')).toBeNull()
    expect(decodePromptField(providerRequest!, 'MATERIAL_SNIPPETS_BASE64')).toEqual([])
  })

  it('routes authorized live, persisted, lesson, material and execution context when privacy is on', async () => {
    const repository = new MemoryConversationRepository()
    const manager = new AIProviderManager()
    let providerRequest: AIRequest | null = null
    manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: '', providerId: 'stream', modelId: 'model' }), streamMessage: async function* (request) { providerRequest = request; yield { type: 'completed', response: { content: 'Resposta', providerId: 'stream', modelId: 'model' } } }, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) })
    manager.select('stream')
    const service = new WorkspaceCoachService({ repository, providerManager: manager, getWorkspace: async () => workspace, getCurrentContext: async () => currentContext(true), searchMaterials: () => [{ materialId: 'material-1', materialName: 'PRIVATE_MATERIAL.pdf', pageNumber: 2, content: 'PRIVATE_SNIPPET' }] })
    const activeStudy = { roadmapId: crypto.randomUUID(), moduleId: 'module-b', module: 'Saida', topicId: 'module-b:print', topic: 'print', lessonId: 'lesson', currentBlockId: 'block', checkpointId: null, currentExcerpt: 'PRIVATE_EXCERPT' }
    const execution = { stdout: 'PRIVATE_STDOUT', stderr: '', exitCode: 0, timedOut: false }
    const practiceContext = { fileName: 'PRIVATE_FILE.py', language: 'python', code: 'PRIVATE_CODE' }

    for await (const _delta of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'Faça uma análise profunda', activePage: 'practice', activeStudy, practiceContext, lastExecution: execution }, new AbortController().signal)) { /* consume */ }

    expect(decodePromptField(providerRequest!, 'WORKSPACE_METADATA_BASE64')).toEqual({ subject: 'Cálculo', objective: 'Dominar derivadas' })
    expect(decodePromptField(providerRequest!, 'STUDY_CONTEXT_BASE64')).toMatchObject({ fileName: 'PRIVATE_FILE.py', editorContent: 'PRIVATE_EDITOR', notes: 'PRIVATE_NOTES', activeStudy, practiceContext, lastExecution: execution })
    expect(decodePromptField(providerRequest!, 'WORKSPACE_MEMORY_BASE64')).toBe('PRIVATE_MEMORY')
    expect(decodePromptField(providerRequest!, 'MATERIAL_SNIPPETS_BASE64')).toEqual([{ materialId: 'material-1', materialName: 'PRIVATE_MATERIAL.pdf', pageNumber: 2, content: 'PRIVATE_SNIPPET' }])
  })

  it('does not represent a null execution as execution evidence', async () => {
    const manager = new AIProviderManager()
    let providerRequest: AIRequest | null = null
    manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: '', providerId: 'stream', modelId: 'model' }), streamMessage: async function* (request) { providerRequest = request; yield { type: 'completed', response: { content: 'Resposta', providerId: 'stream', modelId: 'model' } } }, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) })
    manager.select('stream')
    const service = new WorkspaceCoachService({ repository: new MemoryConversationRepository(), providerManager: manager, getWorkspace: async () => workspace, getCurrentContext: async () => currentContext(true) })

    for await (const _delta of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'Analise', activePage: 'practice', practiceContext: { fileName: 'main.py', language: 'python', code: 'print(1)' }, lastExecution: null }, new AbortController().signal)) { /* consume */ }

    expect(decodePromptField(providerRequest!, 'STUDY_CONTEXT_BASE64')).not.toHaveProperty('lastExecution')
    expect(providerRequest!.messages[0]?.content).toContain('Somente afirme que código foi executado quando o contexto autorizado contiver lastExecution')
  })

  it.each([
    ['simplifique esta parte', 'SIMPLIFY'],
    ['use uma analogia', 'ANALOGY'],
    ['comece pelo código', 'CODE_FIRST'],
    ['dê mais exemplos', 'MORE_EXAMPLES'],
    ['explique passo a passo', 'STEP_BY_STEP'],
    ['aprofunde esta seção', 'MORE_DEPTH'],
    ['seja mais conciso', 'MORE_CONCISE'],
  ] as const)('detects the explicit presentation request %s', (content, intent) => {
    expect(presentationIntentFor(content)).toBe(intent)
    expect(presentationRequestFor(content)).toEqual({ intent, source: 'situational' })
  })

  it.each(['o que significa isso?', 'não entendi essa parte', 'me ajuda?', 'por que esse código funciona?', 'qual é a resposta?'])('does not classify a normal pedagogical question as adaptation: %s', (content) => {
    expect(presentationIntentFor(content)).toBeNull()
  })

  it('adapts only the visible study block without calling the chat provider', async () => {
    const manager = new AIProviderManager()
    const stream = vi.fn()
    manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: '', providerId: 'stream', modelId: 'model' }), streamMessage: stream, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) })
    manager.select('stream')
    const preferences: StudyPresentationPreferences = { detail: 'standard', explanation: 'balanced', examples: 'balanced', explicitIntents: [], recurringEvidence: { SIMPLIFY: 0, ANALOGY: 0, CODE_FIRST: 0, MORE_EXAMPLES: 0, STEP_BY_STEP: 0, MORE_DEPTH: 0, MORE_CONCISE: 0 }, evidence: [] }
    const adaptSection = vi.fn(async () => ({ id: 'adaptation', workspaceId: workspace.id, lessonId: 'lesson', blockId: 'block', revision: 1, reason: 'use uma analogia', mode: 'ANALOGY' as const, originalBlock: { id: 'block', type: 'explanation' as const, title: 'T', content: 'Original' }, adaptedBlock: { id: 'block', type: 'analogy' as const, title: 'T', content: 'Adaptado' }, isActive: true, providerId: 'stream', modelId: 'model', createdAt: 1 }))
    const updatePreferences = vi.fn((_workspaceId: string, value: StudyPresentationPreferences) => value)
    const service = new WorkspaceCoachService({ repository: new MemoryConversationRepository(), providerManager: manager, getWorkspace: async () => workspace, studyLessonService: { adaptSection, getPreferences: () => preferences, updatePreferences } })
    const metadata = vi.fn()
    const controller = new AbortController()
    for await (const _delta of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'use uma analogia', activePage: 'studies', activeStudy: { roadmapId: crypto.randomUUID(), moduleId: crypto.randomUUID(), module: 'M', topicId: 'topic', topic: 'T', lessonId: 'lesson', currentBlockId: 'block', checkpointId: null, currentExcerpt: 'Original' } }, controller.signal, metadata)) { /* consume */ }
    expect(adaptSection).toHaveBeenCalledWith(expect.objectContaining({ blockId: 'block', mode: 'ANALOGY' }), controller.signal)
    expect(updatePreferences).toHaveBeenCalledWith(workspace.id, expect.objectContaining({ explicitIntents: [], explanation: 'balanced', recurringEvidence: expect.objectContaining({ ANALOGY: 1 }) }))
    expect(metadata).toHaveBeenCalledWith({ lessonAdapted: { lessonId: 'lesson', blockId: 'block' } })
    expect(stream).not.toHaveBeenCalled()
  })

  it('keeps situational adaptation evidence from changing global defaults', async () => {
    const manager = new AIProviderManager()
    manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: '', providerId: 'stream', modelId: 'model' }), streamMessage: async function* () { throw new Error('must not stream') }, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) })
    manager.select('stream')
    let preferences: StudyPresentationPreferences = { detail: 'standard', explanation: 'balanced', examples: 'balanced', explicitIntents: [], recurringEvidence: { SIMPLIFY: 0, ANALOGY: 0, CODE_FIRST: 0, MORE_EXAMPLES: 0, STEP_BY_STEP: 0, MORE_DEPTH: 0, MORE_CONCISE: 0 }, evidence: [] }
    const service = new WorkspaceCoachService({ repository: new MemoryConversationRepository(), providerManager: manager, getWorkspace: async () => workspace, studyLessonService: { adaptSection: async (input) => ({ id: crypto.randomUUID(), workspaceId: workspace.id, lessonId: input.lessonId, blockId: input.blockId, revision: 1, reason: input.instruction, mode: input.mode ?? 'CUSTOM', originalBlock: { id: input.blockId, type: 'explanation', title: 'T', content: 'Original' }, adaptedBlock: { id: input.blockId, type: 'explanation', title: 'T', content: 'Adaptado' }, isActive: true, providerId: 'stream', modelId: 'model', createdAt: 1 }), getPreferences: () => preferences, updatePreferences: (_workspaceId, value) => { preferences = value; return value } } })
    const activeStudy = { roadmapId: crypto.randomUUID(), moduleId: crypto.randomUUID(), module: 'M', topicId: 'topic-a', topic: 'T', lessonId: 'lesson', currentBlockId: 'block', checkpointId: null, currentExcerpt: 'Original' }
    for (let index = 0; index < 2; index += 1) for await (const _delta of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'simplifique esta parte', activePage: 'studies', activeStudy: { ...activeStudy, topicId: `topic-${index}`, currentBlockId: `block-${index}` } }, new AbortController().signal)) { /* consume */ }
    expect(preferences.recurringEvidence.SIMPLIFY).toBe(2)
    expect(preferences.detail).toBe('standard')
    expect(preferences.explanation).toBe('simple')
    expect(preferences.evidence).toHaveLength(2)
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

function currentContext(shareContextWithAi: boolean) {
  return {
    version: 1,
    workspace,
    study: { workspaceId: workspace.id, sessionId: '00000000-0000-4000-8000-000000000456', sessionStartedAt: 1, fileName: 'PRIVATE_FILE.py', language: 'python', editorContent: 'PRIVATE_EDITOR', notes: 'PRIVATE_NOTES', shareContextWithAi, timerDurationSeconds: 1500, timerRemainingSeconds: 1500, timerStatus: 'idle' as const, timerStartedAt: null, plan: [], updatedAt: 1, documentRevision: 1, notesRevision: 1, accumulatedFocusSeconds: 0 },
    observer: { active: false, repeatedErrorCount: 0, interventionSuggested: false, focusExitCount: 0, timeAwaySeconds: 0 },
    activePlanItem: 'PRIVATE_PLAN',
    memory: 'PRIVATE_MEMORY',
  }
}

function decodePromptField(request: AIRequest, field: string): unknown {
  const prompt = request.messages[0]?.content ?? ''
  const encoded = prompt.split(`${field}=`)[1]?.split('\n')[0] ?? ''
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
}
