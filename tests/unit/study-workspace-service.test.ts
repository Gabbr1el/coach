import { describe, expect, it } from 'vitest'
import type { StudyWorkspaceRepository } from '../../src/application/study-workspaces/study-workspace-repository'
import { StudyWorkspaceService } from '../../src/application/study-workspaces/study-workspace-service'
import type { StudyPlanItem, StudyWorkspaceState } from '../../src/shared/contracts/study-workspace-contract'

class MemoryStudyWorkspaceRepository implements StudyWorkspaceRepository {
  state: StudyWorkspaceState | null = null
  async findState(): Promise<StudyWorkspaceState | null> { return this.state }
  async createState(input: StudyWorkspaceState): Promise<StudyWorkspaceState> { this.state = input; return input }
  async saveDocument(_workspaceId: string, fileName: string, language: string, content: string, revision: number, now: number): Promise<void> { this.state = { ...this.state!, fileName, language, editorContent: content, documentRevision: revision, updatedAt: now } }
  async saveNotes(_workspaceId: string, notes: string, revision: number, now: number): Promise<void> { this.state = { ...this.state!, notes, notesRevision: revision, updatedAt: now } }
  async updateContextSharing(_workspaceId: string, enabled: boolean, now: number): Promise<void> { this.state = { ...this.state!, shareContextWithAi: enabled, updatedAt: now } }
  async replacePlanStatuses(_workspaceId: string, _sessionId: string, statuses: ReadonlyArray<{ id: string; status: StudyPlanItem['status'] }>, now: number): Promise<void> { this.state = { ...this.state!, plan: this.state!.plan.map((item) => ({ ...item, status: statuses.find((status) => status.id === item.id)?.status ?? item.status })), updatedAt: now } }
  async updateTimer(_workspaceId: string, _sessionId: string, timer: Pick<StudyWorkspaceState, 'timerStatus' | 'timerRemainingSeconds' | 'timerStartedAt' | 'accumulatedFocusSeconds'>, now: number): Promise<void> { this.state = { ...this.state!, ...timer, updatedAt: now } }
  async setTimerDuration(_workspaceId: string, _sessionId: string, durationSeconds: number, now: number): Promise<void> { this.state = { ...this.state!, timerDurationSeconds: durationSeconds, timerRemainingSeconds: durationSeconds, timerStatus: 'idle', timerStartedAt: null, updatedAt: now } }
  flushDrafts(): void {}
  completeAndCreateSession(_workspaceId: string, _currentSessionId: string, nextSessionId: string, plan: StudyPlanItem[], _focusSeconds: number, timerDurationSeconds: number, now: number): void { this.state = { ...this.state!, sessionId: nextSessionId, sessionStartedAt: now, plan, timerStatus: 'idle', timerStartedAt: null, timerRemainingSeconds: timerDurationSeconds, accumulatedFocusSeconds: 0 } }
  listSessionHistory(_workspaceId: string, _limit: number) { return [] }
}

const workspace = { id: '00000000-0000-4000-8000-000000000321', name: 'Algoritmos', objective: 'Aprender listas', status: 'active' as const, createdAt: 1, updatedAt: 1, lastOpenedAt: null, archivedAt: null }

describe('StudyWorkspaceService', () => {
  it('creates one durable initial study state with a guided plan', async () => {
    const repository = new MemoryStudyWorkspaceRepository()
    let id = 0
    const service = new StudyWorkspaceService({ repository, getWorkspace: async () => workspace, now: () => 100, createId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}` })
    const state = await service.getState(workspace.id)
    expect(state.plan).toHaveLength(5)
    expect(state.shareContextWithAi).toBe(false)
    expect(state.plan[0]).toMatchObject({ status: 'active', durationMinutes: 20 })
    expect((await service.getState(workspace.id)).sessionId).toBe(state.sessionId)
  })

  it('persists editor and notes changes', async () => {
    const repository = new MemoryStudyWorkspaceRepository()
    const service = new StudyWorkspaceService({ repository, getWorkspace: async () => workspace, now: () => 200, createId: () => crypto.randomUUID() })
    await service.getState(workspace.id)
    expect((await service.saveDocument(workspace.id, 'lista.py', 'python', 'print(1)', 1)).editorContent).toBe('print(1)')
    expect((await service.saveNotes(workspace.id, 'Revisar ponteiros', 1)).notes).toBe('Revisar ponteiros')
    expect((await service.updateContextSharing(workspace.id, true)).shareContextWithAi).toBe(true)
  })

  it('accounts for elapsed running timer time before pausing', async () => {
    const repository = new MemoryStudyWorkspaceRepository()
    let now = 1_000
    const service = new StudyWorkspaceService({ repository, getWorkspace: async () => workspace, now: () => now, createId: () => crypto.randomUUID() })
    await service.getState(workspace.id)
    await service.updateTimer(workspace.id, 'start')
    now += 10_000
    const paused = await service.updateTimer(workspace.id, 'pause')
    expect(paused.timerRemainingSeconds).toBe(1490)
    expect(paused.timerStatus).toBe('paused')
  })
})
