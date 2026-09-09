import type { ObserverState } from '../../shared/contracts/observer-contract'
import type { StudyWorkspaceState } from '../../shared/contracts/study-workspace-contract'
import type { Workspace } from '../../shared/contracts/workspace-contract'
import type { AcademicSubjectContext, RelatedAcademicContext } from '../../shared/contracts/academic-subject-context-contract'

export interface CurrentWorkspaceContext {
  readonly version: number
  readonly workspace: Workspace
  readonly study: StudyWorkspaceState
  readonly observer: ObserverState
  readonly activePlanItem: string | null
  readonly memory: string | null
  readonly academicSubject?: AcademicSubjectContext | null
  readonly relatedAcademicSubjects?: Array<AcademicSubjectContext & { relation: RelatedAcademicContext['relation'] }>
}

export interface CurrentWorkspaceContextDependencies {
  readonly getWorkspace: (workspaceId: string) => Promise<Workspace | null>
  readonly getStudyState: (workspaceId: string) => Promise<StudyWorkspaceState>
  readonly getObserverState: (workspaceId: string) => ObserverState
  readonly getWorkspaceMemory: (workspaceId: string) => string | null
  readonly getAcademicSubjectContext?: (subject: string) => AcademicSubjectContext | null
  readonly getPrimaryAcademicContext?: (workspaceId: string) => AcademicSubjectContext | null
  readonly getRelatedAcademicContexts?: (workspaceId: string) => Array<AcademicSubjectContext & { relation: RelatedAcademicContext['relation'] }>
}

export class CurrentWorkspaceContextService {
  constructor(private readonly dependencies: CurrentWorkspaceContextDependencies) {}

  async get(workspaceId: string): Promise<CurrentWorkspaceContext> {
    const workspace = await this.dependencies.getWorkspace(workspaceId)
    if (!workspace || workspace.status !== 'active') throw new Error('Workspace not found')
    const study = await this.dependencies.getStudyState(workspaceId)
    return {
      version: study.updatedAt,
      workspace,
      study,
      observer: this.dependencies.getObserverState(workspaceId),
      activePlanItem: study.plan.find((item) => item.status === 'active')?.title ?? null,
      memory: this.dependencies.getWorkspaceMemory(workspaceId),
      academicSubject: this.dependencies.getPrimaryAcademicContext?.(workspaceId) ?? this.dependencies.getAcademicSubjectContext?.(workspace.name) ?? null,
      relatedAcademicSubjects: this.dependencies.getRelatedAcademicContexts?.(workspaceId) ?? [],
    }
  }
}
