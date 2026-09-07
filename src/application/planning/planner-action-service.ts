import { createHash } from 'node:crypto'
import { plannerActionProposalSchema, type PlannerAction, type PlannerActionType } from '../../shared/contracts/planner-action-contract'
import type { ProjectLanguage } from '../../shared/contracts/project-contract'

export interface PlannerActionRepository {
  listPending(): PlannerAction[]
  find(id: string): PlannerAction | null
  create(action: PlannerAction, idempotencyKey: string): PlannerAction
  claim(id: string, now: number): PlannerAction
  complete(id: string, status: 'applied' | 'rejected', result: unknown, now: number): PlannerAction
  release(id: string): void
  invalidateSiblings(originMessageId: string, exceptId: string, now: number): void
  invalidatePending(contextVersion: number, now: number): void
}

export interface PlannerActionDependencies {
  readonly repository: PlannerActionRepository
  readonly createWorkspace: (input: { name: string; objective: string }) => Promise<{ id: string; name: string }>
  readonly createProject: (workspaceId: string, name: string, language: ProjectLanguage) => Promise<unknown>
  readonly createDeadline: (input: { workspaceId: string; title: string; dueAt: number; estimatedMinutes: number; masteryPercent: number | null }) => void
  readonly addRoutine: (content: string) => void
  readonly now?: () => number
  readonly createId?: () => string
}

export class PlannerActionService {
  private readonly now: () => number
  private readonly createId: () => string
  constructor(private readonly dependencies: PlannerActionDependencies) { this.now = dependencies.now ?? Date.now; this.createId = dependencies.createId ?? (() => crypto.randomUUID()) }
  listPending(): PlannerAction[] { return this.dependencies.repository.listPending() }
  propose(input: { type: PlannerActionType; payload: unknown; label: string; originMessageId: string; contextVersion: number }): PlannerAction {
    const parsed = plannerActionProposalSchema.parse({ type: input.type, payload: input.payload })
    const key = createHash('sha256').update(JSON.stringify({ ...parsed, originMessageId: input.originMessageId, contextVersion: input.contextVersion })).digest('hex')
    return this.dependencies.repository.create({ id: this.createId(), originMessageId: input.originMessageId, label: input.label, contextVersion: input.contextVersion, type: parsed.type, status: 'proposed', payload: parsed.payload, result: null, createdAt: this.now(), resolvedAt: null }, key)
  }
  invalidateBefore(contextVersion: number): void { this.dependencies.repository.invalidatePending(contextVersion, this.now()) }
  async resolve(actionId: string, decision: 'apply' | 'reject'): Promise<PlannerAction> {
    const action = this.dependencies.repository.claim(actionId, this.now())
    if (decision === 'reject') return this.dependencies.repository.complete(actionId, 'rejected', null, this.now())
    try {
      let result: unknown
      if (action.type === 'workspace.create') {
        const payload = action.payload as { name: string; objective: string; language?: ProjectLanguage }
        const workspace = await this.dependencies.createWorkspace(payload)
        if (payload.language) await this.dependencies.createProject(workspace.id, workspace.name, payload.language)
        result = workspace
      } else if (action.type === 'deadline.create') {
        this.dependencies.createDeadline(action.payload as Parameters<PlannerActionDependencies['createDeadline']>[0])
        result = { ok: true }
      } else {
        this.dependencies.addRoutine((action.payload as { content: string }).content)
        result = { ok: true }
      }
      const completed = this.dependencies.repository.complete(actionId, 'applied', result, this.now())
      this.dependencies.repository.invalidateSiblings(action.originMessageId, action.id, this.now())
      return completed
    } catch (error) {
      if (this.dependencies.repository.find(actionId)?.status === 'applying') this.dependencies.repository.release(actionId)
      throw error
    }
  }
}
