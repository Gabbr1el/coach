import { workspaceActionInputSchema, type WorkspaceActionResult } from '../../shared/contracts/workspace-action-contract'
export interface WorkspaceActionHandlers { execute(input: ReturnType<typeof workspaceActionInputSchema.parse>): Promise<unknown> }
export class WorkspaceActionService {
  constructor(private readonly handlers: WorkspaceActionHandlers, private readonly createId = () => crypto.randomUUID()) {}
  async execute(raw: unknown): Promise<WorkspaceActionResult> { const input = workspaceActionInputSchema.parse(raw); try { const result = await this.handlers.execute(input); return { id: this.createId(), workspaceId: input.workspaceId, type: input.type, status: 'succeeded', message: 'Ação aplicada e confirmada pelo Coach.', persisted: true, result } } catch (error) { return { id: this.createId(), workspaceId: input.workspaceId, type: input.type, status: 'failed', message: 'Não consegui aplicar esta ação.', persisted: false, result: { error: error instanceof Error ? error.message.slice(0, 300) : 'Falha desconhecida' } } } }
}
