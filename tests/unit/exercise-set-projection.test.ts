import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { openCoachDatabase } from '../../src/main/database/connection'
import { SqliteExerciseRepository } from '../../src/main/repositories/sqlite-exercise-repository'

const migrationsFolder = resolve('drizzle/migrations')

describe('exercise set batch projection', () => {
  it('returns every canonical roadmap topic in order with explicit state using bounded queries', () => {
    const database = openCoachDatabase({ databasePath: ':memory:', migrationsFolder })
    const workspaceId = crypto.randomUUID(); const roadmapId = crypto.randomUUID(); const moduleId = crypto.randomUUID(); const topics = Array.from({ length: 120 }, (_, index) => `Topic ${index}`); const ids = topics.map((topic) => `${moduleId}:${topic}`)
    database.sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES (?,'W','O','active',1,1)").run(workspaceId)
    database.sqlite.prepare("INSERT INTO roadmaps (id,workspace_id,title,status,generation_kind,version,provider_id,model_id,created_at,updated_at) VALUES (?,?,'R','accepted','ai_generated',1,NULL,NULL,1,1)").run(roadmapId, workspaceId)
    database.sqlite.prepare("INSERT INTO roadmap_modules (id,roadmap_id,title,objective,estimated_minutes,position,status,topics_json,outcomes_json,practice,completion_criteria_json,resources_json) VALUES (?,?,'M','O',60,1,'active',?,'[]','P','[]','[]')").run(moduleId, roadmapId, JSON.stringify(topics))
    const result = new SqliteExerciseRepository(database).projectSets(workspaceId, roadmapId)
    expect(result.map((item) => item.topicId)).toEqual(ids)
    expect(new Set(result.map((item) => item.status))).toEqual(new Set(['preparing']))
    expect(() => new SqliteExerciseRepository(database).projectSets(crypto.randomUUID(), roadmapId)).toThrow('Accepted roadmap not found')
    database.close()
  })
})
