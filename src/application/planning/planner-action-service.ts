import { createHash } from 'node:crypto'
import { z } from 'zod'
import { plannerActionProposalSchema, type PlannerAction, type PlannerActionType } from '../../shared/contracts/planner-action-contract'
import type { ProjectLanguage } from '../../shared/contracts/project-contract'
import type { AcademicLifeItem, AcademicLifeMutationInput } from '../../shared/contracts/academic-life-contract'

export interface PlannerActionRepository {
  listPending(): PlannerAction[]
  find(id: string): PlannerAction | null
  create(action: PlannerAction, idempotencyKey: string): PlannerAction
  claim(id: string, now: number): PlannerAction
  complete(id: string, status: 'applied' | 'rejected', result: unknown, now: number): PlannerAction
  release(id: string): void
  invalidateSiblings(originMessageId: string, exceptId: string, now: number): void
  invalidatePending(contextVersion: number, now: number): void
  resolveAtomically?(id: string, decision: 'apply' | 'reject', now: number, execute: (action: PlannerAction) => unknown): PlannerAction
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
  readonly saveAcademicLife?: (input: AcademicLifeMutationInput) => AcademicLifeItem
  readonly transitionAcademicLife?: (id: string, status: 'resolved' | 'archived') => AcademicLifeItem
  readonly linkAcademicEventWorkspace?: (eventId: string, workspaceId: string | null, subject?: string) => Promise<AcademicLifeItem> | AcademicLifeItem
  readonly keepAcademicEventUnlinked?: (eventId: string) => AcademicLifeItem
  readonly suggestAcademicEventWorkspaces?: (item: AcademicLifeItem) => Promise<unknown> | unknown
  readonly setTodayBudget?: (input: { dateKey: string; timezone: string; minutes: number }) => unknown
  readonly setWeekdayAvailability?: (input: { weekday: number; minutes: number; timezone: string }) => unknown
  readonly recalculatePlan?: (timezone: string) => unknown
  readonly setPlanItemCompletion?: (workspaceId: string, itemId: string, completed: boolean) => unknown
  readonly adjustWorkspaceDayLoad?: (input: { workspaceId: string; dateKey: string; timezone: string; deltaMinutes: number }) => unknown
  readonly onResolved?: (action: PlannerAction) => Promise<void> | void
  readonly now?: () => number
  readonly createId?: () => string
}

export const ATOMIC_PLANNING_ACTION_TYPES = ['plan.workspace-day-load.adjust', 'plan.recalculate', 'plan.item-completion.set', 'plan.weekday-availability.set', 'plan.today-budget.set'] as const satisfies readonly PlannerActionType[]

export class PlannerActionService {
  private readonly now: () => number
  private readonly createId: () => string
  constructor(private readonly dependencies: PlannerActionDependencies) { this.now = dependencies.now ?? Date.now; this.createId = dependencies.createId ?? (() => crypto.randomUUID()) }
  listPending(): PlannerAction[] { return this.dependencies.repository.listPending() }
  propose(input: { type: PlannerActionType; payload: unknown; label: string; originMessageId: string; contextVersion: number; idempotencyScope?: string }): PlannerAction {
    const parsed = plannerActionProposalSchema.parse({ type: input.type, payload: input.payload })
    const payload = parsed.payload
    const key = createHash('sha256').update(input.idempotencyScope ?? JSON.stringify({ type: parsed.type, payload, originMessageId: input.originMessageId, contextVersion: input.contextVersion })).digest('hex')
    return this.dependencies.repository.create({ id: this.createId(), originMessageId: input.originMessageId, label: input.label, contextVersion: input.contextVersion, type: parsed.type, status: 'proposed', payload, result: null, createdAt: this.now(), resolvedAt: null }, key)
  }
  invalidateBefore(contextVersion: number): void { this.dependencies.repository.invalidatePending(contextVersion, this.now()) }
  async resolve(actionId: string, decision: 'apply' | 'reject'): Promise<PlannerAction> {
    const current = this.dependencies.repository.find(actionId)
    if (!current) throw new Error('Planner action was not found')
    if (current.status === 'applied' || current.status === 'rejected' || current.status === 'obsolete') return current
    if ((ATOMIC_PLANNING_ACTION_TYPES as readonly PlannerActionType[]).includes(current.type) && this.dependencies.repository.resolveAtomically) {
      const completed = this.dependencies.repository.resolveAtomically(actionId, decision, this.now(), (action) => {
        if (decision === 'reject') return null
        if (action.type === 'plan.workspace-day-load.adjust') { if (!this.dependencies.adjustWorkspaceDayLoad) throw new Error('Scoped planning service unavailable'); return this.dependencies.adjustWorkspaceDayLoad(action.payload as { workspaceId: string; dateKey: string; timezone: string; deltaMinutes: number }) }
        if (action.type === 'plan.recalculate') { if (!this.dependencies.recalculatePlan) throw new Error('Planning service unavailable'); return this.dependencies.recalculatePlan((action.payload as { timezone: string }).timezone) }
        if (action.type === 'plan.item-completion.set') { if (!this.dependencies.setPlanItemCompletion) throw new Error('Planning service unavailable'); const payload = action.payload as { workspaceId: string; itemId: string; completed: boolean }; return this.dependencies.setPlanItemCompletion(payload.workspaceId, payload.itemId, payload.completed) }
        if (action.type === 'plan.today-budget.set') { if (!this.dependencies.setTodayBudget) throw new Error('Planning service unavailable'); return this.dependencies.setTodayBudget(action.payload as { dateKey: string; timezone: string; minutes: number }) }
        if (!this.dependencies.setWeekdayAvailability) throw new Error('Planning service unavailable')
        return this.dependencies.setWeekdayAvailability(action.payload as { weekday: number; minutes: number; timezone: string })
      })
      await this.dependencies.onResolved?.(completed)
      return completed
    }
    if (current.status === 'applying') this.dependencies.repository.release(actionId)
    const action = this.dependencies.repository.claim(actionId, this.now())
    if (decision === 'reject') {
      const completed = this.dependencies.repository.complete(actionId, 'rejected', null, this.now())
      await this.dependencies.onResolved?.(completed)
      return completed
    }
    try {
      let result: unknown
      if (action.type === 'workspace.prepare') {
        result = action.payload
      } else if (action.type === 'workspace.create') {
        throw new Error('Legacy workspace.create can no longer be executed; use workspace.prepare')
      } else if (action.type === 'deadline.create') {
        this.dependencies.createDeadline(action.payload as Parameters<PlannerActionDependencies['createDeadline']>[0])
        result = { ok: true }
      } else if (action.type === 'routine.add') {
        this.dependencies.addRoutine((action.payload as { content: string }).content)
        result = { ok: true }
      } else if (action.type === 'academic-life.save') {
        if (!this.dependencies.saveAcademicLife) throw new Error('Academic life service unavailable')
        const item = this.dependencies.saveAcademicLife(action.payload as AcademicLifeMutationInput)
        let suggestions: unknown
        if (item.workspaceId === null && this.dependencies.suggestAcademicEventWorkspaces) {
          try { suggestions = await this.dependencies.suggestAcademicEventWorkspaces(item) } catch { suggestions = { status: 'unavailable', actions: [], options: [{ kind: 'keep_unlinked' }] } }
        }
        result = suggestions === undefined ? item : { item, suggestions }
      } else if (action.type === 'academic-life.transition') {
        if (!this.dependencies.transitionAcademicLife) throw new Error('Academic life service unavailable')
        const payload = action.payload as { id: string; status: 'resolved' | 'archived' }
        result = this.dependencies.transitionAcademicLife(payload.id, payload.status)
      } else if (action.type === 'academic.event.linkWorkspace' || action.type === 'academic.event.unlinkWorkspace') {
        if (!this.dependencies.linkAcademicEventWorkspace) throw new Error('Academic event workspace linking is unavailable')
        const payload = action.payload as { eventId: string; workspaceId?: string; subject?: string }
        result = await this.dependencies.linkAcademicEventWorkspace(payload.eventId, payload.workspaceId ?? null, payload.subject)
      } else if (action.type === 'academic.event.keepUnlinked') {
        if (!this.dependencies.keepAcademicEventUnlinked) throw new Error('Academic event validation is unavailable')
        const event = this.dependencies.keepAcademicEventUnlinked((action.payload as { eventId: string }).eventId)
        result = { eventId: event.id, keptUnlinked: true }
      } else if (action.type === 'plan.today-budget.set') {
        if (!this.dependencies.setTodayBudget) throw new Error('Planning service unavailable')
        result = this.dependencies.setTodayBudget(action.payload as { dateKey: string; timezone: string; minutes: number })
      } else if (action.type === 'plan.weekday-availability.set') {
        if (!this.dependencies.setWeekdayAvailability) throw new Error('Planning service unavailable')
        result = this.dependencies.setWeekdayAvailability(action.payload as { weekday: number; minutes: number; timezone: string })
      } else if (action.type === 'plan.recalculate') {
        if (!this.dependencies.recalculatePlan) throw new Error('Planning service unavailable')
        result = this.dependencies.recalculatePlan((action.payload as { timezone: string }).timezone)
      } else if (action.type === 'plan.workspace-day-load.adjust') {
        if (!this.dependencies.adjustWorkspaceDayLoad) throw new Error('Scoped planning service unavailable')
        result = this.dependencies.adjustWorkspaceDayLoad(action.payload as { workspaceId: string; dateKey: string; timezone: string; deltaMinutes: number })
      } else {
        if (!this.dependencies.setPlanItemCompletion) throw new Error('Study plan service unavailable')
        const payload = action.payload as { workspaceId: string; itemId: string; completed: boolean }
        result = await this.dependencies.setPlanItemCompletion(payload.workspaceId, payload.itemId, payload.completed)
      }
      const completed = this.dependencies.repository.complete(actionId, 'applied', result, this.now())
      this.dependencies.repository.invalidateSiblings(action.originMessageId, action.id, this.now())
      try { await this.dependencies.onResolved?.(completed) } catch {}
      return completed
    } catch (error) {
      if (this.dependencies.repository.find(actionId)?.status === 'applying') this.dependencies.repository.release(actionId)
      throw error
    }
  }
}
