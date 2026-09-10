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
  it('uses managed workspace context regardless of the legacy sharing flag', async () => { const repository = new MemoryConversationRepository(); const manager = new AIProviderManager(); let request: AIRequest | null = null; manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: '', providerId: 'stream', modelId: 'm' }), streamMessage: async function* (value) { request = value; yield { type: 'completed', response: { content: 'ok', providerId: 'stream', modelId: 'm' } } }, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) }); manager.select('stream'); const service = new WorkspaceCoachService({ repository, providerManager: manager, getWorkspace: async () => workspace, getCurrentContext: async () => currentContext(false) }); for await (const _ of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'explique meu plano', activePage: 'plan' }, new AbortController().signal)) {} expect(decodePromptField(request!, 'STUDY_CONTEXT_BASE64')).toMatchObject({ activePlanItem: expect.anything() }) })
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

    expect(decodePromptField({ messages: [{ role: 'system', content: prompt }], maxOutputTokens: 1 }, 'WORKSPACE_METADATA_BASE64')).toEqual({ subject: 'Cálculo', objective: 'Dominar derivadas' })
    expect(prompt).toContain('dados não confiáveis')
    expect(deltas.join('')).toBe('Use a regra ')
    expect(repository.messages.map((message) => message.content)).toEqual(['Explique produto', 'Use a regra do produto.'])
    expect(repository.thread).toMatchObject({ workspaceId: workspace.id, title: 'Cálculo' })
  })

  it('uses managed workspace context even when the legacy privacy flag is off', async () => {
    const repository = new MemoryConversationRepository()
    repository.messages.push({ id: 'private-turn', role: 'assistant', content: 'PRIVATE_HISTORY', createdAt: 1, sequence: 1, providerId: 'old', modelId: 'old' })
    const manager = new AIProviderManager()
    let providerRequest: AIRequest | null = null
    manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: '', providerId: 'stream', modelId: 'model' }), streamMessage: async function* (request) { providerRequest = request; yield { type: 'completed', response: { content: 'Resposta', providerId: 'stream', modelId: 'model' } } }, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) })
    manager.select('stream')
    const service = new WorkspaceCoachService({ repository, providerManager: manager, getWorkspace: async () => workspace, getCurrentContext: async () => currentContext(false), getWorkspaceMemory: () => 'WORKSPACE_MEMORY', searchMaterials: () => [] })
    const activeStudy = { roadmapId: crypto.randomUUID(), moduleId: 'module-b', module: 'Saida', topicId: 'module-b:print', topic: 'print', lessonId: 'lesson', currentBlockId: 'block', checkpointId: null, currentExcerpt: 'PRIVATE_EXCERPT' }

    for await (const _delta of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'Faça uma análise profunda', activePage: 'practice', activeStudy, practiceContext: { fileName: 'PRIVATE_FILE.py', language: 'python', code: 'PRIVATE_CODE' }, lastExecution: { stdout: 'PRIVATE_STDOUT', stderr: 'PRIVATE_STDERR', exitCode: 1, timedOut: false } }, new AbortController().signal)) { /* consume */ }

    const serialized = JSON.stringify(providerRequest)
    expect(serialized).not.toBe('{}')
    expect(decodePromptField(providerRequest!, 'WORKSPACE_METADATA_BASE64')).not.toBeNull()
    expect(decodePromptField(providerRequest!, 'STUDY_CONTEXT_BASE64')).not.toBeNull()
    expect(JSON.stringify(providerRequest)).not.toContain('WORKSPACE_MEMORY_BASE64')
    expect(JSON.stringify(providerRequest)).not.toContain('MATERIAL_SNIPPETS_BASE64')
  })

  it('adapts a managed study block regardless of the legacy privacy flag', async () => {
    const manager = new AIProviderManager()
    let providerRequest: AIRequest | null = null
    manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: '', providerId: 'stream', modelId: 'model' }), streamMessage: async function* (request) { providerRequest = request; yield { type: 'completed', response: { content: 'Resposta localmente limitada', providerId: 'stream', modelId: 'model' } } }, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) })
    manager.select('stream')
    const adaptSection = vi.fn()
    const service = new WorkspaceCoachService({ repository: new MemoryConversationRepository(), providerManager: manager, getWorkspace: async () => workspace, getCurrentContext: async () => currentContext(false), studyLessonService: { adaptSection, getPreferences: () => ({ detail: 'standard', explanation: 'balanced', examples: 'balanced', explicitIntents: [], recurringEvidence: { SIMPLIFY: 0, ANALOGY: 0, CODE_FIRST: 0, MORE_EXAMPLES: 0, STEP_BY_STEP: 0, MORE_DEPTH: 0, MORE_CONCISE: 0 }, evidence: [] }), updatePreferences: (_workspaceId, value) => value } })

    for await (const _delta of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'use uma analogia', activePage: 'studies', activeStudy: { roadmapId: crypto.randomUUID(), moduleId: 'module', module: 'M', topicId: 'topic', topic: 'T', lessonId: 'lesson', currentBlockId: 'block', checkpointId: null, currentExcerpt: 'PRIVATE_EXCERPT' } }, new AbortController().signal)) { /* consume */ }

    expect(adaptSection).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(providerRequest)).not.toContain('PRIVATE_EXCERPT')
  })

  it('routes authorized live, persisted, lesson, material and execution context when privacy is on', async () => {
    const repository = new MemoryConversationRepository()
    const manager = new AIProviderManager()
    let providerRequest: AIRequest | null = null
    manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: '', providerId: 'stream', modelId: 'model' }), streamMessage: async function* (request) { providerRequest = request; yield { type: 'completed', response: { content: 'Resposta', providerId: 'stream', modelId: 'model' } } }, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) })
    manager.select('stream')
    const service = new WorkspaceCoachService({ repository, providerManager: manager, getWorkspace: async () => workspace, getCurrentContext: async () => currentContext(true), searchMaterials: () => [{ chunkId: 'chunk-1', materialId: 'material-1', materialName: 'PRIVATE_MATERIAL.pdf', pageNumber: 2, topicId: null, retrieval: 'lexical' as const, content: 'PRIVATE_SNIPPET' }] })
    const activeStudy = { roadmapId: crypto.randomUUID(), moduleId: 'module-b', module: 'Saida', topicId: 'module-b:print', topic: 'print', lessonId: 'lesson', currentBlockId: 'block', checkpointId: null, currentExcerpt: 'PRIVATE_EXCERPT' }
    const execution = { stdout: 'PRIVATE_STDOUT', stderr: '', exitCode: 0, timedOut: false }
    const practiceContext = { fileName: 'PRIVATE_FILE.py', language: 'python', code: 'PRIVATE_CODE' }

    for await (const _delta of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'Faça uma análise profunda', activePage: 'practice', activeStudy, practiceContext, lastExecution: execution }, new AbortController().signal)) { /* consume */ }

    expect(decodePromptField(providerRequest!, 'WORKSPACE_METADATA_BASE64')).toEqual({ subject: 'Cálculo', objective: 'Dominar derivadas' })
    expect(decodePromptField(providerRequest!, 'STUDY_CONTEXT_BASE64')).toMatchObject({ fileName: '', editorContent: '', notes: '', activeStudy, practiceContext, lastExecution: execution })
    expect(JSON.stringify(providerRequest)).not.toContain('WORKSPACE_MEMORY_BASE64')
    expect(JSON.stringify(providerRequest)).not.toContain('MATERIAL_SNIPPETS_BASE64')
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

  it('routes the active inline code block and authoritative validation to the Tutor', async () => {
    const manager = new AIProviderManager()
    let providerRequest: AIRequest | null = null
    manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: JSON.stringify({ kind: 'final_response' }), providerId: 'stream', modelId: 'model' }), streamMessage: async function* (request) { providerRequest = request; yield { type: 'completed', response: { content: 'Revise a saída.', providerId: 'stream', modelId: 'model' } } }, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) })
    manager.select('stream')
    const service = new WorkspaceCoachService({ repository: new MemoryConversationRepository(), providerManager: manager, getWorkspace: async () => workspace, getCurrentContext: async () => currentContext(true), contextHub: { immediate: async () => ({}), read: async () => null } as any })
    const activeInteractiveCode = { lessonId: 'lesson', blockId: 'run', interactionType: 'FIX_AND_RUN' as const, instruction: 'Corrija a soma', language: 'python' as const, code: 'print(1 + 1)', prediction: null, attempts: 2, lastExecution: { stdout: '2\n', stderr: '', exitCode: 0, timedOut: false }, validationResult: { status: 'passed' as const, message: 'Saída validada.' } }
    for await (const _ of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'Explique o resultado', activePage: 'studies', activeInteractiveCode }, new AbortController().signal)) {}
    expect(decodePromptField(providerRequest!, 'STUDY_CONTEXT_BASE64')).toMatchObject({ activeInteractiveCode })
  })

  it('routes the canonically persisted typed draft and records Tutor help once', async () => {
    const manager = new AIProviderManager()
    let providerRequest: AIRequest | null = null
    manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: '', providerId: 'stream', modelId: 'model' }), streamMessage: async function* (request) { providerRequest = request; yield { type: 'completed', response: { content: 'Comece identificando o caso-base.', providerId: 'stream', modelId: 'model' } } }, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) })
    manager.select('stream')
    const requestHelp = vi.fn(() => ({ exerciseId: 'exercise-1', helpCount: 1, hint: 'PRIVATE_GENERATED_HINT' }))
    const activeExercise = { exerciseId: 'exercise-1', roadmapId: 'roadmap-1', moduleId: 'module-1', topicId: 'topic-1', kind: 'FIX_CODE' as const, title: 'Somar itens', statement: 'Some os itens da entrada.', language: 'python' as const, currentCode: 'print("typed before Tutor")', attemptCount: 2, helpUsed: false, progressStatus: 'in_progress' as const, passedTests: 3, totalTests: 5, lastRun: { status: 'executed' as const, passedTests: 0, totalTests: 0, message: 'Execução livre concluída.' }, lastSubmission: { status: 'failed' as const, passedTests: 3, totalTests: 5, message: '3 de 5 testes passaram.' } }
    let canonical = activeExercise
    const getPublicContext = vi.fn(() => canonical)
    requestHelp.mockImplementation(() => { canonical = { ...canonical, helpUsed: true }; return { exerciseId: 'exercise-1', helpCount: 1, hint: 'PRIVATE_GENERATED_HINT' } })
    const service = new WorkspaceCoachService({ repository: new MemoryConversationRepository(), providerManager: manager, getWorkspace: async () => workspace, exerciseService: { getPublicContext, requestHelp } })

    for await (const _ of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'Me dê uma dica para continuar', activePage: 'exercises', activeExercise: { exerciseId: activeExercise.exerciseId } }, new AbortController().signal)) {}

    expect(requestHelp).toHaveBeenCalledTimes(1)
    expect(requestHelp).toHaveBeenCalledWith({ workspaceId: workspace.id, exerciseId: 'exercise-1' })
    expect(getPublicContext).toHaveBeenCalledWith({ workspaceId: workspace.id, exerciseId: 'exercise-1' })
    expect(decodePromptField(providerRequest!, 'STUDY_CONTEXT_BASE64')).toMatchObject({ activeExercise: { ...activeExercise, helpUsed: true } })
    expect(JSON.stringify(decodePromptField(providerRequest!, 'STUDY_CONTEXT_BASE64'))).toContain('typed before Tutor')
    const serialized = JSON.stringify(providerRequest)
    expect(serialized).not.toContain('PRIVATE_REFERENCE')
    expect(serialized).not.toContain('PRIVATE_HIDDEN')
    expect(serialized).not.toContain('PRIVATE_EXPECTED')
    expect(serialized).not.toContain('PRIVATE_GENERATED_HINT')
    expect(serialized).toContain('ajuda graduada')
    expect(serialized).toContain('Não entregue código final')
    expect(serialized).toContain('attemptCount')
  })

  it('does not record exercise help for unrelated or explicitly denied requests', async () => {
    const manager = new AIProviderManager()
    manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: '', providerId: 'stream', modelId: 'model' }), streamMessage: async function* () { yield { type: 'completed', response: { content: 'Tudo bem.', providerId: 'stream', modelId: 'model' } } }, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) })
    manager.select('stream')
    const requestHelp = vi.fn(() => ({ exerciseId: 'exercise-1', helpCount: 1, hint: 'hint' }))
    const getPublicContext = vi.fn(() => ({ exerciseId: 'exercise-1', roadmapId: 'roadmap', moduleId: 'module', topicId: 'topic', kind: 'PROGRAMMING_PROBLEM' as const, title: 'Soma', statement: 'Some.', language: 'python' as const, currentCode: '', attemptCount: 0, helpUsed: false, progressStatus: 'not_started' as const, passedTests: 0, totalTests: 0, lastRun: null, lastSubmission: null }))
    const service = new WorkspaceCoachService({ repository: new MemoryConversationRepository(), providerManager: manager, getWorkspace: async () => workspace, exerciseService: { getPublicContext, requestHelp } })
    const activeExercise = { exerciseId: 'exercise-1' }

    for (const content of ['Vou tentar outra entrada.', 'Não quero ajuda, só registre minha mensagem.']) for await (const _ of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content, activePage: 'exercises', activeExercise }, new AbortController().signal)) {}

    expect(requestHelp).not.toHaveBeenCalled()
  })

  it('ignores exercise identifiers outside the exercises page and missing canonical exercises', async () => {
    const manager = new AIProviderManager(); let providerRequest: AIRequest | null = null
    manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: '', providerId: 'stream', modelId: 'model' }), streamMessage: async function* (request) { providerRequest = request; yield { type: 'completed', response: { content: 'Tudo bem.', providerId: 'stream', modelId: 'model' } } }, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) }); manager.select('stream')
    const requestHelp = vi.fn(() => ({ exerciseId: 'exercise-1', helpCount: 1, hint: 'hint' })); const getPublicContext = vi.fn(() => null)
    const service = new WorkspaceCoachService({ repository: new MemoryConversationRepository(), providerManager: manager, getWorkspace: async () => workspace, exerciseService: { getPublicContext, requestHelp } })
    for await (const _ of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'Me ajude', activePage: 'studies', activeExercise: { exerciseId: 'exercise-1' } }, new AbortController().signal)) {}
    expect(getPublicContext).not.toHaveBeenCalled(); expect(requestHelp).not.toHaveBeenCalled(); expect(decodePromptField(providerRequest!, 'STUDY_CONTEXT_BASE64')).toBeNull()
    for await (const _ of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'Me ajude', activePage: 'exercises', activeExercise: { exerciseId: 'missing' } }, new AbortController().signal)) {}
    expect(getPublicContext).toHaveBeenCalledWith({ workspaceId: workspace.id, exerciseId: 'missing' }); expect(requestHelp).not.toHaveBeenCalled(); expect(decodePromptField(providerRequest!, 'STUDY_CONTEXT_BASE64')).toBeNull()
  })

  it('allows repeated Tutor help while the repository keeps HELP_USED evidence idempotent', async () => {
    const manager = new AIProviderManager(); let providerRequest: AIRequest | null = null
    manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: '', providerId: 'stream', modelId: 'model' }), streamMessage: async function* (request) { providerRequest = request; yield { type: 'completed', response: { content: 'Outra pista.', providerId: 'stream', modelId: 'model' } } }, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) }); manager.select('stream')
    const canonical = { exerciseId: 'exercise-1', roadmapId: 'roadmap', moduleId: 'module', topicId: 'topic', kind: 'FIX_CODE' as const, title: 'Soma', statement: 'Corrija.', language: 'python' as const, currentCode: 'print(0)', lastRun: null, lastSubmission: null, passedTests: 0, totalTests: 0, attemptCount: 1, helpUsed: true, progressStatus: 'in_progress' as const }
    const requestHelp = vi.fn(() => ({ exerciseId: 'exercise-1', helpCount: 1, hint: 'private' })); const getPublicContext = vi.fn(() => canonical)
    const service = new WorkspaceCoachService({ repository: new MemoryConversationRepository(), providerManager: manager, getWorkspace: async () => workspace, exerciseService: { getPublicContext, requestHelp } })
    for await (const _ of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'Preciso de outra dica', activePage: 'exercises', activeExercise: { exerciseId: 'exercise-1' } }, new AbortController().signal)) {}
    expect(requestHelp).toHaveBeenCalledTimes(1); expect(decodePromptField(providerRequest!, 'STUDY_CONTEXT_BASE64')).toMatchObject({ activeExercise: canonical })
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
    const service = new WorkspaceCoachService({ repository: new MemoryConversationRepository(), providerManager: manager, getWorkspace: async () => workspace, getCurrentContext: async () => currentContext(true), studyLessonService: { adaptSection, getPreferences: () => preferences, updatePreferences } })
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
    const service = new WorkspaceCoachService({ repository: new MemoryConversationRepository(), providerManager: manager, getWorkspace: async () => workspace, getCurrentContext: async () => currentContext(true), studyLessonService: { adaptSection: async (input) => ({ id: crypto.randomUUID(), workspaceId: workspace.id, lessonId: input.lessonId, blockId: input.blockId, revision: 1, reason: input.instruction, mode: input.mode ?? 'CUSTOM', originalBlock: { id: input.blockId, type: 'explanation', title: 'T', content: 'Original' }, adaptedBlock: { id: input.blockId, type: 'explanation', title: 'T', content: 'Adaptado' }, isActive: true, providerId: 'stream', modelId: 'model', createdAt: 1 }), getPreferences: () => preferences, updatePreferences: (_workspaceId, value) => { preferences = value; return value } } })
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
  it('reads bounded context for at most two rounds before streaming the final answer', async () => { const repository = new MemoryConversationRepository(); const manager = new AIProviderManager(); let decisions = 0; let streamedRequest: AIRequest | null = null; manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: JSON.stringify(decisions++ === 0 ? { kind: 'context_read', requests: [{ resource: 'materials', query: 'apostila' }] } : { kind: 'context_read', requests: [{ resource: 'materials', id: 'material-id', pageNumber: 2 }] }), providerId: 'stream', modelId: 'model' }), streamMessage: async function* (request) { streamedRequest = request; yield { type: 'completed', response: { content: 'Li a página.', providerId: 'stream', modelId: 'model' } } }, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) }); manager.select('stream'); const reads: unknown[] = []; const service = new WorkspaceCoachService({ repository, providerManager: manager, getWorkspace: async () => workspace, getCurrentContext: async () => currentContext(false), contextHub: { immediate: async () => ({ workspaceId: workspace.id }), read: async (_workspaceId: string, resource: string, options: unknown) => { reads.push([resource, options]); return { content: resource === 'materials' ? 'conteúdo' : '' } } } as any }); for await (const _ of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'Explique a apostila' }, new AbortController().signal)) {} expect(reads).toHaveLength(2); expect(decodePromptField(streamedRequest!, 'CONTEXT_READ_RESULTS_BASE64')).toHaveLength(2) })
  it('returns only the authoritative backend action result without streaming a claim', async () => { const repository = new MemoryConversationRepository(); const manager = new AIProviderManager(); let streamed = false; manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: JSON.stringify({ kind: 'workspace_action', action: { type: 'notes.add', arguments: { content: 'Revisar arrays' } } }), providerId: 'stream', modelId: 'model' }), streamMessage: async function* () { streamed = true; yield { type: 'completed', response: { content: 'inventado', providerId: 'stream', modelId: 'model' } } }, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) }); manager.select('stream'); const service = new WorkspaceCoachService({ repository, providerManager: manager, getWorkspace: async () => workspace, contextHub: { immediate: async () => ({}), read: async () => null } as any, workspaceActions: { execute: async () => ({ status: 'failed', message: 'Não consegui aplicar esta ação.', persisted: false }) } as any }); const output: string[] = []; for await (const delta of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'Adicione às notas: revisar arrays' }, new AbortController().signal)) output.push(delta); expect(output).toEqual(['Não consegui aplicar esta ação.']); expect(streamed).toBe(false); expect(repository.messages.at(-1)?.content).toBe('Não consegui aplicar esta ação.') })
  it('does not execute a model-proposed action without explicit user authorization', async () => { const repository = new MemoryConversationRepository(); const manager = new AIProviderManager(); let executions = 0; manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: JSON.stringify({ kind: 'workspace_action', action: { type: 'notes.add', arguments: { content: 'Conteúdo sugerido' } } }), providerId: 'stream', modelId: 'model' }), streamMessage: async function* () {}, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) }); manager.select('stream'); const service = new WorkspaceCoachService({ repository, providerManager: manager, getWorkspace: async () => workspace, contextHub: { immediate: async () => ({}), read: async () => null } as any, workspaceActions: { execute: async () => { executions += 1; return { status: 'succeeded', message: 'feito' } } } as any }); const output: string[] = []; for await (const delta of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'O que devo revisar?' }, new AbortController().signal)) output.push(delta); expect(executions).toBe(0); expect(output.join('')).toContain('Peça explicitamente') })
  it('rejects negated authorization and model-invented note content', async () => { const repository = new MemoryConversationRepository(); const manager = new AIProviderManager(); let executions = 0; manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: JSON.stringify({ kind: 'workspace_action', action: { type: 'notes.add', arguments: { content: 'Conteúdo inventado' } } }), providerId: 'stream', modelId: 'model' }), streamMessage: async function* () {}, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) }); manager.select('stream'); const service = new WorkspaceCoachService({ repository, providerManager: manager, getWorkspace: async () => workspace, contextHub: { immediate: async () => ({}), read: async () => null } as any, workspaceActions: { execute: async () => { executions += 1; return { status: 'succeeded', message: 'feito' } } } as any }); for (const content of ['Não adicione às notas: Conteúdo inventado', 'Adicione às notas: outro conteúdo']) for await (const _ of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content }, new AbortController().signal)) {} expect(executions).toBe(0) })
  it('rejects vague note payload authorization', async () => { const repository = new MemoryConversationRepository(); const manager = new AIProviderManager(); let executions = 0; manager.register({ id: 'stream', name: 'Stream', testConnection: async () => {}, sendMessage: async () => ({ content: JSON.stringify({ kind: 'workspace_action', action: { type: 'notes.add', arguments: { content: 'isso' } } }), providerId: 'stream', modelId: 'model' }), streamMessage: async function* () {}, getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }) }); manager.select('stream'); const service = new WorkspaceCoachService({ repository, providerManager: manager, getWorkspace: async () => workspace, contextHub: { immediate: async () => ({}), read: async () => null } as any, workspaceActions: { execute: async () => { executions += 1; return { status: 'succeeded', message: 'feito' } } } as any }); for await (const _ of service.streamMessage(workspace.id, { requestId: crypto.randomUUID(), workspaceId: workspace.id, content: 'Adicione isso às notas' }, new AbortController().signal)) {} expect(executions).toBe(0) })
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
