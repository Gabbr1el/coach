import { describe, expect, it } from 'vitest'
import { CurrentWorkspaceContextService } from '../../src/application/workspaces/current-workspace-context'

describe('CurrentWorkspaceContextService', () => {
  it('assembles authoritative workspace state in the main process', async () => {
    const workspace = { id: 'w', name: 'Java', objective: 'POO', status: 'active' as const, createdAt: 1, updatedAt: 1, lastOpenedAt: null, archivedAt: null }
    const study = { workspaceId: 'w', sessionId: 's', sessionStartedAt: 1, fileName: 'Main.java', language: 'java', editorContent: '', notes: '', shareContextWithAi: true, timerDurationSeconds: 1200, timerRemainingSeconds: 1200, timerStatus: 'idle' as const, timerStartedAt: null, plan: [{ id: 'p', title: 'Classes', durationMinutes: 20, position: 1, status: 'active' as const }], updatedAt: 2, documentRevision: 0, notesRevision: 0, accumulatedFocusSeconds: 0 }
    const service = new CurrentWorkspaceContextService({ getWorkspace: async () => workspace, getStudyState: async () => study, getObserverState: () => ({ active: true, repeatedErrorCount: 0, interventionSuggested: false, focusExitCount: 0, timeAwaySeconds: 0 }), getWorkspaceMemory: () => 'memoria' })
    await expect(service.get('w')).resolves.toMatchObject({ version: 2, workspace: { name: 'Java' }, activePlanItem: 'Classes', memory: 'memoria' })
  })
})
