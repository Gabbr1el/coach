export type WorkspaceEventType =
  | 'workspace.opened'
  | 'session.started'
  | 'session.completed'
  | 'plan.changed'
  | 'timer.changed'
  | 'document.changed'
  | 'notes.changed'
  | 'execution.completed'
  | 'focus.changed'

export interface WorkspaceEvent<TPayload = unknown> {
  readonly id: string
  readonly workspaceId: string
  readonly sessionId: string | null
  readonly type: WorkspaceEventType
  readonly payload: TPayload
  readonly occurredAt: number
}

export type WorkspaceEventListener = (event: WorkspaceEvent) => void | Promise<void>

export class WorkspaceEventBus {
  private readonly listeners = new Set<WorkspaceEventListener>()

  subscribe(listener: WorkspaceEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish(event: WorkspaceEvent): void {
    for (const listener of this.listeners) {
      try {
        const pending = listener(event)
        if (pending instanceof Promise) void pending.catch((error: unknown) => console.error('Workspace event listener failed:', error))
      } catch (error) {
        console.error('Workspace event listener failed:', error)
      }
    }
  }
}

export function createWorkspaceEvent(
  workspaceId: string,
  sessionId: string | null,
  type: WorkspaceEventType,
  payload: unknown,
  occurredAt = Date.now(),
): WorkspaceEvent {
  return { id: crypto.randomUUID(), workspaceId, sessionId, type, payload, occurredAt }
}
