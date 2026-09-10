import { describe, expect, it } from 'vitest'
import type { StudyWorkspaceRepository } from '../../src/application/study-workspaces/study-workspace-repository'
import { StudyWorkspaceService, workspaceCodeProfile } from '../../src/application/study-workspaces/study-workspace-service'
import type { StudyPlanItem, StudyWorkspaceState } from '../../src/shared/contracts/study-workspace-contract'

class MemoryStudyWorkspaceRepository implements StudyWorkspaceRepository {
  state: StudyWorkspaceState | null = null
  async findState(): Promise<StudyWorkspaceState | null> { return this.state }
  async createState(input: StudyWorkspaceState): Promise<StudyWorkspaceState> { this.state = input; return input }
  async saveDocument(_workspaceId: string, fileName: string, language: string, content: string, revision: number, now: number): Promise<void> { this.state = { ...this.state!, fileName, language, editorContent: content, documentRevision: revision, updatedAt: now } }
  async saveNotes(_workspaceId: string, notes: string, revision: number, now: number): Promise<void> { this.state = { ...this.state!, notes, notesRevision: revision, updatedAt: now } }
  async updateContextSharing(_workspaceId: string, enabled: boolean, now: number): Promise<void> { this.state = { ...this.state!, shareContextWithAi: enabled, updatedAt: now } }
  async replacePlanStatuses(_workspaceId: string, _sessionId: string, statuses: ReadonlyArray<{ id: string; status: StudyPlanItem['status'] }>, now: number): Promise<void> { this.state = { ...this.state!, plan: this.state!.plan.map((item) => ({ ...item, status: statuses.find((status) => status.id === item.id)?.status ?? item.status })), updatedAt: now } }
  async completePlanItem(_workspaceId: string, _sessionId: string, itemId: string, statuses: ReadonlyArray<{ id: string; status: StudyPlanItem['status'] }>, timer: Pick<StudyWorkspaceState, 'timerDurationSeconds' | 'timerStatus' | 'timerRemainingSeconds' | 'timerStartedAt' | 'timerStartedMonotonicMs' | 'timerBootId' | 'accumulatedFocusSeconds'>, now: number): Promise<boolean> { if (this.state!.plan.find((item) => item.id === itemId)?.status === 'completed') return false; this.state = { ...this.state!, ...timer, plan: this.state!.plan.map((item) => ({ ...item, status: statuses.find((status) => status.id === item.id)?.status ?? item.status })), updatedAt: now }; return true }
  async replacePlan(_workspaceId: string, _sessionId: string, plan: StudyPlanItem[], now: number): Promise<void> { this.state = { ...this.state!, plan, updatedAt: now } }
  async updateTimer(_workspaceId: string, _sessionId: string, timer: Pick<StudyWorkspaceState, 'timerStatus' | 'timerRemainingSeconds' | 'timerStartedAt' | 'timerStartedMonotonicMs' | 'timerBootId' | 'accumulatedFocusSeconds'>, now: number): Promise<void> { this.state = { ...this.state!, ...timer, updatedAt: now } }
  async setTimerDuration(_workspaceId: string, _sessionId: string, durationSeconds: number, now: number): Promise<void> { this.state = { ...this.state!, timerDurationSeconds: durationSeconds, timerRemainingSeconds: durationSeconds, timerStatus: 'idle', timerStartedAt: null, updatedAt: now } }
  flushDrafts(): void {}
  completeAndCreateSession(_workspaceId: string, _currentSessionId: string, nextSessionId: string, plan: StudyPlanItem[], _focusSeconds: number, timerDurationSeconds: number, now: number): void { this.state = { ...this.state!, sessionId: nextSessionId, sessionStartedAt: now, plan, timerStatus: 'idle', timerStartedAt: null, timerRemainingSeconds: timerDurationSeconds, accumulatedFocusSeconds: 0 } }
  listSessionHistory(_workspaceId: string, _limit: number) { return [] }
}

const workspace = { id: '00000000-0000-4000-8000-000000000321', name: 'Algoritmos', objective: 'Aprender listas', status: 'active' as const, createdAt: 1, updatedAt: 1, lastOpenedAt: null, archivedAt: null }

describe('StudyWorkspaceService', () => {
  it.each([
    [{ name: 'Estruturas em C', objective: 'Praticar ponteiros' }, { fileName: 'main.c', language: 'c', marker: '#include <stdio.h>' }],
    [{ name: 'POO Java', objective: 'Praticar classes' }, { fileName: 'Main.java', language: 'java', marker: 'public class Main' }],
    [{ name: 'Python', objective: 'Praticar funções' }, { fileName: 'main.py', language: 'python', marker: 'print("Coach")' }],
    [{ name: 'História', objective: 'Revisar conteúdo' }, { fileName: 'notes.txt', language: 'plaintext', marker: '' }],
  ])('derives a neutral or language-correct initial document', (input, expected) => {
    const profile = workspaceCodeProfile(input)
    expect(profile).toMatchObject({ fileName: expected.fileName, language: expected.language })
    expect(profile.editorContent).toContain(expected.marker)
    expect(profile.editorContent).not.toContain('LinkedList')
  })

  it('does not start a focus timer when there is no daily plan', async () => { const repository = new MemoryStudyWorkspaceRepository(); const service = new StudyWorkspaceService({ repository, getWorkspace: async () => workspace, getRoadmap: () => null, now: () => 100, createId: () => crypto.randomUUID() }); const initial = await service.getState(workspace.id); expect(initial).toMatchObject({ plan: [], timerStatus: 'idle' }); expect((await service.updateTimer(workspace.id, 'start')).timerStatus).toBe('idle'); expect((await service.updateContextSharing(workspace.id, true)).shareContextWithAi).toBe(true); expect((await service.recalculatePlan(workspace.id)).plan).toEqual([]) })
  it('creates one durable initial study state with a guided plan', async () => {
    const repository = new MemoryStudyWorkspaceRepository()
    let id = 0
    const roadmap = { id: crypto.randomUUID(), workspaceId: workspace.id, title: 'Algoritmos', status: 'accepted' as const, generationKind: 'ai_generated' as const, version: 1, providerId: null, modelId: null, createdAt: 1, updatedAt: 1, modules: [{ id: crypto.randomUUID(), title: 'Listas', objective: 'Aprender listas', estimatedMinutes: 120, position: 1, status: 'active' as const, topics: ['Listas encadeadas', 'Inserção', 'Remoção'], outcomes: [], practice: 'Implementar lista', completionCriteria: [], resources: [] }] }
    const service = new StudyWorkspaceService({ repository, getWorkspace: async () => workspace, getRoadmap: () => roadmap, now: () => 100, createId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}` })
    const state = await service.getState(workspace.id)
    expect(state.plan).toHaveLength(4)
    expect(state.shareContextWithAi).toBe(false)
    expect(state.plan[0]).toMatchObject({ status: 'active', durationMinutes: 30, title: 'Listas encadeadas / introdução' })
    expect(state).toMatchObject({ timerDurationSeconds: 1800, timerRemainingSeconds: 1800, timerStatus: 'idle' })
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

  it('activates an item without completing it and applies its timer duration', async () => {
    const repository = new MemoryStudyWorkspaceRepository()
    const roadmap = { id: crypto.randomUUID(), workspaceId: workspace.id, title: 'Algoritmos', status: 'accepted' as const, generationKind: 'ai_generated' as const, version: 1, providerId: null, modelId: null, createdAt: 1, updatedAt: 1, modules: [{ id: crypto.randomUUID(), title: 'Listas', objective: 'Aprender listas', estimatedMinutes: 120, position: 1, status: 'active' as const, topics: ['Listas', 'Filas'], outcomes: [], practice: 'Implementar', completionCriteria: [], resources: [] }] }
    const service = new StudyWorkspaceService({ repository, getWorkspace: async () => workspace, getRoadmap: () => roadmap, now: () => 300, createId: () => crypto.randomUUID() })
    const initial = await service.getState(workspace.id)
    const target = initial.plan[1]!
    const activated = await service.activatePlanItem(workspace.id, target.id)
    expect(activated.plan.find((item) => item.id === target.id)?.status).toBe('active')
    expect(activated.plan.every((item) => item.status !== 'completed')).toBe(true)
    expect(activated.timerDurationSeconds).toBe(target.durationMinutes * 60)
  })

  it('accounts for elapsed running timer time before pausing', async () => {
    const repository = new MemoryStudyWorkspaceRepository()
    let now = 1_000
    const roadmap = { id: crypto.randomUUID(), workspaceId: workspace.id, title: 'Algoritmos', status: 'accepted' as const, generationKind: 'ai_generated' as const, version: 1, providerId: null, modelId: null, createdAt: 1, updatedAt: 1, modules: [{ id: crypto.randomUUID(), title: 'Listas', objective: 'Aprender listas', estimatedMinutes: 120, position: 1, status: 'active' as const, topics: ['Listas'], outcomes: [], practice: 'Implementar', completionCriteria: [], resources: [] }] }
    const service = new StudyWorkspaceService({ repository, getWorkspace: async () => workspace, getRoadmap: () => roadmap, now: () => now, monotonicNow: () => now, bootId: 'test', createId: () => crypto.randomUUID() })
    const initial = await service.getState(workspace.id)
    await service.updateTimer(workspace.id, 'start')
    now += 10_000
    const paused = await service.updateTimer(workspace.id, 'pause')
    expect(paused.timerRemainingSeconds).toBe(initial.timerDurationSeconds - 10)
    expect(paused.timerStatus).toBe('paused')
  })

  it('accounts once across pause, resume, switch, extend and restart', async () => {
    const repository = new MemoryStudyWorkspaceRepository(); let now = 1_000; let monotonic = 50
    const plan: StudyPlanItem[] = [{ id: crypto.randomUUID(), title: 'A', durationMinutes: 20, position: 1, status: 'active' }, { id: crypto.randomUUID(), title: 'B', durationMinutes: 30, position: 2, status: 'pending' }]
    repository.state = { workspaceId: workspace.id, sessionId: crypto.randomUUID(), sessionStartedAt: now, fileName: 'main.py', language: 'python', editorContent: '', notes: '', shareContextWithAi: false, timerDurationSeconds: 1200, timerRemainingSeconds: 1200, timerStatus: 'idle', timerStartedAt: null, timerStartedMonotonicMs: null, timerBootId: null, plan, updatedAt: now, documentRevision: 0, notesRevision: 0, accumulatedFocusSeconds: 0 }
    const service = new StudyWorkspaceService({ repository, getWorkspace: async () => workspace, now: () => now, monotonicNow: () => monotonic, bootId: 'boot' })
    await service.updateTimer(workspace.id, 'start'); now += 10_000; monotonic += 10_000
    expect((await service.updateTimer(workspace.id, 'pause')).accumulatedFocusSeconds).toBe(10)
    await service.updateTimer(workspace.id, 'start'); now += 5_000; monotonic += 5_000
    const switched = await service.activatePlanItem(workspace.id, plan[1]!.id)
    expect(switched.accumulatedFocusSeconds).toBe(15); expect(switched.timerRemainingSeconds).toBe(1800)
    await service.updateTimer(workspace.id, 'start'); now += 3_000; monotonic += 3_000
    const extended = await service.updateTimer(workspace.id, 'extend')
    expect(extended.accumulatedFocusSeconds).toBe(18); expect(extended.timerRemainingSeconds).toBe(2397)
    now -= 60_000; monotonic += 2_000
    expect((await service.updateTimer(workspace.id, 'pause')).accumulatedFocusSeconds).toBe(20)
    const restarted = new StudyWorkspaceService({ repository, getWorkspace: async () => workspace, now: () => now, monotonicNow: () => 1, bootId: 'new-boot' })
    expect((await restarted.getState(workspace.id)).accumulatedFocusSeconds).toBe(20)
  })

  it('expires without learning completion and completes a plan item idempotently', async () => {
    const repository = new MemoryStudyWorkspaceRepository(); let now = 1_000; const item = { id: crypto.randomUUID(), title: 'Revisar', durationMinutes: 5, position: 1, status: 'active' as const, topicId: 'topic' }
    repository.state = { workspaceId: workspace.id, sessionId: crypto.randomUUID(), sessionStartedAt: now, fileName: 'main.py', language: 'python', editorContent: '', notes: '', shareContextWithAi: false, timerDurationSeconds: 300, timerRemainingSeconds: 300, timerStatus: 'idle', timerStartedAt: null, plan: [item], updatedAt: now, documentRevision: 0, notesRevision: 0, accumulatedFocusSeconds: 0 }
    const service = new StudyWorkspaceService({ repository, getWorkspace: async () => workspace, now: () => now, monotonicNow: () => now, bootId: 'boot' })
    await service.updateTimer(workspace.id, 'start'); now += 300_000
    const expired = await service.updateTimer(workspace.id, 'pause')
    expect(expired.plan[0]?.status).toBe('active'); expect(expired.accumulatedFocusSeconds).toBe(300)
    const completed = await service.completePlanItem(workspace.id, item.id); const repeated = await service.completePlanItem(workspace.id, item.id)
    expect(completed.plan[0]?.status).toBe('completed'); expect(repeated).toEqual(completed); expect(repeated.accumulatedFocusSeconds).toBe(300)
  })
})
