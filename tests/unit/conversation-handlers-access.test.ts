import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (event: any, payload: unknown) => unknown>() }))
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (event: any, payload: unknown) => unknown) => ipc.handlers.set(channel, handler) } }))
vi.mock('../../src/main/ipc/trusted-sender', () => ({ assertTrustedSender: vi.fn() }))

import { openCoachDatabase } from '../../src/main/database/connection'
import { registerConversationHandlers } from '../../src/main/ipc/conversation-handlers'
import { CONVERSATION_CHANNELS } from '../../src/shared/contracts/conversation-channels'

const migrationsFolder = resolve('drizzle/migrations')
const workspaceId = '00000000-0000-4000-8000-000000000001'
const otherWorkspaceId = '00000000-0000-4000-8000-000000000002'
const roadmapId = '00000000-0000-4000-8000-000000000003'
const moduleId = 'module-one'
const topicId = `${moduleId}:Topic`
const exerciseId = 'exercise-one'

function fixture(moduleStatus: 'locked' | 'available') {
  const database = openCoachDatabase({ databasePath: ':memory:', migrationsFolder })
  for (const id of [workspaceId, otherWorkspaceId]) database.sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES (?,'W','O','active',1,1)").run(id)
  database.sqlite.prepare("INSERT INTO roadmaps (id,workspace_id,title,status,generation_kind,version,provider_id,model_id,created_at,updated_at) VALUES (?,?,'R','accepted','ai_generated',1,NULL,NULL,1,1)").run(roadmapId, workspaceId)
  database.sqlite.prepare("INSERT INTO roadmap_modules (id,roadmap_id,title,objective,estimated_minutes,position,status,topics_json,outcomes_json,practice,completion_criteria_json,resources_json) VALUES (?,?, 'M','O',60,1,?,'[\"Topic\"]','[]','P','[]','[]')").run(moduleId, roadmapId, moduleStatus)
  database.sqlite.prepare("INSERT INTO exercise_sets (id,workspace_id,roadmap_id,module_id,topic_id,lesson_id,status,retry_after,last_error_code,created_at,updated_at) VALUES ('set-one',?,?,?,?,?,'ready',NULL,NULL,1,1)").run(workspaceId, roadmapId, moduleId, topicId, 'lesson-one')
  database.sqlite.prepare("INSERT INTO exercises (id,set_id,position,kind,difficulty,title,statement,input_description,output_description,language,starter_code,prediction_prompt,code_to_observe,required_for_topic_completion,public_tests_json,private_tests_json,reference_solution,expected_prediction,hint,created_at) VALUES (?,'set-one',1,'PROGRAMMING_PROBLEM','standard','E','S','','','python','pass',NULL,NULL,1,'[]','[]','pass',NULL,'H',1)").run(exerciseId)
  database.sqlite.prepare("INSERT INTO exercise_progress (workspace_id,exercise_id,status,current_code,attempts,last_run_json,last_submission_json,passed_tests,total_tests,help_used,first_try_success,help_count,passed_at,updated_at) VALUES (?,?,'in_progress','pass',0,NULL,NULL,0,0,0,0,0,NULL,1)").run(workspaceId, exerciseId)
  return database
}

function register(database: ReturnType<typeof fixture>) {
  const streamMessage = vi.fn(async function* () { yield 'ok' })
  const workspaceService = { streamMessage, listMessages: vi.fn() }
  registerConversationHandlers({} as never, workspaceService as never, {} as never, undefined, database)
  const handler = ipc.handlers.get(CONVERSATION_CHANNELS.streamWorkspaceMessage)!
  const event = { sender: { id: 7, send: vi.fn(), isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() } }
  const payload = { requestId: crypto.randomUUID(), workspaceId, content: 'Ajude', activePage: 'exercises', activeExercise: { exerciseId } }
  return { handler, event, payload, streamMessage }
}

describe('conversation exercise curricular access', () => {
  beforeEach(() => ipc.handlers.clear())

  it('rejects a locked prefetched exercise before starting the Tutor stream or mutating help', async () => {
    const database = fixture('locked')
    const { handler, event, payload, streamMessage } = register(database)
    await expect(handler(event, payload)).rejects.toThrow('Topic is locked')
    expect(streamMessage).not.toHaveBeenCalled()
    expect(database.sqlite.prepare('SELECT help_count AS helpCount FROM exercise_progress WHERE workspace_id=? AND exercise_id=?').get(workspaceId, exerciseId)).toEqual({ helpCount: 0 })
    database.close()
  })

  it('allows an authoritatively unlocked exercise', async () => {
    const database = fixture('available')
    const { handler, event, payload, streamMessage } = register(database)
    await expect(handler(event, payload)).resolves.toBeUndefined()
    expect(streamMessage).toHaveBeenCalledOnce()
    database.close()
  })

  it('rejects an exercise belonging to another workspace', async () => {
    const database = fixture('available')
    const { handler, event, payload, streamMessage } = register(database)
    await expect(handler(event, { ...payload, workspaceId: otherWorkspaceId })).rejects.toThrow('Exercise not found')
    expect(streamMessage).not.toHaveBeenCalled()
    database.close()
  })
})
