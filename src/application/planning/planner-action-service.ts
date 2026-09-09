import { createHash } from 'node:crypto'
import { z } from 'zod'
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

const workspaceAcademicEventIntentSchema = z.object({ type: z.enum(['exam', 'assignment', 'deadline']), title: z.string().trim().min(1).max(160), dueAt: z.number().int().positive(), estimatedMinutes: z.number().int().min(1).max(100000), masteryPercent: z.number().int().min(0).max(100).nullable() }).strict()
export type WorkspaceAcademicEventIntent = z.infer<typeof workspaceAcademicEventIntentSchema>
export interface WorkspaceCreateIntent { readonly name: string; readonly objective: string; readonly language?: ProjectLanguage; readonly academicEvent?: WorkspaceAcademicEventIntent }

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
    const payload = parsed.payload
    const key = createHash('sha256').update(JSON.stringify({ type: parsed.type, payload, originMessageId: input.originMessageId, contextVersion: input.contextVersion })).digest('hex')
    return this.dependencies.repository.create({ id: this.createId(), originMessageId: input.originMessageId, label: input.label, contextVersion: input.contextVersion, type: parsed.type, status: 'proposed', payload, result: null, createdAt: this.now(), resolvedAt: null }, key)
  }
  invalidateBefore(contextVersion: number): void { this.dependencies.repository.invalidatePending(contextVersion, this.now()) }
  async resolve(actionId: string, decision: 'apply' | 'reject'): Promise<PlannerAction> {
    const action = this.dependencies.repository.claim(actionId, this.now())
    if (decision === 'reject') return this.dependencies.repository.complete(actionId, 'rejected', null, this.now())
    try {
      let result: unknown
      if (action.type === 'workspace.prepare') {
        result = action.payload
      } else if (action.type === 'workspace.create') {
        throw new Error('Legacy workspace.create can no longer be executed; use workspace.prepare')
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
