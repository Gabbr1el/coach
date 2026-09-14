import type { AIProvider, AIResponse } from '../ai/ai-provider'
import { createHash } from 'node:crypto'
import type { AIProviderManager } from '../ai/ai-provider-manager'
import { extractJsonDocument, sanitizedResponsePreview, structuredErrorDetail, structuredOutputDebugEnabled } from '../ai/structured-json'
import { generatedRoadmapProposalSchema, repairCurriculumPrerequisites, roadmapProposalSchema, validateCurriculum, type CurriculumSource, type LearningPathState, type Roadmap, type RoadmapRebuildImpact, type RoadmapRebuildPreview, type RoadmapResource } from '../../shared/contracts/roadmap-contract'
import { z } from 'zod'
import type { Workspace } from '../../shared/contracts/workspace-contract'
import type { CurriculumSourceService } from './curriculum-source-service'
import type { MaterialReadResult, MaterialSearchResult, MaterialSummary } from '../../shared/contracts/material-contract'
import type { HeavyGenerationRunner } from '../ai/heavy-generation-queue'
import { roadmapMutationFingerprint } from '../workspaces/content-revision-fingerprint'

export interface RoadmapRepository { findCurrent(workspaceId: string): Roadmap | null; nextVersion(workspaceId: string): number; create(roadmap: Roadmap): Roadmap; activate(roadmap: Roadmap): Roadmap; accept(workspaceId: string, roadmapId: string, now: number): Roadmap; setContentRevision?(roadmapId: string, revision: number, inputHash: string): void; progressedTopicIds?(workspaceId: string): string[]; saveRebuildPreview?(preview: RoadmapRebuildPreview): RoadmapRebuildPreview; findLatestRebuildPreview?(workspaceId: string): RoadmapRebuildPreview | null; findRebuildPreview?(workspaceId: string, previewId: string): RoadmapRebuildPreview | null; applyRebuildPreview?(preview: RoadmapRebuildPreview, now: number, mutationFingerprint: string): Roadmap; getLearningPathState(workspaceId: string): LearningPathState | null; setLearningPathState(state: LearningPathState): LearningPathState; recoverInterrupted(workspaceId: string, now: number, staleBefore: number, retryAfter: number): LearningPathState | null; tryStartGeneration(workspaceId: string, activeRoadmapId: string | null, now: number, staleBefore: number): boolean; listWaitingForProvider(): string[] }
export interface RoadmapAcademicContext { difficulties: string[]; deadline: number | null; availability: Array<{ weekday: number; minutes: number }>; knownContext: string[] }
export interface RoadmapMaterialProvider { list(workspaceId: string): MaterialSummary[]; search(workspaceId: string, query: string, materialIds?: string[]): MaterialSearchResult[]; overview(workspaceId: string, materialId: string): MaterialReadResult; readPage(workspaceId: string, materialId: string, pageNumber: number): MaterialReadResult }

export function hasGenericModules(proposal: ReturnType<typeof roadmapProposalSchema.parse>): boolean { const vague = /^(fundamentos|introdução|introducao|revisar conceitos?|prática guiada|pratica guiada|prática independente|projeto integrador)$/i; const rendered = JSON.stringify(proposal).toLocaleLowerCase(); return /vocabulário e mapa|mapa de 10 conceitos|mecanismos centrais|aplicação guiada|projeto independente/.test(rendered) || proposal.modules.some((item) => vague.test(item.title.trim()) || item.topics.some((topic) => /^(conceitos? (básicos|essenciais)|revisar conceitos?)$/i.test(topic))) }
export function hasSetupAsPrimaryCurriculum(proposal: ReturnType<typeof roadmapProposalSchema.parse>): boolean { const setup = /\b(?:instala(?:r|ção)|configura(?:r|ção)|setup|vers(?:ão|ao)|path|vari[aá]vel de ambiente|ide|editor|download)\b/i; const conceptual = /\b(?:conceito|sintaxe|print|sa[ií]da|valor|vari[aá]ve|tipo|express(?:ão|ao)|controle|fun(?:ção|cao)|estrutura|algoritmo)\b/i; return proposal.modules.some((module, index) => index < 2 && setup.test(`${module.title} ${module.objective} ${module.topics.join(' ')}`) && !conceptual.test(`${module.title} ${module.objective} ${module.topics.join(' ')}`)) }

export type LearningPathErrorCode = 'PROVIDER_UNAVAILABLE' | 'PROVIDER_TIMEOUT' | 'PROVIDER_REQUEST_FAILED' | 'PROVIDER_INVALID_RESPONSE' | 'JSON_EXTRACTION_FAILED' | 'ROADMAP_SCHEMA_INVALID' | 'ROADMAP_GENERIC_REJECTED' | 'CURRICULUM_SOURCE_FAILED' | 'ROADMAP_PERSISTENCE_FAILED' | 'UNKNOWN_GENERATION_ERROR'
type LearningPathStage = 'workspace' | 'academic_context' | 'curriculum_sources' | 'provider_route' | 'provider_response' | 'extract_json' | 'generated_schema' | 'roadmap_schema' | 'generic_validation' | 'persistence_activate' | 'learning_path_state'
class LearningPathGenerationError extends Error {
  constructor(readonly code: LearningPathErrorCode, readonly stage: LearningPathStage, message: string, options: { cause?: unknown; response?: string } = {}) { super(message, { cause: options.cause }); this.name = 'LearningPathGenerationError'; this.response = options.response }
  readonly response?: string
}

const RETRY_COOLDOWN = 5 * 60_000
const FAST_RETRY_COOLDOWN = 30_000
const ROADMAP_REQUEST_TIMEOUT_MS = 60_000
const ROADMAP_REPAIR_TIMEOUT_MS = 45_000
function resourceType(source: CurriculumSource): 'roadmap' | 'documentation' | 'course' | 'article' { return source.type === 'outline' ? 'roadmap' : source.type === 'documentation' || source.type === 'reference' ? 'documentation' : source.type === 'educational' ? 'course' : 'article' }
function validRoadmap(roadmap: Roadmap | null): roadmap is Roadmap { return Boolean(roadmap && roadmap.modules.length > 0 && roadmap.modules.every((item) => item.topics.length > 0)) }
function providerUnavailable(error: unknown): boolean { if (!(error instanceof Error)) return false; const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''; return code === 'NETWORK_UNAVAILABLE' || /network|fetch failed|offline|unavailable|connect(?:ion)? refused/i.test(`${error.name} ${error.message}`) }
function providerInvalidResponse(error: unknown): boolean { return error instanceof Error && /empty response|no response body|invalid provider response/i.test(error.message) }
function providerRequestFailed(error: unknown): boolean { return error instanceof Error && (error.name === 'AbortError' || /timeout|timed out|aborted|cancel|rate.limit|quota|credential|model|access/i.test(`${error.name} ${error.message}`) || 'code' in error) }
function diagnosticError(error: unknown, fallbackStage: LearningPathStage): LearningPathGenerationError { if (error instanceof LearningPathGenerationError) return error; if (error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'REQUEST_TIMEOUT') return new LearningPathGenerationError('PROVIDER_TIMEOUT', 'provider_response', structuredErrorDetail(error), { cause: error }); if (providerUnavailable(error)) return new LearningPathGenerationError('PROVIDER_UNAVAILABLE', 'provider_response', structuredErrorDetail(error), { cause: error }); if (providerInvalidResponse(error)) return new LearningPathGenerationError('PROVIDER_INVALID_RESPONSE', 'provider_response', structuredErrorDetail(error), { cause: error }); if (providerRequestFailed(error)) return new LearningPathGenerationError('PROVIDER_REQUEST_FAILED', 'provider_response', structuredErrorDetail(error), { cause: error }); return new LearningPathGenerationError('UNKNOWN_GENERATION_ERROR', fallbackStage, structuredErrorDetail(error), { cause: error }) }
function logProgress(workspaceId: string, stage: LearningPathStage, detail: Record<string, unknown> = {}): void { if (structuredOutputDebugEnabled()) console.info('[LearningPath] stage', { workspaceId, stage, ...detail }) }
function logFailure(workspaceId: string, error: LearningPathGenerationError): void { if (!structuredOutputDebugEnabled()) return; console.error('[LearningPath] generation failed', { workspaceId, stage: error.stage, errorCode: error.code, errorName: error.cause instanceof Error ? error.cause.name : error.name, errorMessage: error.message, cause: error.cause instanceof Error && error.cause.cause instanceof Error ? error.cause.cause.message : undefined, responsePreview: error.response ? sanitizedResponsePreview(error.response) : undefined }) }
function schemaDescription(): string { return '{"title":string,"modules":[exactly 1 {"title":string,"objective":string,"estimatedMinutes":integer 10..2400,"topics":[1..3 strings],"curricularTopics":[one per topics entry {"topic":exact topic string,"concepts":[1..3 {"key":stable lowercase key,"name":string,"aliases":string[],"domain":string}],"assessmentIntents":[1..3 {"key":stable lowercase key,"conceptKey":declared key,"objective":what is evaluated,"evidenceType":"multiple_choice"|"code_execution"|"prediction"|"constructed_response","difficulty":"introductory"|"standard"|"challenge","prerequisiteConceptKeys":stable keys introduced in this or an earlier topic[]}]}],"outcomes":[1..3 strings],"practice":string,"completionCriteria":[1..3 strings],"sourceIds":[0..4 provided IDs]}]}' }
function semanticKey(value: string): string { return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9+#]+/g, ' ').trim() }
function materialSourceId(materialId: string, pageNumber: number): string { return `material:${materialId}:${pageNumber}` }
function materialHash(content: string): string { return createHash('sha256').update(content).digest('hex') }
const adaptationResponseSchema = z.object({ relevance: z.enum(['compatible', 'partial', 'irrelevant']), summary: z.string().trim().min(1).max(2000), reasons: z.array(z.string().trim().min(1).max(500)).max(30), proposal: generatedRoadmapProposalSchema.nullable() }).strict().superRefine((value, context) => { if (value.relevance !== 'irrelevant' && !value.proposal) context.addIssue({ code: 'custom', path: ['proposal'], message: 'Relevant material requires an adaptation proposal' }); if (value.relevance === 'irrelevant' && value.proposal) context.addIssue({ code: 'custom', path: ['proposal'], message: 'Irrelevant material cannot propose curriculum changes' }) })

function conceptKeys(module: Pick<Roadmap['modules'][number], 'curricularTopics'>): Set<string> { return new Set((module.curricularTopics ?? []).flatMap((topic) => topic.concepts.map((concept) => concept.key))) }
function topicConceptKeys(module: Pick<Roadmap['modules'][number], 'curricularTopics'>, topic: string): Set<string> { return new Set(module.curricularTopics?.find((item) => item.topic === topic)?.concepts.map((concept) => concept.key) ?? []) }
function overlap(left: Set<string>, right: Set<string>): number { let count = 0; for (const key of left) if (right.has(key)) count += 1; return count }

export class RoadmapService {
  private readonly generating = new Map<string, Promise<LearningPathState>>()
  constructor(private readonly repository: RoadmapRepository, private readonly providers: AIProviderManager, private readonly getWorkspace: (id: string) => Promise<Workspace | null>, private readonly getAcademicContext: (workspaceId: string) => RoadmapAcademicContext = () => ({ difficulties: [], deadline: null, availability: [], knownContext: [] }), private readonly curriculumSources?: CurriculumSourceService, private readonly now = Date.now, private readonly createId = () => crypto.randomUUID(), private readonly materials?: RoadmapMaterialProvider, private readonly heavyQueue?: HeavyGenerationRunner, private onRoadmapChanged?: (roadmap: Roadmap, atomicallyAdopted: boolean) => void) {}
  setRoadmapChangedHandler(handler: (roadmap: Roadmap, atomicallyAdopted: boolean) => void): void { this.onRoadmapChanged = handler }
  retryWaitingForProvider(): void { for (const workspaceId of this.repository.listWaitingForProvider()) void this.ensureLearningPath(workspaceId, { forceProviderRetry: true }).catch(() => {}) }
  async get(workspaceId: string): Promise<Roadmap | null> { await this.requireWorkspace(workspaceId); return this.repository.findCurrent(workspaceId) }
  async getLearningPathState(workspaceId: string): Promise<LearningPathState> {
    await this.requireWorkspace(workspaceId)
    const now = this.now()
    const state = this.repository.recoverInterrupted(workspaceId, now, now - RETRY_COOLDOWN, now + FAST_RETRY_COOLDOWN) ?? this.repository.setLearningPathState({ workspaceId, status: 'idle', activeRoadmapId: null, lastAttemptAt: null, retryAfter: null, lastErrorCode: null, updatedAt: now })
    if (state.status === 'ready') {
      const roadmap = this.repository.findCurrent(workspaceId)
      if (!validRoadmap(roadmap) || roadmap.id !== state.activeRoadmapId) return this.repository.setLearningPathState({ ...state, status: 'failed_retryable', activeRoadmapId: validRoadmap(roadmap) ? roadmap.id : null, retryAfter: now, lastErrorCode: 'ROADMAP_PERSISTENCE_FAILED', updatedAt: now })
    }
    return state
  }
  ensureLearningPath(workspaceId: string, options: { forceProviderRetry?: boolean } = {}): Promise<LearningPathState> {
    const running = this.generating.get(workspaceId); if (running) return running
    const task = this.ensureOnce(workspaceId, options).finally(() => this.generating.delete(workspaceId)); this.generating.set(workspaceId, task); return task
  }
  ensureLearningPathWithMaterials(workspaceId: string, materialIds: string[]): Promise<LearningPathState> {
    if (!materialIds.length) return this.ensureLearningPath(workspaceId, { forceProviderRetry: true })
    const running = this.generating.get(workspaceId); if (running) return running
    const task = this.ensureWithMaterialsOnce(workspaceId, materialIds).finally(() => this.generating.delete(workspaceId)); this.generating.set(workspaceId, task); return task
  }
  private async ensureWithMaterialsOnce(workspaceId: string, materialIds: string[]): Promise<LearningPathState> {
    await this.requireWorkspace(workspaceId)
    const existing = this.repository.findCurrent(workspaceId)
    if (existing?.generationKind === 'ai_generated' && validRoadmap(existing)) return this.repository.setLearningPathState({ workspaceId, status: 'ready', activeRoadmapId: existing.id, lastAttemptAt: this.now(), retryAfter: null, lastErrorCode: null, updatedAt: this.now() })
    const provider = this.providers.route('roadmap'); const now = this.now()
    if (!provider) return this.repository.setLearningPathState({ workspaceId, status: 'waiting_for_provider', activeRoadmapId: null, lastAttemptAt: now, retryAfter: now + RETRY_COOLDOWN, lastErrorCode: 'PROVIDER_UNAVAILABLE', updatedAt: now })
    if (!this.repository.tryStartGeneration(workspaceId, null, now, now - RETRY_COOLDOWN)) return this.repository.getLearningPathState(workspaceId)!
    try {
      const workspace = await this.requireWorkspace(workspaceId)
      const generate = () => this.generateCandidate(workspace, provider, undefined, materialIds)
      const candidate = await (this.heavyQueue?.run(generate) ?? generate())
      const createdAt = this.now()
      const roadmap = this.repository.activate({ id: this.createId(), workspaceId, title: candidate.proposal.title, status: 'accepted', generationKind: 'ai_generated', version: this.repository.nextVersion(workspaceId), providerId: candidate.response.providerId, modelId: candidate.response.modelId, modules: candidate.proposal.modules.map((item, index) => ({ id: this.createId(), ...item, position: index + 1, status: index === 0 ? 'active' : 'locked' })), createdAt, updatedAt: createdAt })
      return this.repository.setLearningPathState({ workspaceId, status: 'ready', activeRoadmapId: roadmap.id, lastAttemptAt: now, retryAfter: null, lastErrorCode: null, updatedAt: this.now() })
    } catch (error) { const diagnostic = diagnosticError(error, 'learning_path_state'); return this.repository.setLearningPathState({ workspaceId, status: diagnostic.code === 'PROVIDER_UNAVAILABLE' ? 'waiting_for_provider' : 'failed_retryable', activeRoadmapId: null, lastAttemptAt: now, retryAfter: now + (diagnostic.code === 'PROVIDER_UNAVAILABLE' ? RETRY_COOLDOWN : FAST_RETRY_COOLDOWN), lastErrorCode: diagnostic.code, updatedAt: this.now() }) }
  }
  private async ensureOnce(workspaceId: string, options: { forceProviderRetry?: boolean }): Promise<LearningPathState> {
    await this.requireWorkspace(workspaceId)
    const now = this.now()
    const current = this.repository.findCurrent(workspaceId)
    const state = this.repository.recoverInterrupted(workspaceId, now, now - RETRY_COOLDOWN, now + FAST_RETRY_COOLDOWN)
    if (current?.generationKind === 'ai_generated' && validRoadmap(current)) return this.repository.setLearningPathState({ workspaceId, status: 'ready', activeRoadmapId: current.id, lastAttemptAt: state?.lastAttemptAt ?? null, retryAfter: null, lastErrorCode: null, updatedAt: now })
    if (!options.forceProviderRetry && state?.retryAfter && state.retryAfter > now) return state
    const provider = this.providers.route('roadmap')
    if (!provider) return this.repository.setLearningPathState({ workspaceId, status: 'waiting_for_provider', activeRoadmapId: validRoadmap(current) ? current.id : null, lastAttemptAt: now, retryAfter: now + RETRY_COOLDOWN, lastErrorCode: 'PROVIDER_UNAVAILABLE', updatedAt: now })
    logProgress(workspaceId, 'provider_route', { providerId: provider.id, providerName: provider.name })
    if (!this.repository.tryStartGeneration(workspaceId, validRoadmap(current) ? current.id : null, now, now - RETRY_COOLDOWN)) return this.repository.getLearningPathState(workspaceId)!
    try {
      const roadmap = await (this.heavyQueue?.run(() => this.generateWithProvider(workspaceId, provider)) ?? this.generateWithProvider(workspaceId, provider))
      const persisted = this.repository.findCurrent(workspaceId)
      if (!validRoadmap(persisted) || persisted.id !== roadmap.id) throw new LearningPathGenerationError('ROADMAP_PERSISTENCE_FAILED', 'learning_path_state', 'Activated roadmap could not be read back')
      const ready = this.repository.setLearningPathState({ workspaceId, status: 'ready', activeRoadmapId: persisted.id, lastAttemptAt: now, retryAfter: null, lastErrorCode: null, updatedAt: this.now() }); logProgress(workspaceId, 'learning_path_state', { status: ready.status, activeRoadmapId: ready.activeRoadmapId }); return ready
    } catch (error) {
      const diagnostic = diagnosticError(error, 'learning_path_state')
      logFailure(workspaceId, diagnostic)
      const unavailable = diagnostic.code === 'PROVIDER_UNAVAILABLE'
      return this.repository.setLearningPathState({ workspaceId, status: unavailable ? 'waiting_for_provider' : 'failed_retryable', activeRoadmapId: validRoadmap(current) ? current.id : null, lastAttemptAt: now, retryAfter: now + (unavailable ? RETRY_COOLDOWN : FAST_RETRY_COOLDOWN), lastErrorCode: diagnostic.code, updatedAt: this.now() })
    }
  }
  generate(workspaceId: string, instruction?: string): Promise<Roadmap> { const task = () => this.generateWithProvider(workspaceId, this.providers.route('roadmap'), instruction); return this.heavyQueue?.run(task) ?? task() }
  async prepareGeneration(workspaceId: string, revision: number, inputHash: string, signal: AbortSignal, materialIds: string[] = []): Promise<{ publish(): Roadmap }> {
    const workspace = await this.requireWorkspace(workspaceId)
    const provider = this.providers.route('roadmap')
    if (!provider) throw new LearningPathGenerationError('PROVIDER_UNAVAILABLE', 'provider_route', 'Roadmap provider is unavailable')
    const candidate = await this.generateCandidate(workspace, provider, undefined, materialIds, signal)
    return { publish: () => {
      const now = this.now()
      const roadmap = this.repository.activate({ id: this.createId(), workspaceId, title: candidate.proposal.title, status: 'accepted', generationKind: 'ai_generated', version: this.repository.nextVersion(workspaceId), providerId: candidate.response.providerId, modelId: candidate.response.modelId, modules: candidate.proposal.modules.map((item, index) => ({ id: this.createId(), ...item, position: index + 1, status: index === 0 ? 'active' : 'locked' })), createdAt: now, updatedAt: now })
      this.repository.setContentRevision?.(roadmap.id, revision, inputHash)
      return roadmap
    } }
  }
  async getRebuildPreview(workspaceId: string): Promise<RoadmapRebuildPreview | null> { await this.requireWorkspace(workspaceId); return this.repository.findLatestRebuildPreview?.(workspaceId) ?? null }
  async previewRebuild(input: { workspaceId: string; materialIds: string[]; instruction?: string }): Promise<RoadmapRebuildPreview> {
    if (!this.materials || !this.repository.saveRebuildPreview) throw new Error('Curricular material rebuild is unavailable')
    const workspace = await this.requireWorkspace(input.workspaceId)
    const current = this.repository.findCurrent(input.workspaceId)
    if (!current) throw new Error('Current roadmap not found')
    const approved = new Map(this.materials.list(input.workspaceId).filter((item) => item.status === 'ready').map((item) => [item.id, item]))
    if (input.materialIds.some((id) => !approved.has(id))) throw new Error('Only approved materials can rebuild the roadmap')
    const selected = input.materialIds.map((id) => approved.get(id)!)
    const relevantIds = selected.filter((item) => item.relevance > 0 && !(item.semanticAnalysis?.relevance === 'unrelated' && item.semanticAnalysis.confidence >= 0.8)).map((item) => item.id)
    if (!relevantIds.length) return this.repository.saveRebuildPreview({ id: this.createId(), workspaceId: input.workspaceId, currentRoadmapId: current.id, title: current.title, modules: current.modules, materialIds: input.materialIds, impact: { relevance: 'irrelevant', summary: 'O material não é relevante para o objetivo atual e não altera a adaptação da Trilha.', preservedModuleIds: current.modules.map((module) => module.id), preservedTopicIds: current.modules.flatMap((module) => module.topics.map((topic) => `${module.id}:${topic}`)), changedTopicIds: [], addedTopics: [], removedTopics: [], unsafeProgressTopicIds: [], reasons: ['A cobertura do material não corresponde ao objetivo curricular do Workspace.'], requiresAcknowledgement: false }, status: 'pending', appliedRoadmapId: null, createdAt: this.now(), resolvedAt: null })
    const provider = this.providers.route('roadmap')
    if (!provider) throw new LearningPathGenerationError('PROVIDER_UNAVAILABLE', 'provider_route', 'Roadmap provider is unavailable')
    const materialCatalog = relevantIds.map((id) => approved.get(id)!).map((item) => ({ id: item.id, name: item.name, role: item.role ?? 'reference', relevance: item.relevance, semanticAnalysis: item.semanticAnalysis ?? null, excerpt: this.materials!.overview(input.workspaceId, item.id).content }))
    const request = { messages: [{ role: 'system' as const, content: `Analise materiais aprovados e proponha uma adaptação da Trilha existente, nunca uma nova Trilha nem uma reconstrução cega. Retorne somente JSON estrito {relevance:"compatible"|"partial"|"irrelevant",summary:string,reasons:string[],proposal:${schemaDescription()}|null}. Se irrelevante, proposal deve ser null. Preserve conceitos canônicos equivalentes reutilizando exatamente suas keys; conteúdo do professor informa cobertura, terminologia e ênfase, mas não deve copiar cegamente sua pedagogia. Mantenha tópicos válidos; adicione ou reordene apenas com justificativa de cobertura. Remoção é excepcional e deve aparecer explicitamente na proposta para confirmação destrutiva posterior. Base define cobertura, priority altera ênfase e ordem, reference apenas sustenta explicações. Use somente sourceIds de material fornecidos.` }, { role: 'user' as const, content: JSON.stringify({ workspace: { subject: workspace.name, objective: workspace.objective }, currentRoadmap: current, instruction: input.instruction ?? null, approvedMaterials: materialCatalog }) }], maxOutputTokens: 7000, signal: AbortSignal.timeout(300_000) }
    const task = () => provider.sendMessage(request)
    const response = await (this.heavyQueue?.run(task) ?? task())
    const adaptation = adaptationResponseSchema.parse(extractJsonDocument(response.content))
    if (adaptation.relevance === 'irrelevant' || !adaptation.proposal) return this.repository.saveRebuildPreview({ id: this.createId(), workspaceId: input.workspaceId, currentRoadmapId: current.id, title: current.title, modules: current.modules, materialIds: input.materialIds, impact: { relevance: 'irrelevant', summary: adaptation.summary, preservedModuleIds: current.modules.map((module) => module.id), preservedTopicIds: current.modules.flatMap((module) => module.topics.map((topic) => `${module.id}:${topic}`)), changedTopicIds: [], addedTopics: [], removedTopics: [], unsafeProgressTopicIds: [], reasons: adaptation.reasons, requiresAcknowledgement: false }, status: 'pending', appliedRoadmapId: null, createdAt: this.now(), resolvedAt: null })
    const allowed = new Map<string, RoadmapResource>()
    for (const item of materialCatalog) for (const page of this.materials.overview(input.workspaceId, item.id).pageNumbers) { const content = this.materials.readPage(input.workspaceId, item.id, page).content; allowed.set(materialSourceId(item.id, page), { kind: 'material', title: item.name, type: 'material', materialId: item.id, pageNumber: page, role: item.role, excerptHash: materialHash(content) }) }
    const proposal = roadmapProposalSchema.parse({ title: adaptation.proposal.title, modules: adaptation.proposal.modules.map(({ sourceIds, ...module }) => ({ ...module, resources: sourceIds.map((id) => allowed.get(id)).filter((item): item is RoadmapResource => Boolean(item)) })) })
    validateCurriculum(proposal.modules)
    const preservedTopicIds: string[] = []
    const unused = new Set(current.modules)
    const modules = proposal.modules.map((module, index) => {
      const keys = conceptKeys(module)
      const old = [...unused].sort((a, b) => overlap(conceptKeys(b), keys) - overlap(conceptKeys(a), keys)).find((item) => overlap(conceptKeys(item), keys) > 0) ?? [...unused].find((item) => semanticKey(item.title) === semanticKey(module.title))
      if (old) unused.delete(old)
      const oldTopics = new Map(old?.topics.map((topic) => [semanticKey(topic), topic]) ?? [])
      const usedOldTopics = new Set<string>()
      const topics = module.topics.map((topic) => { const keys = topicConceptKeys(module, topic); const equivalent = old?.topics.find((candidate) => !usedOldTopics.has(candidate) && (overlap(topicConceptKeys(old, candidate), keys) > 0 || semanticKey(candidate) === semanticKey(topic))); if (equivalent) { usedOldTopics.add(equivalent); preservedTopicIds.push(`${old!.id}:${equivalent}`); return equivalent } return oldTopics.get(semanticKey(topic)) ?? topic })
      const curricularTopics = module.curricularTopics?.map((topic, topicIndex) => ({ ...topic, topic: topics[topicIndex]! }))
      return { id: old?.id ?? this.createId(), ...module, topics, curricularTopics, position: index + 1, status: old?.status ?? (index === 0 ? 'active' as const : 'locked' as const) }
    })
    const oldTopicIds = current.modules.flatMap((module) => module.topics.map((topic) => `${module.id}:${topic}`))
    const nextTopicIds = modules.flatMap((module) => module.topics.map((topic) => `${module.id}:${topic}`))
    const removedTopics = oldTopicIds.filter((id) => !nextTopicIds.includes(id))
    const progressed = new Set(this.repository.progressedTopicIds?.(input.workspaceId) ?? [])
    const unsafeProgressTopicIds = removedTopics.filter((id) => progressed.has(id))
    const changedTopicIds = preservedTopicIds.filter((id) => { const separator = id.indexOf(':'); const oldModule = current.modules.find((item) => item.id === id.slice(0, separator)); const nextModule = modules.find((item) => item.id === id.slice(0, separator)); const topic = id.slice(separator + 1); return JSON.stringify(oldModule?.curricularTopics?.find((item) => item.topic === topic)) !== JSON.stringify(nextModule?.curricularTopics?.find((item) => item.topic === topic)) })
    const impact: RoadmapRebuildImpact = { relevance: adaptation.relevance, summary: adaptation.summary, preservedModuleIds: modules.filter((module) => current.modules.some((old) => old.id === module.id)).map((module) => module.id), preservedTopicIds, changedTopicIds, addedTopics: nextTopicIds.filter((id) => !oldTopicIds.includes(id)), removedTopics, unsafeProgressTopicIds, reasons: adaptation.reasons, requiresAcknowledgement: removedTopics.length > 0 }
    const preview: RoadmapRebuildPreview = { id: this.createId(), workspaceId: input.workspaceId, currentRoadmapId: current.id, title: proposal.title, modules, materialIds: input.materialIds, impact, status: 'pending', appliedRoadmapId: null, createdAt: this.now(), resolvedAt: null }
    return this.repository.saveRebuildPreview(preview)
  }
  async applyRebuild(input: { workspaceId: string; previewId: string; acknowledgeUnsafeChanges: boolean }): Promise<Roadmap> { await this.requireWorkspace(input.workspaceId); if (!this.repository.findRebuildPreview || !this.repository.applyRebuildPreview) throw new Error('Curricular material adaptation is unavailable'); const preview = this.repository.findRebuildPreview(input.workspaceId, input.previewId); if (!preview) throw new Error('Roadmap adaptation preview not found'); if (preview.status === 'stale') throw new Error('Roadmap adaptation preview is stale'); if (preview.impact.relevance === 'irrelevant') throw new Error('Irrelevant material cannot alter the curriculum'); if (preview.impact.requiresAcknowledgement && !input.acknowledgeUnsafeChanges) throw new Error('Destructive curriculum changes require explicit acknowledgement'); const roadmap = this.repository.applyRebuildPreview(preview, this.now(), roadmapMutationFingerprint(preview)); this.onRoadmapChanged?.(roadmap, true); return roadmap }
  private async generateWithProvider(workspaceId: string, provider: AIProvider | null, instruction?: string): Promise<Roadmap> {
    if (!provider) throw new LearningPathGenerationError('PROVIDER_UNAVAILABLE', 'provider_route', 'Roadmap provider is unavailable')
    let workspace: Workspace
    try { workspace = await this.requireWorkspace(workspaceId); logProgress(workspaceId, 'workspace', { subject: workspace.name }) } catch (error) { throw new LearningPathGenerationError('UNKNOWN_GENERATION_ERROR', 'workspace', structuredErrorDetail(error), { cause: error }) }
    const candidate = await this.generateCandidate(workspace, provider, instruction)
    const { proposal, response } = candidate
    const now = this.now()
    try { const roadmap = this.repository.activate({ id: this.createId(), workspaceId, title: proposal.title, status: 'accepted', generationKind: 'ai_generated', version: this.repository.nextVersion(workspaceId), providerId: response.providerId, modelId: response.modelId, modules: proposal.modules.map((item, index) => ({ id: this.createId(), ...item, position: index + 1, status: index === 0 ? 'active' : 'locked' })), createdAt: now, updatedAt: now }); logProgress(workspaceId, 'persistence_activate', { roadmapId: roadmap.id }); return roadmap }
    catch (error) { throw new LearningPathGenerationError('ROADMAP_PERSISTENCE_FAILED', 'persistence_activate', structuredErrorDetail(error), { cause: error }) }
  }
  private async generateCandidate(workspace: Workspace, provider: AIProvider, instruction?: string, materialIds: string[] = [], signal?: AbortSignal): Promise<{ proposal: ReturnType<typeof roadmapProposalSchema.parse>; response: AIResponse }> {
    const workspaceId = workspace.id
    let academic: RoadmapAcademicContext
    try { academic = this.getAcademicContext(workspaceId); logProgress(workspaceId, 'academic_context') } catch (error) { throw new LearningPathGenerationError('UNKNOWN_GENERATION_ERROR', 'academic_context', structuredErrorDetail(error), { cause: error }) }
    let sources: CurriculumSource[] = []
    try { sources = await this.curriculumSources?.sourcesFor(workspace) ?? []; logProgress(workspaceId, 'curriculum_sources', { retrievedSources: sources.filter((source) => source.retrieved).length }) } catch (error) { if (structuredOutputDebugEnabled()) console.error('[LearningPath] curriculum source enrichment failed', { workspaceId, stage: 'curriculum_sources', errorCode: 'CURRICULUM_SOURCE_FAILED', errorName: error instanceof Error ? error.name : 'UnknownError', errorMessage: structuredErrorDetail(error) }) }
    const retrieved = sources.filter((source) => source.retrieved && source.excerpt)
    const allowed = new Map<string, RoadmapResource>(retrieved.map((source) => [source.id, { kind: 'web', title: source.title, url: source.url, type: resourceType(source) }]))
    const materialExcerpts: Array<{ sourceId: string; content: string; materialId: string; pageNumber: number; role: string }> = []
    for (const materialId of materialIds) { try { const overview = this.materials?.overview(workspaceId, materialId); if (!overview || overview.material.status !== 'ready') continue; for (const pageNumber of overview.pageNumbers) { const content = this.materials?.readPage(workspaceId, materialId, pageNumber).content ?? ''; if (!content) continue; const sourceId = materialSourceId(materialId, pageNumber); allowed.set(sourceId, { kind: 'material', title: overview.material.name, type: 'material', materialId, pageNumber, role: overview.material.role ?? 'reference', excerptHash: materialHash(content) }); materialExcerpts.push({ sourceId, content, materialId, pageNumber, role: overview.material.role ?? 'reference' }) } } catch {} }
    const request = { messages: [{ role: 'system' as const, content: `Crie o primeiro módulo curto de uma trilha curricular; expansão progressiva ocorrerá depois. Retorne só JSON: ${schemaDescription()}. Cada tópico declara conceitos e intents; keys minúsculas estáveis; intent referencia conceito declarado e apenas pré-requisitos anteriores. Contexto DECLARED é auto-relato, não domínio; só OBSERVED permite pular fundamentos. Iniciante começa pelos fundamentos. Não use setup ou módulo genérico. practice é string. Use apenas sourceIds fornecidos; sem URLs.` }, { role: 'user' as const, content: JSON.stringify({ subject: workspace.name, objective: workspace.objective || null, declaredContext: academic.knownContext.slice(0, 4), observedLearning: academic.difficulties.slice(0, 4), deadline: academic.deadline, availability: academic.availability.slice(0, 7), materialExcerpts: materialExcerpts.slice(0, 3).map((item) => ({ ...item, content: item.content.slice(0, 2000) })), providedSources: [...allowed.keys()].slice(0, 4), instruction: instruction ?? null }) }], maxOutputTokens: 1400, responseFormat: 'json_object' as const }
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(ROADMAP_REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(ROADMAP_REQUEST_TIMEOUT_MS)
    let response: AIResponse
    try { response = await provider.sendMessage({ ...request, signal: requestSignal }); logProgress(workspaceId, 'provider_response', { providerId: response.providerId, modelId: response.modelId, contentLength: response.content.length }) } catch (error) { throw diagnosticError(error, 'provider_response') }
    if (!response.content.trim()) throw new LearningPathGenerationError('PROVIDER_INVALID_RESPONSE', 'provider_response', 'Roadmap provider returned empty content')
    let proposal: ReturnType<typeof roadmapProposalSchema.parse>
    const setupObjective = /\b(?:setup|instala|configura|ambiente|ide|path)\b/i.test(workspace.objective)
    try { proposal = this.parseProposal(workspaceId, response.content, allowed, setupObjective) }
    catch (initialError) {
      const diagnostic = diagnosticError(initialError, 'extract_json')
      if (structuredOutputDebugEnabled()) console.error('[LearningPath] invalid provider response', { workspaceId, stage: diagnostic.stage, errorCode: diagnostic.code, errorMessage: diagnostic.message, responsePreview: sanitizedResponsePreview(response.content) })
      const repairReason = diagnostic.code === 'ROADMAP_GENERIC_REJECTED' ? `Os módulos foram rejeitados porque são genéricos. Produza tópicos concretos específicos de ${workspace.name}.` : `Erros encontrados: ${diagnostic.message}`
      let repaired: AIResponse
      try { repaired = await provider.sendMessage({ messages: [{ role: 'system', content: `Corrija apenas a estrutura JSON para ${schemaDescription()}. Preserve assunto, keys e autoridade curricular. Sem explicações.` }, { role: 'user', content: JSON.stringify({ subject: workspace.name, reason: repairReason, invalidResponse: response.content.slice(0, 20_000), allowedSourceIds: [...allowed.keys()].slice(0, 4) }) }], maxOutputTokens: 1400, responseFormat: 'json_object', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(ROADMAP_REPAIR_TIMEOUT_MS)]) : AbortSignal.timeout(ROADMAP_REPAIR_TIMEOUT_MS) }) } catch (error) { throw diagnosticError(error, 'provider_response') }
      try { proposal = this.parseProposal(workspaceId, repaired.content, allowed, setupObjective) } catch (repairError) { const repairedDiagnostic = diagnosticError(repairError, 'extract_json'); throw new LearningPathGenerationError(repairedDiagnostic.code, repairedDiagnostic.stage, repairedDiagnostic.message, { cause: repairedDiagnostic.cause, response: repaired.content }) }
      response = repaired
    }
    logProgress(workspaceId, 'generic_validation', { modules: proposal.modules.length, topics: proposal.modules.reduce((total, item) => total + item.topics.length, 0) })
    return { proposal, response }
  }
  private parseProposal(workspaceId: string, content: string, allowed: Map<string, RoadmapResource>, setupObjective: boolean): ReturnType<typeof roadmapProposalSchema.parse> {
    let raw: unknown
    try { raw = extractJsonDocument(content); logProgress(workspaceId, 'extract_json') } catch (error) { throw new LearningPathGenerationError('JSON_EXTRACTION_FAILED', 'extract_json', structuredErrorDetail(error), { cause: error, response: content }) }
    const generated = generatedRoadmapProposalSchema.safeParse(raw)
    if (!generated.success) throw new LearningPathGenerationError('ROADMAP_SCHEMA_INVALID', 'generated_schema', structuredErrorDetail(generated.error), { cause: generated.error, response: content })
    logProgress(workspaceId, 'generated_schema')
    const proposal = roadmapProposalSchema.safeParse({ title: generated.data.title, modules: generated.data.modules.map(({ sourceIds, ...item }) => ({ ...item, resources: sourceIds.map((id) => allowed.get(id)).filter((source): source is RoadmapResource => Boolean(source)) })) })
    if (!proposal.success) throw new LearningPathGenerationError('ROADMAP_SCHEMA_INVALID', 'roadmap_schema', structuredErrorDetail(proposal.error), { cause: proposal.error, response: content })
    logProgress(workspaceId, 'roadmap_schema')
    if (!validRoadmap({ id: '', workspaceId: '', title: proposal.data.title, status: 'accepted', generationKind: 'ai_generated', version: 1, providerId: null, modelId: null, modules: proposal.data.modules.map((item, index) => ({ id: String(index), ...item, position: index, status: 'active' })), createdAt: 0, updatedAt: 0 })) throw new LearningPathGenerationError('ROADMAP_SCHEMA_INVALID', 'roadmap_schema', 'Roadmap must contain modules and topics', { response: content })
    if (hasGenericModules(proposal.data)) throw new LearningPathGenerationError('ROADMAP_GENERIC_REJECTED', 'generic_validation', 'Roadmap contains generic modules or topics', { response: content })
    if (!setupObjective && hasSetupAsPrimaryCurriculum(proposal.data)) throw new LearningPathGenerationError('ROADMAP_GENERIC_REJECTED', 'generic_validation', 'Roadmap uses setup or installation as primary curriculum', { response: content })
    try { validateCurriculum(proposal.data.modules); return proposal.data }
    catch (error) {
      const repaired = roadmapProposalSchema.parse({ ...proposal.data, modules: repairCurriculumPrerequisites(proposal.data.modules) })
      try { validateCurriculum(repaired.modules); return repaired }
      catch { throw new LearningPathGenerationError('ROADMAP_SCHEMA_INVALID', 'roadmap_schema', structuredErrorDetail(error), { cause: error, response: content }) }
    }
  }
  async accept(workspaceId: string, roadmapId: string): Promise<Roadmap> { await this.requireWorkspace(workspaceId); const roadmap = this.repository.accept(workspaceId, roadmapId, this.now()); this.onRoadmapChanged?.(roadmap, false); return roadmap }
  private async requireWorkspace(id: string): Promise<Workspace> { const workspace = await this.getWorkspace(id); if (!workspace || workspace.status !== 'active') throw new Error('Workspace not found'); return workspace }
}
