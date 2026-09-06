import { createHash } from 'node:crypto'
import { plannerActionProposalSchema, type PlannerAction, type PlannerActionType } from '../../shared/contracts/planner-action-contract'
import type { ProjectLanguage } from '../../shared/contracts/project-contract'

export interface PlannerActionRepository { listPending(): PlannerAction[]; find(id: string): PlannerAction | null; create(action: PlannerAction, idempotencyKey: string): PlannerAction; resolve(id: string, status: 'applied' | 'rejected', result: unknown, now: number): PlannerAction }
export interface PlannerActionDependencies { readonly repository: PlannerActionRepository; readonly createWorkspace: (input: { name: string; objective: string }) => Promise<{ id: string; name: string }>; readonly createProject: (workspaceId: string, name: string, language: ProjectLanguage) => Promise<unknown>; readonly createDeadline: (input: { workspaceId: string; title: string; dueAt: number; estimatedMinutes: number; masteryPercent: number }) => void; readonly addRoutine: (content: string) => void; readonly now?: () => number; readonly createId?: () => string }

function infer(content: string): Array<{ type: PlannerActionType; payload: Record<string, unknown> }> {
  const text = content.trim(); const normalized = text.toLocaleLowerCase('pt-BR'); const actions: Array<{ type: PlannerActionType; payload: Record<string, unknown> }> = []
  const study = /(?:quero|preciso|vou)\s+(?:estudar|aprender|praticar)\s+(.+)/i.exec(text)?.[1]?.replace(/[.!?]+$/, '').trim()
  if (study) actions.push({ type: 'workspace.create', payload: { name: study.slice(0, 80), objective: `Aprender ${study}`.slice(0, 500), language: /java|poo|orienta.+objeto/i.test(study) ? 'java' : /(?:^|\s)c(?:\s|$)|ponteiro/i.test(study) ? 'c' : /python/i.test(study) ? 'python' : undefined } })
  if (/rotina|horário|horario|trabalho de|faculdade/i.test(normalized)) actions.push({ type: 'routine.add', payload: { content: text.slice(0, 500) } })
  return actions
}

export class PlannerActionService {
  private readonly now: () => number; private readonly createId: () => string
  constructor(private readonly dependencies: PlannerActionDependencies) { this.now = dependencies.now ?? Date.now; this.createId = dependencies.createId ?? (() => crypto.randomUUID()) }
  listPending(): PlannerAction[] { return this.dependencies.repository.listPending() }
  proposeFromText(content: string): PlannerAction[] { return infer(content).map((proposal) => { const parsed = plannerActionProposalSchema.parse(proposal); const key = createHash('sha256').update(JSON.stringify(parsed)).digest('hex'); return this.dependencies.repository.create({ id: this.createId(), type: parsed.type, status: 'proposed', payload: parsed.payload, result: null, createdAt: this.now(), resolvedAt: null }, key) }) }
  async resolve(actionId: string, decision: 'apply' | 'reject'): Promise<PlannerAction> {
    const action = this.dependencies.repository.find(actionId); if (!action || action.status !== 'proposed') throw new Error('Planner action not found')
    if (decision === 'reject') return this.dependencies.repository.resolve(actionId, 'rejected', null, this.now())
    let result: unknown
    if (action.type === 'workspace.create') { const payload = action.payload as { name: string; objective: string; language?: ProjectLanguage }; const workspace = await this.dependencies.createWorkspace(payload); if (payload.language) await this.dependencies.createProject(workspace.id, workspace.name, payload.language); result = workspace }
    else if (action.type === 'deadline.create') { this.dependencies.createDeadline(action.payload as Parameters<PlannerActionDependencies['createDeadline']>[0]); result = { ok: true } }
    else { this.dependencies.addRoutine((action.payload as { content: string }).content); result = { ok: true } }
    return this.dependencies.repository.resolve(actionId, 'applied', result, this.now())
  }
}
