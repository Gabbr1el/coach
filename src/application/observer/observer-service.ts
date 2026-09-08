import type { ObserverState } from '../../shared/contracts/observer-contract'

export interface ObserverRepository {
  getActiveSession(workspaceId: string): { id: string } | null
  addEvent(input: { id: string; workspaceId: string; sessionId: string; type: string; payloadJson: string; createdAt: number }): void
  listSession(workspaceId: string, sessionId: string): Array<{ type: string; payloadJson: string; createdAt: number }>
}

interface ExecutionObservation { exitCode: number | null; durationMs: number; errorSignature: string | null; sourceRevision?: string; topicId?: string; topicConfidence?: number }
interface ExecutionPayload extends ExecutionObservation { topicId?: string }

function parsePayload(value: string): ExecutionPayload {
  try { return JSON.parse(value) as ExecutionPayload } catch { return { exitCode: null, durationMs: 0, errorSignature: null } }
}

function executionSignature(payload: ExecutionPayload): string { return payload.errorSignature ?? `exit:${payload.exitCode ?? 'signal'}` }

export class ObserverService {
  constructor(private readonly repository: ObserverRepository, private readonly now = Date.now, private readonly createId = () => crypto.randomUUID()) {}

  getState(workspaceId: string): ObserverState {
    const session = this.repository.getActiveSession(workspaceId)
    if (!session) return { active: false, repeatedErrorCount: 0, interventionSuggested: false, focusExitCount: 0, timeAwaySeconds: 0 }
    const events = this.repository.listSession(workspaceId, session.id)
    const executions = events.filter((event) => event.type === 'execution_error' || event.type === 'code_executed')
    const latest = executions.at(-1)
    const latestPayload = latest?.type === 'execution_error' ? parsePayload(latest.payloadJson) : null
    const latestSignature = latestPayload ? executionSignature(latestPayload) : null
    let normalizedCount = 0
    for (const event of executions.slice().reverse()) {
      const payload = parsePayload(event.payloadJson)
      if (event.type !== 'execution_error' || executionSignature(payload) !== latestSignature) break
      normalizedCount += 1
    }
    let latestSuccessIndex = -1
    for (let index = events.length - 1; index >= 0; index -= 1) if (events[index]?.type === 'code_executed') { latestSuccessIndex = index; break }
    const interventionRecorded = latestSignature !== null && events.slice(latestSuccessIndex + 1).some((event) => event.type === 'possible_learning_loop' && executionSignature(parsePayload(event.payloadJson)) === latestSignature)
    let timeAwaySeconds = 0
    let focusExitCount = 0
    for (const event of events) if (event.type === 'window_focused') {
      const payload = parsePayload(event.payloadJson) as ExecutionPayload & { awaySeconds?: number; focusExit?: boolean }
      if (payload.focusExit) { timeAwaySeconds += payload.awaySeconds ?? 0; focusExitCount += 1 }
    }
    return { active: true, repeatedErrorCount: normalizedCount, interventionSuggested: normalizedCount >= 3 && !interventionRecorded, focusExitCount, timeAwaySeconds }
  }

  recordFocus(workspaceId: string, focused: boolean): ObserverState {
    if (!focused) this.record(workspaceId, 'window_blurred', {})
    else {
      const session = this.repository.getActiveSession(workspaceId)
      const events = session ? this.repository.listSession(workspaceId, session.id) : []
      const lastFocusEvent = events.slice().reverse().find((event) => event.type === 'window_blurred' || event.type === 'window_focused')
      const awaySeconds = lastFocusEvent?.type === 'window_blurred' ? Math.max(0, Math.floor((this.now() - lastFocusEvent.createdAt) / 1000)) : 0
      this.record(workspaceId, 'window_focused', { awaySeconds, focusExit: awaySeconds >= 15 })
    }
    return this.getState(workspaceId)
  }

  recordExecution(workspaceId: string, input: ExecutionObservation): ObserverState {
    const payload: ExecutionPayload = { ...input, topicId: input.topicId && (input.topicConfidence ?? 0) >= 0.8 ? input.topicId : undefined }
    const failed = input.exitCode !== 0 || input.errorSignature !== null
    if (failed) {
      const session = this.repository.getActiveSession(workspaceId)
      const previous = session ? this.repository.listSession(workspaceId, session.id).filter((event) => event.type === 'execution_error').at(-1) : undefined
      const previousPayload = previous ? parsePayload(previous.payloadJson) : null
      if (previousPayload && executionSignature(previousPayload) === executionSignature(payload) && previousPayload.sourceRevision && input.sourceRevision && previousPayload.sourceRevision !== input.sourceRevision) {
        this.record(workspaceId, 'code_executed', { ...payload, progress: true, unresolvedError: true })
        return this.getState(workspaceId)
      }
    }
    this.record(workspaceId, failed ? 'execution_error' : 'code_executed', payload)
    const state = this.getState(workspaceId)
    if (state.interventionSuggested) {
      this.record(workspaceId, 'possible_learning_loop', { repeatedErrorCount: state.repeatedErrorCount, errorSignature: input.errorSignature, exitCode: input.exitCode, topicId: payload.topicId })
      return { ...state, interventionSuggested: true }
    }
    return state
  }

  private record(workspaceId: string, type: string, payload: unknown): void {
    const session = this.repository.getActiveSession(workspaceId)
    if (!session) return
    this.repository.addEvent({ id: this.createId(), workspaceId, sessionId: session.id, type, payloadJson: JSON.stringify(payload), createdAt: this.now() })
  }
}
