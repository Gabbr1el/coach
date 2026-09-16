import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, payload: unknown) => unknown>() }))
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (event: unknown, payload: unknown) => unknown) => ipc.handlers.set(channel, handler) } }))
vi.mock('../../src/main/ipc/trusted-sender', () => ({ assertTrustedSender: vi.fn() }))

import { openCoachDatabase } from '../../src/main/database/connection'
import { registerStudyLessonHandlers } from '../../src/main/ipc/study-lesson-handlers'
import { STUDY_LESSON_CHANNELS } from '../../src/shared/contracts/study-lesson-channels'

const migrationsFolder = resolve('drizzle/migrations')
const ids = { workspaceId: crypto.randomUUID(), otherWorkspaceId: crypto.randomUUID(), roadmapId: crypto.randomUUID(), moduleId: crypto.randomUUID(), lessonId: 'prefetched-lesson', topicId: '' }
ids.topicId = `${ids.moduleId}:Future`
const tuple = { workspaceId: ids.workspaceId, roadmapId: ids.roadmapId, moduleId: ids.moduleId, topicId: ids.topicId, lessonId: ids.lessonId }
const evaluate = { ...tuple, checkpointId: 'check', selectedOptionId: 'option', studentJustification: '' }
const adapt = { ...tuple, blockId: 'block', instruction: 'Explique de outro modo', mode: 'CUSTOM' }
const selection = { workspaceId: ids.workspaceId, lessonId: ids.lessonId, blockId: 'block' }
const activation = { ...selection, adaptationId: 'adaptation' }

function fixture() {
  const database = openCoachDatabase({ databasePath: ':memory:', migrationsFolder })
  for (const workspaceId of [ids.workspaceId, ids.otherWorkspaceId]) database.sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES (?,'W','O','active',1,1)").run(workspaceId)
  database.sqlite.prepare("INSERT INTO roadmaps (id,workspace_id,title,status,generation_kind,version,provider_id,model_id,created_at,updated_at) VALUES (?,?,'R','accepted','ai_generated',1,NULL,NULL,1,1)").run(ids.roadmapId, ids.workspaceId)
  database.sqlite.prepare("INSERT INTO roadmap_modules (id,roadmap_id,title,objective,estimated_minutes,position,status,topics_json,outcomes_json,practice,completion_criteria_json,resources_json) VALUES (?,?,'M','O',60,1,'locked','[\"Future\"]','[]','P','[]','[]')").run(ids.moduleId, ids.roadmapId)
  database.sqlite.prepare("INSERT INTO study_lessons (id,workspace_id,roadmap_id,module_id,topic_id,generation_kind,content_json,created_at,updated_at) VALUES (?,?,?,?,?,'ai_generated','{}',1,1)").run(ids.lessonId, ids.workspaceId, ids.roadmapId, ids.moduleId, ids.topicId)
  const lesson = { id: ids.lessonId }
  const service = {
    getOrCreate: vi.fn(() => ({ status: 'ready', lesson, sources: [] })),
    evaluate: vi.fn(() => ({ correct: true })),
    adaptSection: vi.fn(() => ({ id: 'adaptation' })),
    listAdaptations: vi.fn(() => []),
    restoreOriginal: vi.fn(() => lesson),
    activateAdaptation: vi.fn(() => lesson),
    getPreferences: vi.fn(), updatePreferences: vi.fn(),
  }
  registerStudyLessonHandlers(service as never, database)
  return { database, service }
}

const calls = [
  [STUDY_LESSON_CHANNELS.evaluate, evaluate, 'evaluate'],
  [STUDY_LESSON_CHANNELS.adaptSection, adapt, 'adaptSection'],
  [STUDY_LESSON_CHANNELS.listAdaptations, selection, 'listAdaptations'],
  [STUDY_LESSON_CHANNELS.restoreOriginal, selection, 'restoreOriginal'],
  [STUDY_LESSON_CHANNELS.activateAdaptation, activation, 'activateAdaptation'],
] as const

describe('StudyLesson IPC curricular authorization', () => {
  beforeEach(() => ipc.handlers.clear())

  it('rejects every direct channel for blocked prefetched content before read or mutation', async () => {
    const { database, service } = fixture()
    for (const [channel, payload] of calls) await expect(Promise.resolve().then(() => ipc.handlers.get(channel)!({}, payload))).rejects.toThrow('Topic is locked')
    for (const [, , method] of calls) expect(service[method]).not.toHaveBeenCalled()
    database.close()
  })

  it('allows every channel after unlock and derives the persisted tuple', async () => {
    const { database, service } = fixture()
    database.sqlite.prepare("UPDATE roadmap_modules SET status='active' WHERE id=?").run(ids.moduleId)
    for (const [channel, payload] of calls) await expect(Promise.resolve(ipc.handlers.get(channel)!({}, payload))).resolves.toBeDefined()
    expect(service.getOrCreate).toHaveBeenCalledWith({ workspaceId: ids.workspaceId, roadmapId: ids.roadmapId, moduleId: ids.moduleId, topicId: ids.topicId })
    database.close()
  })

  it('rejects cross-workspace ownership and an inconsistent renderer tuple', async () => {
    const { database, service } = fixture()
    database.sqlite.prepare("UPDATE roadmap_modules SET status='active' WHERE id=?").run(ids.moduleId)
    await expect(Promise.resolve().then(() => ipc.handlers.get(STUDY_LESSON_CHANNELS.listAdaptations)!({}, { ...selection, workspaceId: ids.otherWorkspaceId }))).rejects.toThrow('Study lesson not found')
    await expect(Promise.resolve().then(() => ipc.handlers.get(STUDY_LESSON_CHANNELS.evaluate)!({}, { ...evaluate, topicId: `${ids.moduleId}:Forged` }))).rejects.toThrow('ownership mismatch')
    expect(service.listAdaptations).not.toHaveBeenCalled()
    expect(service.evaluate).not.toHaveBeenCalled()
    database.close()
  })
})
