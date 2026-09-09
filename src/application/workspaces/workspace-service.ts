import type { CreateWorkspaceInput, Workspace, WorkspaceSummary } from '../../shared/contracts/workspace-contract'
import type { WorkspaceRepository } from './workspace-repository'
import { normalizeSubject } from './subject-normalizer'
import type { AcademicSubjectContextService } from './academic-subject-context'

export interface WorkspaceServiceDependencies {
  readonly repository: WorkspaceRepository
  readonly now?: () => number
  readonly createId?: () => string
  readonly ensureLearningPath?: (workspaceId: string) => Promise<unknown>
  readonly academicContext?: AcademicSubjectContextService
  readonly createWithAcademicContexts?: (workspace: { id: string; name: string; objective: string; createdAt: number; updatedAt: number }, academic: { declaredLevel: CreateWorkspaceInput['declaredLevel']; declaredKnowledge: readonly string[]; declaredDifficulties: readonly string[]; goals: readonly string[] }, related: NonNullable<CreateWorkspaceInput['relatedSubjects']>) => Workspace
}

export class WorkspaceService {
  private readonly repository: WorkspaceRepository
  private readonly now: () => number
  private readonly createId: () => string
  private ensureLearningPath: ((workspaceId: string) => Promise<unknown>) | null
  private readonly academicContext: AcademicSubjectContextService | null
  private readonly createWithAcademicContexts?: WorkspaceServiceDependencies['createWithAcademicContexts']

  constructor({ repository, now = Date.now, createId = () => crypto.randomUUID(), ensureLearningPath, academicContext, createWithAcademicContexts }: WorkspaceServiceDependencies) {
    this.repository = repository
    this.now = now
    this.createId = createId
    this.ensureLearningPath = ensureLearningPath ?? null
    this.academicContext = academicContext ?? null
    this.createWithAcademicContexts = createWithAcademicContexts
  }

  list(): Promise<WorkspaceSummary[]> {
    return this.repository.listActive()
  }

  setLearningPathEnsurer(ensureLearningPath: (workspaceId: string) => Promise<unknown>): void { this.ensureLearningPath = ensureLearningPath }

  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    const now = this.now()
    const normalized = normalizeSubject(input.name)
    const record = {
      id: this.createId(),
      name: normalized.subject,
      objective: input.objective.trim(),
      createdAt: now,
      updatedAt: now,
    }
    const academic = { declaredLevel: input.declaredLevel, declaredKnowledge: input.declaredKnowledge ?? [], declaredDifficulties: input.declaredDifficulties ?? [], goals: [...(input.goals ?? []), input.objective].filter(Boolean) }
    const workspace = this.createWithAcademicContexts ? this.createWithAcademicContexts(record, academic, input.relatedSubjects ?? []) : await this.repository.create(record)
    if (!this.createWithAcademicContexts) this.academicContext?.record({ subject: normalized.subject, declaredLevel: academic.declaredLevel ?? null, declaredKnowledge: academic.declaredKnowledge, declaredDifficulties: academic.declaredDifficulties, goals: academic.goals, sourceEvidence: [] })
    void this.ensureLearningPath?.(workspace.id).catch(() => {})
    return workspace
  }

  async open(id: string): Promise<Workspace | null> {
    const workspace = await this.repository.markOpened(id, this.now())
    if (workspace) void this.ensureLearningPath?.(workspace.id).catch(() => {})
    return workspace
  }

  async archive(id: string): Promise<void> {
    const archived = await this.repository.archive(id, this.now())
    if (!archived) {
      throw new Error('Workspace not found')
    }
  }
}
