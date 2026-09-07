import type { Workspace } from '../../shared/contracts/workspace-contract'
import type { StudyPlanItem, StudyWorkspaceState } from '../../shared/contracts/study-workspace-contract'
import type { DailyStudyReport } from '../../shared/contracts/study-workspace-contract'
import type { StudyWorkspaceRepository } from './study-workspace-repository'
import { createWorkspaceEvent, type WorkspaceEventBus } from '../events/workspace-event-bus'

export interface StudyWorkspaceServiceDependencies {
  readonly repository: StudyWorkspaceRepository
  readonly getWorkspace: (id: string) => Promise<Workspace | null>
  readonly now?: () => number
  readonly createId?: () => string
  readonly eventBus?: WorkspaceEventBus
}

const DEFAULT_CODE = `class Node:
    def __init__(self, value):
        self.value = value
        self.next = None


class LinkedList:
    def __init__(self):
        self.head = None

    def append(self, value):
        new_node = Node(value)
        if not self.head:
            self.head = new_node
            return

        current = self.head
        while current.next:
            current = current.next
        current.next = new_node
`

function createDefaultPlan(workspace: Workspace, createId: () => string): StudyPlanItem[] {
  return [
    { id: createId(), title: `Revisar fundamentos de ${workspace.name}`, durationMinutes: 20, position: 1, status: 'active' },
    { id: createId(), title: 'Praticar o conceito principal', durationMinutes: 35, position: 2, status: 'pending' },
    { id: createId(), title: 'Resolver exercícios sem ajuda', durationMinutes: 30, position: 3, status: 'pending' },
    { id: createId(), title: 'Explicar o conteúdo com suas palavras', durationMinutes: 15, position: 4, status: 'pending' },
    { id: createId(), title: 'Registrar dúvidas e aprendizados', durationMinutes: 10, position: 5, status: 'pending' },
  ]
}

export class StudyWorkspaceService {
  private readonly now: () => number
  private readonly createId: () => string

  constructor(private readonly dependencies: StudyWorkspaceServiceDependencies) {
    this.now = dependencies.now ?? Date.now
    this.createId = dependencies.createId ?? (() => crypto.randomUUID())
  }

  async getState(workspaceId: string): Promise<StudyWorkspaceState> {
    const workspace = await this.requireWorkspace(workspaceId)
    const now = this.now()
    const existing = await this.dependencies.repository.findState(workspaceId, now)
    if (existing) return existing
    const initialState: StudyWorkspaceState = {
      workspaceId,
      sessionId: this.createId(),
      sessionStartedAt: now,
      fileName: 'main.py',
      language: 'python',
      editorContent: DEFAULT_CODE,
      notes: '',
      shareContextWithAi: false,
      timerDurationSeconds: 1500,
      timerRemainingSeconds: 1500,
      timerStatus: 'idle',
      timerStartedAt: null,
      plan: createDefaultPlan(workspace, this.createId),
      updatedAt: now,
      documentRevision: 0,
      notesRevision: 0,
      accumulatedFocusSeconds: 0,
    }
    try {
      const created = await this.dependencies.repository.createState(initialState)
      this.publish(created, 'session.started', { source: 'workspace-initialization' })
      return created
    } catch (error) {
      const concurrent = await this.dependencies.repository.findState(workspaceId, now)
      if (concurrent) return concurrent
      throw error
    }
  }

  async saveDocument(workspaceId: string, fileName: string, language: string, content: string, revision: number): Promise<StudyWorkspaceState> {
    await this.getState(workspaceId)
    await this.dependencies.repository.saveDocument(workspaceId, fileName.trim(), language.trim(), content, revision, this.now())
    const next = await this.getState(workspaceId)
    this.publish(next, 'document.changed', { fileName: next.fileName, revision: next.documentRevision })
    return next
  }

  async saveNotes(workspaceId: string, notes: string, revision: number): Promise<StudyWorkspaceState> {
    await this.getState(workspaceId)
    await this.dependencies.repository.saveNotes(workspaceId, notes, revision, this.now())
    const next = await this.getState(workspaceId)
    this.publish(next, 'notes.changed', { revision: next.notesRevision })
    return next
  }

  async updateContextSharing(workspaceId: string, enabled: boolean): Promise<StudyWorkspaceState> {
    await this.getState(workspaceId)
    await this.dependencies.repository.updateContextSharing(workspaceId, enabled, this.now())
    return this.getState(workspaceId)
  }

  async togglePlanItem(workspaceId: string, itemId: string): Promise<StudyWorkspaceState> {
    const state = await this.getState(workspaceId)
    const item = state.plan.find((candidate) => candidate.id === itemId)
    if (!item) throw new Error('Study plan item not found')
    const nextStatuses = state.plan.map((candidate) => ({
      id: candidate.id,
      status: candidate.id === itemId
        ? (candidate.status === 'completed' ? 'active' : 'completed') as StudyPlanItem['status']
        : candidate.status === 'active' ? 'pending' as const : candidate.status,
    }))
    if (item.status !== 'completed') {
      const next = state.plan.find((candidate) => candidate.position > item.position && candidate.status !== 'completed' && candidate.id !== itemId)
        ?? state.plan.find((candidate) => candidate.status !== 'completed' && candidate.id !== itemId)
      if (next) {
        const status = nextStatuses.find((candidate) => candidate.id === next.id)
        if (status) status.status = 'active'
      }
    }
    await this.dependencies.repository.replacePlanStatuses(workspaceId, state.sessionId, nextStatuses, this.now())
    const next = await this.getState(workspaceId)
    this.publish(next, 'plan.changed', { itemId, status: next.plan.find((candidate) => candidate.id === itemId)?.status })
    return next
  }

  async updateTimer(workspaceId: string, action: 'start' | 'pause' | 'reset'): Promise<StudyWorkspaceState> {
    const state = await this.getState(workspaceId)
    const now = this.now()
    const remaining = this.effectiveRemaining(state, now)
    const timer = action === 'reset'
      ? { timerStatus: 'idle' as const, timerRemainingSeconds: state.timerDurationSeconds, timerStartedAt: null, accumulatedFocusSeconds: state.accumulatedFocusSeconds + (state.timerDurationSeconds - remaining) }
      : action === 'pause'
        ? { timerStatus: 'paused' as const, timerRemainingSeconds: remaining, timerStartedAt: null, accumulatedFocusSeconds: state.accumulatedFocusSeconds }
        : remaining === 0
          ? { timerStatus: 'idle' as const, timerRemainingSeconds: 0, timerStartedAt: null, accumulatedFocusSeconds: state.accumulatedFocusSeconds }
          : { timerStatus: 'running' as const, timerRemainingSeconds: remaining, timerStartedAt: now, accumulatedFocusSeconds: state.accumulatedFocusSeconds }
    await this.dependencies.repository.updateTimer(workspaceId, state.sessionId, timer, now)
    const next = await this.getState(workspaceId)
    this.publish(next, 'timer.changed', { action, status: next.timerStatus, remainingSeconds: next.timerRemainingSeconds })
    return next
  }

  async setTimerDuration(workspaceId: string, durationSeconds: number): Promise<StudyWorkspaceState> {
    const state = await this.getState(workspaceId)
    await this.dependencies.repository.setTimerDuration(workspaceId, state.sessionId, durationSeconds, this.now())
    const next = await this.getState(workspaceId)
    this.publish(next, 'timer.changed', { action: 'duration', durationSeconds })
    return next
  }

  async completeSession(workspaceId: string): Promise<StudyWorkspaceState> {
    const state = await this.getState(workspaceId)
    const workspace = await this.requireWorkspace(workspaceId)
    const now = this.now()
    const focusSeconds = state.accumulatedFocusSeconds + state.timerDurationSeconds - this.effectiveRemaining(state, now)
    this.dependencies.repository.completeAndCreateSession(workspaceId, state.sessionId, this.createId(), createDefaultPlan(workspace, this.createId), focusSeconds, state.timerDurationSeconds, now)
    const next = await this.getState(workspaceId)
    this.dependencies.eventBus?.publish(createWorkspaceEvent(workspaceId, state.sessionId, 'session.completed', { focusSeconds }, now))
    this.publish(next, 'session.started', { source: 'previous-session-completed' })
    return next
  }

  async listSessionHistory(workspaceId: string): Promise<DailyStudyReport[]> {
    await this.requireWorkspace(workspaceId)
    return this.dependencies.repository.listSessionHistory(workspaceId, 100)
  }

  flushDrafts(input: { workspaceId: string; fileName: string; language: string; content: string; notes: string; documentRevision: number; notesRevision: number }): void {
    this.dependencies.repository.flushDrafts({ ...input, now: this.now() })
  }

  private effectiveRemaining(state: StudyWorkspaceState, now: number): number {
    if (state.timerStatus !== 'running' || !state.timerStartedAt) return state.timerRemainingSeconds
    return Math.max(0, state.timerRemainingSeconds - Math.floor((now - state.timerStartedAt) / 1000))
  }

  private async requireWorkspace(workspaceId: string): Promise<Workspace> {
    const workspace = await this.dependencies.getWorkspace(workspaceId)
    if (!workspace || workspace.status !== 'active') throw new Error('Workspace not found')
    return workspace
  }

  private publish(state: StudyWorkspaceState, type: Parameters<typeof createWorkspaceEvent>[2], payload: unknown): void {
    this.dependencies.eventBus?.publish(createWorkspaceEvent(state.workspaceId, state.sessionId, type, payload, this.now()))
  }
}
