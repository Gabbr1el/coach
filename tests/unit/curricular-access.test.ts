import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { openCoachDatabase } from '../../src/main/database/connection'
import { assertAcceptedTopicAccess } from '../../src/main/curricular-access'

const migrationsFolder = resolve('drizzle/migrations')

describe('authoritative curricular access', () => {
  it('rejects locked accepted topics and permits the same topic after authoritative unlock', () => {
    const database = openCoachDatabase({ databasePath: ':memory:', migrationsFolder })
    const workspaceId = crypto.randomUUID(); const roadmapId = crypto.randomUUID(); const moduleId = crypto.randomUUID(); const topicId = `${moduleId}:Future`
    database.sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES (?,'W','O','active',1,1)").run(workspaceId)
    database.sqlite.prepare("INSERT INTO roadmaps (id,workspace_id,title,status,generation_kind,version,provider_id,model_id,created_at,updated_at) VALUES (?,?,'R','accepted','ai_generated',1,NULL,NULL,1,1)").run(roadmapId, workspaceId)
    database.sqlite.prepare("INSERT INTO roadmap_modules (id,roadmap_id,title,objective,estimated_minutes,position,status,topics_json,outcomes_json,practice,completion_criteria_json,resources_json) VALUES (?,?,'M','O',60,1,'locked','[\"Future\"]','[]','P','[]','[]')").run(moduleId, roadmapId)
    expect(() => assertAcceptedTopicAccess(database, { workspaceId, roadmapId, moduleId, topicId })).toThrow('Topic is locked')
    expect(database.sqlite.prepare('SELECT 1 FROM study_progress WHERE workspace_id=?').get(workspaceId)).toBeUndefined()
    database.sqlite.prepare("UPDATE roadmap_modules SET status='active' WHERE id=?").run(moduleId)
    expect(() => assertAcceptedTopicAccess(database, { workspaceId, roadmapId, moduleId, topicId })).not.toThrow()
    database.close()
  })
  it('rejects a programmatic later-topic bypass without mutating progress and permits it after progression', () => {
    const database = openCoachDatabase({ databasePath: ':memory:', migrationsFolder })
    const workspaceId = crypto.randomUUID(); const roadmapId = crypto.randomUUID(); const moduleId = crypto.randomUUID(); const first = `${moduleId}:First`; const second = `${moduleId}:Second`
    database.sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES (?,'W','O','active',1,1)").run(workspaceId)
    database.sqlite.prepare("INSERT INTO roadmaps (id,workspace_id,title,status,generation_kind,version,provider_id,model_id,created_at,updated_at) VALUES (?,?,'R','accepted','ai_generated',1,NULL,NULL,1,1)").run(roadmapId, workspaceId)
    database.sqlite.prepare("INSERT INTO roadmap_modules (id,roadmap_id,title,objective,estimated_minutes,position,status,topics_json,outcomes_json,practice,completion_criteria_json,resources_json) VALUES (?,?,'M','O',60,1,'active','[\"First\",\"Second\"]','[]','P','[]','[]')").run(moduleId, roadmapId)
    expect(() => assertAcceptedTopicAccess(database, { workspaceId, roadmapId, moduleId, topicId: second })).toThrow('Topic is locked')
    expect(database.sqlite.prepare('SELECT 1 FROM study_progress WHERE workspace_id=?').get(workspaceId)).toBeUndefined()
    database.sqlite.prepare("INSERT INTO study_progress (workspace_id,roadmap_id,current_module_id,current_topic_id,current_lesson_id,current_checkpoint_id,topic_statuses_json,lesson_positions_json,checkpoint_states_json,updated_at) VALUES (?,?,?,?,NULL,NULL,?,'{}','{}',1)").run(workspaceId, roadmapId, moduleId, second, JSON.stringify({ [first]: 'COMPLETED', [second]: 'IN_PROGRESS' }))
    expect(() => assertAcceptedTopicAccess(database, { workspaceId, roadmapId, moduleId, topicId: second })).not.toThrow()
    database.close()
  })
})
