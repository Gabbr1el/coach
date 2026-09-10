import type { Workspace } from '../../shared/contracts/workspace-contract'
import type { StudyPlanItem, StudyWorkspaceState } from '../../shared/contracts/study-workspace-contract'
import type { DailyStudyReport } from '../../shared/contracts/study-workspace-contract'
import type { StudyWorkspaceRepository } from './study-workspace-repository'
import { createWorkspaceEvent, type WorkspaceEventBus } from '../events/workspace-event-bus'
import type { Roadmap } from '../../shared/contracts/roadmap-contract'
import type { StudyProgressState } from '../../shared/contracts/study-progress-contract'
import { deriveDailyPlan } from './daily-plan'

export interface StudyWorkspaceServiceDependencies {
  readonly repository: StudyWorkspaceRepository
  readonly getWorkspace: (id: string) => Promise<Workspace | null>
  readonly now?: () => number
  readonly monotonicNow?: () => number
  readonly bootId?: string
  readonly createId?: () => string
  readonly eventBus?: WorkspaceEventBus
  readonly getRoadmap?: (workspaceId: string) => Roadmap | null
  readonly getStudyProgress?: (workspaceId: string) => StudyProgressState | null
  readonly getPlanContext?: (workspaceId: string) => { availableMinutes: number; phase: 'upcoming' | 'near' | 'today' | 'passed' | null; learningStates: Map<string, import('../study-progress/topic-learning').TopicLearningState>; startMinutes: number; dayKey: string; lastPlannedDayKey: string | null }
  readonly getTodayPlan?: (workspaceId: string) => StudyPlanItem[]
  readonly replanWeek?: () => void
}

interface WorkspaceCodeProfile { fileName: string; language: string; editorContent: string }

export function workspaceCodeProfile(workspace: Pick<Workspace, 'name' | 'objective'>): WorkspaceCodeProfile {
  const context = `${workspace.name} ${workspace.objective}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/\bjava\b/.test(context)) return { fileName: 'Main.java', language: 'java', editorContent: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Coach");\n    }\n}\n' }
  if (/\blinguagem\s+c\b|\bprogramacao\s+(?:em\s+)?c\b|\bponteiros?\b|\bstructs?\b|^c\b/.test(context)) return { fileName: 'main.c', language: 'c', editorContent: '#include <stdio.h>\n\nint main(void) {\n    puts("Coach");\n    return 0;\n}\n' }
  if (/\bpython\b/.test(context)) return { fileName: 'main.py', language: 'python', editorContent: 'print("Coach")\n' }
  return { fileName: 'notes.txt', language: 'plaintext', editorContent: '' }
}

function createRoadmapPlan(workspaceId: string, roadmap: Roadmap | null, progress: StudyProgressState | null, existing: StudyPlanItem[], createId: () => string, context?: { availableMinutes: number; phase: 'upcoming' | 'near' | 'today' | 'passed' | null; learningStates: Map<string, import('../study-progress/topic-learning').TopicLearningState>; startMinutes: number }): StudyPlanItem[] { return roadmap ? deriveDailyPlan({ workspaceId, roadmap, progress, availableMinutes: context?.availableMinutes ?? 120, phase: context?.phase ?? null, learningStates: context?.learningStates ?? new Map(), startMinutes: context?.startMinutes ?? 18 * 60 }, existing, createId) : [] }

export class StudyWorkspaceService {
  private readonly now: () => number
  private readonly monotonicNow: () => number
  private readonly bootId: string
  private readonly createId: () => string

  constructor(private readonly dependencies: StudyWorkspaceServiceDependencies) {
    this.now = dependencies.now ?? Date.now
    this.monotonicNow = dependencies.monotonicNow ?? (() => Math.floor(performance.now()))
    this.bootId = dependencies.bootId ?? crypto.randomUUID()
    this.createId = dependencies.createId ?? (() => crypto.randomUUID())
  }

  async getState(workspaceId: string): Promise<StudyWorkspaceState> {
    const workspace = await this.requireWorkspace(workspaceId)
    const now = this.now()
    const existing = await this.dependencies.repository.findState(workspaceId, now)
    if (existing) {
      if (existing.timerStatus === 'running' && existing.timerBootId !== this.bootId) {
        const checkpoint = this.checkpointTimer(existing, now)
        const running = checkpoint.timerRemainingSeconds > 0
        await this.dependencies.repository.updateTimer(workspaceId, existing.sessionId, { timerStatus: running ? 'running' : 'idle', timerRemainingSeconds: checkpoint.timerRemainingSeconds, timerStartedAt: running ? now : null, timerStartedMonotonicMs: running ? this.monotonicNow() : null, timerBootId: running ? this.bootId : null, accumulatedFocusSeconds: checkpoint.accumulatedFocusSeconds }, now)
        const reconciled = (await this.dependencies.repository.findState(workspaceId, now))!
        return this.dependencies.getTodayPlan ? { ...reconciled, plan: this.dependencies.getTodayPlan(workspaceId) } : reconciled
      }
      return this.dependencies.getTodayPlan ? { ...existing, plan: this.dependencies.getTodayPlan(workspaceId) } : existing
    }
    const initialState: Omit<StudyWorkspaceState, 'plan' | 'timerDurationSeconds' | 'timerRemainingSeconds'> = {
      workspaceId,
      sessionId: this.createId(),
      sessionStartedAt: now,
      ...workspaceCodeProfile(workspace),
      notes: '',
      shareContextWithAi: false,
      timerStatus: 'idle',
      timerStartedAt: null,
      timerStartedMonotonicMs: null,
      timerBootId: null,
      updatedAt: now,
      documentRevision: 0,
      notesRevision: 0,
      accumulatedFocusSeconds: 0,
    }
    try {
      const created = await this.dependencies.repository.createStateFromAuthoritative(initialState, () => this.dependencies.getTodayPlan?.(workspaceId) ?? createRoadmapPlan(workspaceId, this.dependencies.getRoadmap?.(workspaceId) ?? null, this.dependencies.getStudyProgress?.(workspaceId) ?? null, [], this.createId, this.dependencies.getPlanContext?.(workspaceId)))
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
    return this.completePlanItem(workspaceId, itemId)
  }

  async completePlanItem(workspaceId: string, itemId: string): Promise<StudyWorkspaceState> {
    const state = await this.getState(workspaceId)
    const item = state.plan.find((candidate) => candidate.id === itemId)
    if (!item) throw new Error('Study plan item not found')
    if (item.status === 'completed') return state
    const now = this.now()
    const checkpoint = this.checkpointTimer(state, now)
    const nextStatuses: Array<{ id: string; status: StudyPlanItem['status'] }> = state.plan.map((candidate) => ({
      id: candidate.id,
      status: candidate.id === itemId
        ? 'completed' as const
        : candidate.status === 'active' ? 'pending' as const : candidate.status,
    }))
    const nextActive = state.plan.find((candidate) => candidate.position > item.position && candidate.status !== 'completed' && candidate.id !== itemId)
      ?? state.plan.find((candidate) => candidate.status !== 'completed' && candidate.id !== itemId)
      ?? null
    if (nextActive) {
      const status = nextStatuses.find((candidate) => candidate.id === nextActive.id)
      if (status) status.status = 'active'
    }
    const duration = nextActive ? nextActive.durationMinutes * 60 : 60
    await this.dependencies.repository.completePlanItem(workspaceId, state.sessionId, itemId, nextStatuses, { timerDurationSeconds: duration, timerStatus: 'idle', timerRemainingSeconds: duration, timerStartedAt: null, timerStartedMonotonicMs: null, timerBootId: null, accumulatedFocusSeconds: checkpoint.accumulatedFocusSeconds }, now)
    const next = await this.getState(workspaceId)
    this.publish(next, 'plan.changed', { itemId, status: 'completed', explicit: true })
    return next
  }

  async recalculatePlan(workspaceId: string): Promise<StudyWorkspaceState> {
    const state = await this.getState(workspaceId)
    const context = this.dependencies.getPlanContext?.(workspaceId)
    await this.dependencies.repository.recalculatePlanAtomically(workspaceId, state.sessionId, () => {
      this.dependencies.replanWeek?.()
      return this.dependencies.getTodayPlan?.(workspaceId) ?? createRoadmapPlan(workspaceId, this.dependencies.getRoadmap?.(workspaceId) ?? null, this.dependencies.getStudyProgress?.(workspaceId) ?? null, state.plan, this.createId, context)
    }, this.now(), context?.dayKey)
    return this.getState(workspaceId)
  }
  async refreshLivePlan(workspaceId: string): Promise<StudyWorkspaceState> { const context = this.dependencies.getPlanContext?.(workspaceId); if (!context || context.lastPlannedDayKey === context.dayKey) return this.getState(workspaceId); return this.recalculatePlan(workspaceId) }

  async activatePlanItem(workspaceId: string, itemId: string): Promise<StudyWorkspaceState> {
    const state = await this.getState(workspaceId)
    const item = state.plan.find((candidate) => candidate.id === itemId)
    if (!item) throw new Error('Study plan item not found')
    if (item.status === 'completed') return state
    const now = this.now()
    const checkpoint = this.checkpointTimer(state, now)
    const statuses = state.plan.map((candidate) => ({ id: candidate.id, status: candidate.id === itemId ? 'active' as const : candidate.status === 'active' ? 'pending' as const : candidate.status }))
    await this.dependencies.repository.replacePlanStatuses(workspaceId, state.sessionId, statuses, now)
    await this.dependencies.repository.setTimerDuration(workspaceId, state.sessionId, item.durationMinutes * 60, now)
    await this.dependencies.repository.updateTimer(workspaceId, state.sessionId, { timerStatus: 'idle', timerRemainingSeconds: item.durationMinutes * 60, timerStartedAt: null, timerStartedMonotonicMs: null, timerBootId: null, accumulatedFocusSeconds: checkpoint.accumulatedFocusSeconds }, now)
    return this.getState(workspaceId)
  }

  async updateTimer(workspaceId: string, action: 'start' | 'pause' | 'reset' | 'extend'): Promise<StudyWorkspaceState> {
    const state = await this.getState(workspaceId)
    const now = this.now()
    const checkpoint = this.checkpointTimer(state, now)
    const remaining = checkpoint.timerRemainingSeconds
    const hasActivePlanItem = state.plan.some((item) => item.status === 'active')
    const timer = action === 'start' && !hasActivePlanItem
      ? { timerStatus: 'idle' as const, timerRemainingSeconds: remaining, timerStartedAt: null, timerStartedMonotonicMs: null, timerBootId: null, accumulatedFocusSeconds: checkpoint.accumulatedFocusSeconds }
      : action === 'extend'
        ? { timerStatus: 'running' as const, timerRemainingSeconds: Math.min(10800, remaining + 600), timerStartedAt: now, timerStartedMonotonicMs: this.monotonicNow(), timerBootId: this.bootId, accumulatedFocusSeconds: checkpoint.accumulatedFocusSeconds }
      : action === 'reset'
      ? { timerStatus: 'running' as const, timerRemainingSeconds: state.timerDurationSeconds, timerStartedAt: now, timerStartedMonotonicMs: this.monotonicNow(), timerBootId: this.bootId, accumulatedFocusSeconds: checkpoint.accumulatedFocusSeconds }
      : action === 'pause'
        ? { timerStatus: 'paused' as const, timerRemainingSeconds: remaining, timerStartedAt: null, timerStartedMonotonicMs: null, timerBootId: null, accumulatedFocusSeconds: checkpoint.accumulatedFocusSeconds }
        : remaining === 0
          ? { timerStatus: 'idle' as const, timerRemainingSeconds: 0, timerStartedAt: null, timerStartedMonotonicMs: null, timerBootId: null, accumulatedFocusSeconds: checkpoint.accumulatedFocusSeconds }
          : { timerStatus: 'running' as const, timerRemainingSeconds: remaining, timerStartedAt: now, timerStartedMonotonicMs: this.monotonicNow(), timerBootId: this.bootId, accumulatedFocusSeconds: checkpoint.accumulatedFocusSeconds }
    if (action === 'extend') await this.dependencies.repository.setTimerDuration(workspaceId, state.sessionId, Math.min(10800, state.timerDurationSeconds + 600), now)
    await this.dependencies.repository.updateTimer(workspaceId, state.sessionId, timer, now)
    const next = await this.getState(workspaceId)
    this.publish(next, 'timer.changed', { action, status: next.timerStatus, remainingSeconds: next.timerRemainingSeconds })
    return next
  }

  async setTimerDuration(workspaceId: string, durationSeconds: number): Promise<StudyWorkspaceState> {
    const state = await this.getState(workspaceId)
    if (!state.plan.some((item) => item.status === 'active')) return state
    const now = this.now()
    const checkpoint = this.checkpointTimer(state, now)
    await this.dependencies.repository.setTimerDuration(workspaceId, state.sessionId, durationSeconds, now)
    await this.dependencies.repository.updateTimer(workspaceId, state.sessionId, { timerStatus: 'idle', timerRemainingSeconds: durationSeconds, timerStartedAt: null, timerStartedMonotonicMs: null, timerBootId: null, accumulatedFocusSeconds: checkpoint.accumulatedFocusSeconds }, now)
    const next = await this.getState(workspaceId)
    this.publish(next, 'timer.changed', { action: 'duration', durationSeconds })
    return next
  }

  async completeSession(workspaceId: string): Promise<StudyWorkspaceState> {
    const state = await this.getState(workspaceId)
    const workspace = await this.requireWorkspace(workspaceId)
    const now = this.now()
    const focusSeconds = this.checkpointTimer(state, now).accumulatedFocusSeconds
    this.dependencies.repository.completeAndCreateSession(workspaceId, state.sessionId, this.createId(), createRoadmapPlan(workspaceId, this.dependencies.getRoadmap?.(workspaceId) ?? null, this.dependencies.getStudyProgress?.(workspaceId) ?? null, state.plan, this.createId, this.dependencies.getPlanContext?.(workspaceId)), focusSeconds, state.timerDurationSeconds, now)
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
    const monotonicElapsed = state.timerBootId === this.bootId && state.timerStartedMonotonicMs !== null && state.timerStartedMonotonicMs !== undefined
      ? this.monotonicNow() - state.timerStartedMonotonicMs
      : null
    const wallElapsed = now - state.timerStartedAt
    const elapsedMs = monotonicElapsed !== null && monotonicElapsed >= 0 ? monotonicElapsed : Math.min(Math.max(0, wallElapsed), state.timerRemainingSeconds * 1000)
    return Math.max(0, state.timerRemainingSeconds - Math.floor(elapsedMs / 1000))
  }

  private checkpointTimer(state: StudyWorkspaceState, now: number): { timerRemainingSeconds: number; accumulatedFocusSeconds: number } {
    const timerRemainingSeconds = this.effectiveRemaining(state, now)
    const elapsed = state.timerStatus === 'running' ? state.timerRemainingSeconds - timerRemainingSeconds : 0
    return { timerRemainingSeconds, accumulatedFocusSeconds: state.accumulatedFocusSeconds + elapsed }
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
