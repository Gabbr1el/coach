import type { ObserverState } from '../../shared/contracts/observer-contract'

export interface ObserverRepository {
  getActiveSession(workspaceId: string): { id: string } | null
  addEvent(input: { id: string; workspaceId: string; sessionId: string; type: string; payloadJson: string; createdAt: number }): void
  listSession(workspaceId: string, sessionId: string): Array<{ type: string; payloadJson: string; createdAt: number }>
}

export class ObserverService {
  constructor(private readonly repository: ObserverRepository, private readonly now = Date.now, private readonly createId = () => crypto.randomUUID()) {}

  getState(workspaceId: string): ObserverState {
    const session = this.repository.getActiveSession(workspaceId)
    if (!session) return { active: false, repeatedErrorCount: 0, interventionSuggested: false, focusExitCount: 0, timeAwaySeconds: 0 }
    const events = this.repository.listSession(workspaceId, session.id)
    const executions = events.filter((event) => event.type === 'execution_error' || event.type === 'code_executed')
    const latest = executions.at(-1)
    const latestPayload = latest?.type === 'execution_error' ? JSON.parse(latest.payloadJson) as { errorSignature: string | null; exitCode: number | null } : null
    const latestSignature = latestPayload ? latestPayload.errorSignature ?? `exit:${latestPayload.exitCode ?? 'signal'}` : null
    let normalizedCount = 0
    for (const event of executions.slice().reverse()) {
      const payload = JSON.parse(event.payloadJson) as { errorSignature: string | null; exitCode: number | null }
      const eventSignature = payload.errorSignature ?? `exit:${payload.exitCode ?? 'signal'}`
      if (event.type !== 'execution_error' || eventSignature !== latestSignature) break
      normalizedCount += 1
    }
    let blurredAt: number | null = null
    let timeAwaySeconds = 0
    for (const event of events) {
      if (event.type === 'window_blurred') blurredAt = event.createdAt
      if (event.type === 'window_focused' && blurredAt) { timeAwaySeconds += Math.max(0, Math.floor((event.createdAt - blurredAt) / 1000)); blurredAt = null }
    }
    return { active: true, repeatedErrorCount: normalizedCount, interventionSuggested: normalizedCount >= 3, focusExitCount: events.filter((event) => event.type === 'window_blurred').length, timeAwaySeconds }
  }

  recordFocus(workspaceId: string, focused: boolean): ObserverState {
    this.record(workspaceId, focused ? 'window_focused' : 'window_blurred', {})
    return this.getState(workspaceId)
  }

  recordExecution(workspaceId: string, input: { exitCode: number | null; durationMs: number; errorSignature: string | null }): ObserverState {
    this.record(workspaceId, input.exitCode !== 0 || input.errorSignature ? 'execution_error' : 'code_executed', input)
    const state = this.getState(workspaceId)
    if (state.repeatedErrorCount === 3) this.record(workspaceId, 'possible_learning_loop', { repeatedErrorCount: state.repeatedErrorCount, errorSignature: input.errorSignature })
    return state
  }

  private record(workspaceId: string, type: string, payload: unknown): void {
    const session = this.repository.getActiveSession(workspaceId)
    if (!session) return
    this.repository.addEvent({ id: this.createId(), workspaceId, sessionId: session.id, type, payloadJson: JSON.stringify(payload), createdAt: this.now() })
  }
}
