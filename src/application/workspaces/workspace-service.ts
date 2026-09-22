import type { CreateWorkspaceInput, Workspace, WorkspaceProvisioningState, WorkspaceSummary } from '../../shared/contracts/workspace-contract'
import type { WorkspaceRepository } from './workspace-repository'
import { normalizeSubject } from './subject-normalizer'
import { workspaceDistinctionKey, workspaceEquivalenceKey } from './workspace-equivalence'
import type { AcademicSubjectContextService } from './academic-subject-context'

export interface WorkspaceServiceDependencies {
  readonly repository: WorkspaceRepository
  readonly now?: () => number
  readonly createId?: () => string
  readonly ensureLearningPath?: (workspaceId: string) => Promise<unknown>
  readonly academicContext?: AcademicSubjectContextService
  readonly createAcademicContexts?: (workspaceId: string, workspaceName: string, related: NonNullable<CreateWorkspaceInput['relatedSubjects']>) => void | (() => void)
  readonly saveLearningOverrides?: (workspaceId: string, subject: string, input: Pick<CreateWorkspaceInput, 'analysisRevision' | 'declaredLevel' | 'declaredKnowledge' | 'declaredDifficulties' | 'goals' | 'localKnowledgeProjection' | 'canonicalFocus' | 'canonicalContext' | 'curricularScope'>, now: number) => void
  readonly provisioning?: { createDraft(workspaceId: string): WorkspaceProvisioningState; start(workspaceId: string): WorkspaceProvisioningState; get(workspaceId: string): WorkspaceProvisioningState | null; retry(workspaceId: string): WorkspaceProvisioningState; discardDraft(workspaceId: string): void; reconcile?(workspaceId: string): void }
  readonly findSemanticDuplicate?: (canonicalKey: string, excludedId?: string) => Workspace | null
  readonly validateAnalysis?: (token: string, revision: number, subject: string, focus?: string, context?: string) => boolean
  readonly discoverOrphanEvents?: (workspace: Workspace) => Promise<unknown> | unknown
  readonly onArchived?: (workspaceId: string, archivedAt: number) => Promise<void> | void
}

export class WorkspaceService {
  private readonly repository: WorkspaceRepository
  private readonly now: () => number
  private readonly createId: () => string
  private ensureLearningPath: ((workspaceId: string) => Promise<unknown>) | null
  private readonly academicContext: AcademicSubjectContextService | null
  private readonly createAcademicContexts?: WorkspaceServiceDependencies['createAcademicContexts']
  private readonly saveLearningOverrides?: WorkspaceServiceDependencies['saveLearningOverrides']
  private readonly provisioning?: WorkspaceServiceDependencies['provisioning']
  private readonly findSemanticDuplicate?: WorkspaceServiceDependencies['findSemanticDuplicate']
  private readonly validateAnalysis?: WorkspaceServiceDependencies['validateAnalysis']
  private discoverOrphanEvents?: WorkspaceServiceDependencies['discoverOrphanEvents']
  private readonly onArchived?: WorkspaceServiceDependencies['onArchived']

  constructor({ repository, now = Date.now, createId = () => crypto.randomUUID(), ensureLearningPath, academicContext, createAcademicContexts, saveLearningOverrides, provisioning, findSemanticDuplicate, validateAnalysis, discoverOrphanEvents, onArchived }: WorkspaceServiceDependencies) {
    this.repository = repository
    this.now = now
    this.createId = createId
    this.ensureLearningPath = ensureLearningPath ?? null
    this.academicContext = academicContext ?? null
    this.onArchived = onArchived
    this.createAcademicContexts = createAcademicContexts
    this.saveLearningOverrides = saveLearningOverrides
    this.provisioning = provisioning
    this.findSemanticDuplicate = findSemanticDuplicate
    this.validateAnalysis = validateAnalysis
    this.discoverOrphanEvents = discoverOrphanEvents
  }

  list(): Promise<WorkspaceSummary[]> {
    return this.repository.listActive()
  }
  listHistory(): Promise<WorkspaceSummary[]> { return this.repository.listHistory?.() ?? Promise.resolve([]) }
  getHistoryDetail(id: string) { return this.repository.getHistoryDetail?.(id) ?? Promise.resolve(null) }

  async complete(id: string): Promise<void> {
    if (!await this.repository.complete(id, this.now())) throw new Error('Workspace not found')
  }

  setLearningPathEnsurer(ensureLearningPath: (workspaceId: string) => Promise<unknown>): void { this.ensureLearningPath = ensureLearningPath }
  setOrphanEventDiscovery(discover: NonNullable<WorkspaceServiceDependencies['discoverOrphanEvents']>): void { this.discoverOrphanEvents = discover }

  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    this.assertAnalyzed(input)
    this.assertNoDuplicate(input, input.draftId)
    if (input.draftId) {
      const workspace = await this.repository.findAnyById(input.draftId)
      if (!workspace || this.provisioning?.get(input.draftId)?.status !== 'draft') throw new Error('Workspace draft not found')
      if (workspace.name !== input.name.trim() || workspace.objective !== input.objective.trim()) throw new Error('Workspace draft changed after materials were attached; discard it and analyze again')
      const rollbacks: Array<() => void> = []
      let confirmed: Workspace | null
      try {
        confirmed = await this.repository.confirm(workspace.id, this.now(), () => {
          this.saveLearningOverrides?.(workspace.id, normalizeSubject(input.name).subject, { ...input, goals: [...(input.goals ?? []), input.objective].filter(Boolean) }, this.now())
          const rollback = this.createAcademicContexts?.(workspace.id, workspace.name, input.relatedSubjects ?? [])
          if (rollback) rollbacks.push(rollback)
          this.provisioning!.start(workspace.id)
        })
      } catch (error) {
        for (const rollback of rollbacks.reverse()) rollback()
        throw error
      }
      if (!confirmed) throw new Error('Workspace draft could not be confirmed')
      try { await this.discoverOrphanEvents?.(workspace) } catch {}
      return confirmed
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
      equivalenceKey: workspaceDistinctionKey(workspaceEquivalenceKey(normalized.subject), input.duplicateOverride?.meaningfulDifference),
      meaningfulDistinction: input.duplicateOverride?.meaningfulDifference ?? null,
      confirmedAt: null,
    }
    const academic = { declaredLevel: input.declaredLevel, declaredKnowledge: input.declaredKnowledge ?? [], declaredDifficulties: input.declaredDifficulties ?? [], goals: [...(input.goals ?? []), input.objective].filter(Boolean), localKnowledgeProjection: input.localKnowledgeProjection, curricularScope: input.curricularScope }
    const workspace = await this.repository.create(record)
    let result = workspace
    const rollbacks: Array<() => void> = []
    try {
      if (draft) {
        this.provisioning?.createDraft(workspace.id)
        this.saveLearningOverrides?.(workspace.id, normalized.subject, academic, now)
      } else {
        const confirmed = await this.repository.confirm(workspace.id, this.now(), () => {
          this.saveLearningOverrides?.(workspace.id, normalized.subject, academic, now)
          if (!this.saveLearningOverrides) this.academicContext?.record({ subject: normalized.subject, declaredLevel: academic.declaredLevel ?? null, declaredKnowledge: academic.declaredKnowledge, declaredDifficulties: academic.declaredDifficulties, goals: academic.goals, sourceEvidence: [] })
          const rollback = this.createAcademicContexts?.(workspace.id, workspace.name, input.relatedSubjects ?? [])
          if (rollback) rollbacks.push(rollback)
          if (this.provisioning) {
            this.provisioning.createDraft(workspace.id)
            this.provisioning.start(workspace.id)
          }
        })
        if (!confirmed) throw new Error('Workspace could not be confirmed')
        result = confirmed
        if (!this.provisioning) void this.ensureLearningPath?.(workspace.id).catch(() => {})
      }
    } catch (error) {
      const state = this.provisioning?.get(workspace.id)
      if (state?.status === 'draft') { for (const rollback of rollbacks.reverse()) rollback(); this.provisioning?.discardDraft(workspace.id) }
      else if (!state) { for (const rollback of rollbacks.reverse()) rollback(); await this.repository.removeJustCreated(workspace.id, workspace.createdAt) }
      throw error
    }
    if (!draft) { try { await this.discoverOrphanEvents?.(result) } catch {} }
    return result
  }

  private assertAnalyzed(input: CreateWorkspaceInput): void {
    if (this.provisioning && (!input.analysisToken || !input.analysisRevision)) throw new Error('Workspace analysis is required')
    if (this.provisioning && this.validateAnalysis && !this.validateAnalysis(input.analysisToken!, input.analysisRevision!, input.name, input.canonicalFocus, input.canonicalContext)) throw new Error('Workspace analysis is unknown or expired; analyze the theme again')
  }

  private assertNoDuplicate(input: CreateWorkspaceInput, excludedId?: string): void {
    const duplicate = this.findSemanticDuplicate?.(workspaceEquivalenceKey(input.name), excludedId)
    if (!duplicate) return
    if (!input.duplicateOverride?.confirmed) throw new Error(`WORKSPACE_DUPLICATE|${duplicate.id}|${duplicate.name}`)
  }

  async open(id: string): Promise<Workspace | null> {
    const workspace = await this.repository.markOpened(id, this.now())
    if (workspace) this.provisioning?.reconcile?.(workspace.id)
    if (workspace && !this.provisioning) void this.ensureLearningPath?.(workspace.id).catch(() => {})
    return workspace
  }

  async archive(id: string): Promise<void> {
    const archivedAt = this.now()
    const archived = await this.repository.archive(id, archivedAt)
    if (!archived) {
      throw new Error('Workspace not found')
    }
    await this.onArchived?.(id, archivedAt)
  }

  async acceptContinuation(id: string): Promise<Workspace> {
    const alreadyAccepted = await this.repository.findAcceptedContinuation?.(id)
    if (alreadyAccepted) {
      const state = this.provisioning?.get(alreadyAccepted.id)
      if (!state && this.provisioning) { this.provisioning.createDraft(alreadyAccepted.id); this.provisioning.start(alreadyAccepted.id) }
      else if (state?.status === 'draft') this.provisioning?.start(alreadyAccepted.id)
      else if (state && state.status !== 'ready') this.provisioning?.retry(alreadyAccepted.id)
      return alreadyAccepted
    }
    const recommendation = await this.repository.getContinuationRecommendation?.(id, this.now())
    if (!recommendation) throw new Error('Continuation recommendation not found')
    if (recommendation.action === 'open_existing' && recommendation.existingWorkspaceId) {
      const existing = await this.repository.findAnyById(recommendation.existingWorkspaceId)
      if (!existing) throw new Error('Continuation target not found')
      await this.repository.resolveContinuation?.(id, 'accepted', existing.id, this.now())
      return existing
    }
    const predecessor = await this.repository.findAnyById(id)
    if (!predecessor || predecessor.status !== 'completed') throw new Error('Completed predecessor not found')
    const now = this.now()
    const successorName = recommendation.suggestedName.trim().slice(0, 80)
    const equivalenceKey = workspaceEquivalenceKey(successorName)
    const duplicate = this.findSemanticDuplicate?.(equivalenceKey)
    if (duplicate) {
      await this.repository.resolveContinuation?.(id, 'accepted', duplicate.id, now)
      return duplicate
    }
    const meaningfulDistinction = `Continuação de ${predecessor.name}: ${recommendation.rationale}`.slice(0, 500)
    const successorKey = workspaceDistinctionKey(equivalenceKey, meaningfulDistinction)
    const startProvisioning = (workspace: Workspace) => {
      if (!this.provisioning) return
      this.provisioning.createDraft(workspace.id)
      this.provisioning.start(workspace.id)
    }
    const successor = this.repository.createContinuation
      ? await this.repository.createContinuation(id, { id: this.createId(), name: successorName, objective: recommendation.objective, createdAt: now, updatedAt: now, confirmedAt: now, equivalenceKey: successorKey, meaningfulDistinction, predecessorId: id }, now, startProvisioning)
      : await this.repository.create({ id: this.createId(), name: successorName, objective: recommendation.objective, createdAt: now, updatedAt: now, confirmedAt: now, equivalenceKey: successorKey, meaningfulDistinction, predecessorId: id })
    if (!this.repository.createContinuation) {
      startProvisioning(successor)
      if (!this.provisioning) void this.ensureLearningPath?.(successor.id).catch(() => {})
      await this.repository.resolveContinuation?.(id, 'accepted', successor.id, now)
    }
    return successor
  }

  async declineContinuation(id: string): Promise<void> {
    const recommendation = await this.repository.getContinuationRecommendation?.(id, this.now())
    if (!recommendation || !await this.repository.resolveContinuation?.(id, 'declined', null, this.now())) throw new Error('Continuation recommendation not found')
  }
}
