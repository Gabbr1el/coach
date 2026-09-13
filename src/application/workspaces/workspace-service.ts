import type { CreateWorkspaceInput, Workspace, WorkspaceProvisioningState, WorkspaceSummary } from '../../shared/contracts/workspace-contract'
import type { WorkspaceRepository } from './workspace-repository'
import { isProgrammingSubject, normalizeSubject, semanticSubjectKey } from './subject-normalizer'
import type { AcademicSubjectContextService } from './academic-subject-context'

export interface WorkspaceServiceDependencies {
  readonly repository: WorkspaceRepository
  readonly now?: () => number
  readonly createId?: () => string
  readonly ensureLearningPath?: (workspaceId: string) => Promise<unknown>
  readonly academicContext?: AcademicSubjectContextService
  readonly createWithAcademicContexts?: (workspace: { id: string; name: string; objective: string; createdAt: number; updatedAt: number }, academic: { declaredLevel: CreateWorkspaceInput['declaredLevel']; declaredKnowledge: readonly string[]; declaredDifficulties: readonly string[]; goals: readonly string[] }, related: NonNullable<CreateWorkspaceInput['relatedSubjects']>) => Workspace
  readonly saveLearningOverrides?: (workspaceId: string, subject: string, input: Pick<CreateWorkspaceInput, 'analysisRevision' | 'declaredLevel' | 'declaredKnowledge' | 'declaredDifficulties' | 'goals' | 'localKnowledgeProjection' | 'canonicalFocus' | 'canonicalContext'>, now: number) => void
  readonly provisioning?: { createDraft(workspaceId: string): WorkspaceProvisioningState; start(workspaceId: string): WorkspaceProvisioningState; get(workspaceId: string): WorkspaceProvisioningState | null; retry(workspaceId: string): WorkspaceProvisioningState; discardDraft(workspaceId: string): void }
  readonly findSemanticDuplicate?: (canonicalKey: string, excludedId?: string) => Workspace | null
  readonly validateAnalysis?: (token: string, revision: number, subject: string, focus?: string, context?: string) => boolean
  readonly discoverOrphanEvents?: (workspace: Workspace) => Promise<unknown> | unknown
}

export class WorkspaceService {
  private readonly repository: WorkspaceRepository
  private readonly now: () => number
  private readonly createId: () => string
  private ensureLearningPath: ((workspaceId: string) => Promise<unknown>) | null
  private readonly academicContext: AcademicSubjectContextService | null
  private readonly createWithAcademicContexts?: WorkspaceServiceDependencies['createWithAcademicContexts']
  private readonly saveLearningOverrides?: WorkspaceServiceDependencies['saveLearningOverrides']
  private readonly provisioning?: WorkspaceServiceDependencies['provisioning']
  private readonly findSemanticDuplicate?: WorkspaceServiceDependencies['findSemanticDuplicate']
  private readonly validateAnalysis?: WorkspaceServiceDependencies['validateAnalysis']
  private discoverOrphanEvents?: WorkspaceServiceDependencies['discoverOrphanEvents']

  constructor({ repository, now = Date.now, createId = () => crypto.randomUUID(), ensureLearningPath, academicContext, createWithAcademicContexts, saveLearningOverrides, provisioning, findSemanticDuplicate, validateAnalysis, discoverOrphanEvents }: WorkspaceServiceDependencies) {
    this.repository = repository
    this.now = now
    this.createId = createId
    this.ensureLearningPath = ensureLearningPath ?? null
    this.academicContext = academicContext ?? null
    this.createWithAcademicContexts = createWithAcademicContexts
    this.saveLearningOverrides = saveLearningOverrides
    this.provisioning = provisioning
    this.findSemanticDuplicate = findSemanticDuplicate
    this.validateAnalysis = validateAnalysis
    this.discoverOrphanEvents = discoverOrphanEvents
  }

  list(): Promise<WorkspaceSummary[]> {
    return this.repository.listActive()
  }

  setLearningPathEnsurer(ensureLearningPath: (workspaceId: string) => Promise<unknown>): void { this.ensureLearningPath = ensureLearningPath }
  setOrphanEventDiscovery(discover: NonNullable<WorkspaceServiceDependencies['discoverOrphanEvents']>): void { this.discoverOrphanEvents = discover }

  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    this.assertAnalyzed(input)
    this.assertNoDuplicate(input, input.draftId)
    if (input.draftId) {
      const workspace = await this.repository.findById(input.draftId)
      if (!workspace || this.provisioning?.get(input.draftId)?.status !== 'draft') throw new Error('Workspace draft not found')
      if (workspace.name !== input.name.trim() || workspace.objective !== input.objective.trim()) throw new Error('Workspace draft changed after materials were attached; discard it and analyze again')
      this.saveLearningOverrides?.(workspace.id, normalizeSubject(input.name).subject, { ...input, goals: [...(input.goals ?? []), input.objective].filter(Boolean) }, this.now())
      this.provisioning.start(workspace.id)
      try { await this.discoverOrphanEvents?.(workspace) } catch {}
      return workspace
    }
    return this.createRecord(input, false)
  }

  prepareDraft(input: CreateWorkspaceInput): Promise<Workspace> { return this.createRecord(input, true) }
  discardDraft(id: string): void { if (!this.provisioning) throw new Error('Workspace drafts are unavailable'); this.provisioning.discardDraft(id) }
  getProvisioning(id: string): WorkspaceProvisioningState | null { return this.provisioning?.get(id) ?? null }
  retryProvisioning(id: string): WorkspaceProvisioningState { if (!this.provisioning) throw new Error('Workspace provisioning is unavailable'); return this.provisioning.retry(id) }

  private async createRecord(input: CreateWorkspaceInput, draft: boolean): Promise<Workspace> {
    this.assertAnalyzed(input)
    this.assertNoDuplicate(input)
    const now = this.now()
    const normalized = normalizeSubject(input.name)
    const record = {
      id: this.createId(),
      name: normalized.subject,
      objective: input.objective.trim(),
      createdAt: now,
      updatedAt: now,
    }
    const academic = { declaredLevel: input.declaredLevel, declaredKnowledge: input.declaredKnowledge ?? [], declaredDifficulties: input.declaredDifficulties ?? [], goals: [...(input.goals ?? []), input.objective].filter(Boolean), localKnowledgeProjection: input.localKnowledgeProjection }
    const workspace = this.createWithAcademicContexts ? this.createWithAcademicContexts(record, academic, input.relatedSubjects ?? []) : await this.repository.create(record)
    this.saveLearningOverrides?.(workspace.id, normalized.subject, academic, now)
    if (!this.createWithAcademicContexts && !this.saveLearningOverrides) this.academicContext?.record({ subject: normalized.subject, declaredLevel: academic.declaredLevel ?? null, declaredKnowledge: academic.declaredKnowledge, declaredDifficulties: academic.declaredDifficulties, goals: academic.goals, sourceEvidence: [] })
    if (this.provisioning) { this.provisioning.createDraft(workspace.id); if (!draft) this.provisioning.start(workspace.id) }
    else void this.ensureLearningPath?.(workspace.id).catch(() => {})
    if (!draft) { try { await this.discoverOrphanEvents?.(workspace) } catch {} }
    return workspace
  }

  private assertAnalyzed(input: CreateWorkspaceInput): void {
    if (this.provisioning && (!input.analysisToken || !input.analysisRevision)) throw new Error('Workspace analysis is required')
    if (this.provisioning && this.validateAnalysis && !this.validateAnalysis(input.analysisToken!, input.analysisRevision!, input.name, input.canonicalFocus, input.canonicalContext)) throw new Error('Workspace analysis is unknown or expired; analyze the theme again')
    if (this.provisioning && isProgrammingSubject(input.name) && !input.declaredLevel && !input.fundamentals) throw new Error('Programming fundamentals must be answered with yes, no, or unknown')
  }

  private assertNoDuplicate(input: CreateWorkspaceInput, excludedId?: string): void {
    const duplicate = this.findSemanticDuplicate?.(semanticSubjectKey(input.name, input.canonicalFocus, input.canonicalContext), excludedId)
    if (!duplicate) return
    if (!input.duplicateOverride?.confirmed) throw new Error(`WORKSPACE_DUPLICATE|${duplicate.id}|${duplicate.name}`)
  }

  async open(id: string): Promise<Workspace | null> {
    const workspace = await this.repository.markOpened(id, this.now())
    if (workspace && !this.provisioning) void this.ensureLearningPath?.(workspace.id).catch(() => {})
    return workspace
  }

  async archive(id: string): Promise<void> {
    const archived = await this.repository.archive(id, this.now())
    if (!archived) {
      throw new Error('Workspace not found')
    }
  }
}
