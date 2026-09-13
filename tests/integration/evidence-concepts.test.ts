import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openCoachDatabase } from '../../src/main/database/connection'
import { SqliteLearningEvidenceService } from '../../src/application/learning-evidence/learning-evidence-service'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('evidence, concepts, and variants persistence', () => {
  it('records four errors plus one success, replays idempotently, and excludes private assessment data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'coach-evidence-')); directories.push(directory)
    const database = openCoachDatabase({ databasePath: join(directory, 'coach.sqlite'), migrationsFolder: resolve('drizzle/migrations') })
    const workspaceId = crypto.randomUUID()
    database.sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES (?,'C','Ponteiros','active',1,1)").run(workspaceId)
    const service = new SqliteLearningEvidenceService(database)
    for (let index = 0; index < 5; index++) service.record({ workspaceId, environment: index % 2 ? 'exercise' : 'checkpoint', sourceRef: `source-${index}`, sourceRevision: 'revision-1', idempotencyKey: `attempt-${index}`, occurredAt: index + 1, outcome: index === 4 ? 'correct' : 'incorrect', correct: index === 4, independent: true, topicId: 'module:Ponteiros', conceptLabel: 'Ponteiros', conceptDomain: 'C', mappingProvenance: 'explicit', mappingConfidence: 1, difficulty: 'standard', prerequisiteConceptIds: [], reasoningQuality: index === 4 ? 'coherent' : 'misconception', events: [{ type: index === 4 ? 'answer_correct' : 'answer_incorrect', strength: index === 4 ? 'strong' : 'moderate', ordinal: 0, metadata: {} }] })
    const replayPayload = { workspaceId, environment: 'checkpoint' as const, sourceRef: 'source-0', sourceRevision: 'revision-1', idempotencyKey: 'attempt-0', occurredAt: 1, outcome: 'incorrect' as const, correct: false, independent: true, topicId: 'module:Ponteiros', conceptLabel: 'Ponteiros', conceptDomain: 'C', mappingProvenance: 'explicit' as const, mappingConfidence: 1, difficulty: 'standard' as const, prerequisiteConceptIds: [], reasoningQuality: 'misconception' as const, events: [{ type: 'answer_incorrect' as const, strength: 'moderate' as const, ordinal: 0, metadata: {} }] }
    const replay = service.record({ ...replayPayload, occurredAt: 999, events: [{ metadata: {}, ordinal: 0, strength: 'moderate', type: 'answer_incorrect' }] })
    expect(replay.inserted).toBe(false)
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM learning_attempts').get()).toEqual({ count: 5 })
    expect(database.sqlite.prepare('SELECT error_count AS errors,successful_retrievals AS successes FROM concept_memories').get()).toEqual({ errors: 4, successes: 1 })
    const variant = database.sqlite.prepare('SELECT prerequisite_concept_ids_json AS prerequisites,public_metadata_json AS metadata FROM assessment_variants LIMIT 1').get() as { prerequisites: string; metadata: string }
    expect(variant).toEqual({ prerequisites: '[]', metadata: '{}' })
    expect(JSON.stringify(variant)).not.toMatch(/solution|hidden|private/i)
    const memoryBeforeCollision = database.sqlite.prepare('SELECT * FROM concept_memories').get()
    expect(() => service.record({ ...replayPayload, outcome: 'correct', correct: true, reasoningQuality: 'coherent', events: [{ type: 'answer_correct', strength: 'strong', ordinal: 0, metadata: {} }] })).toThrow(/idempotency collision/i)
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM learning_attempts').get()).toEqual({ count: 5 })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM learning_evidence').get()).toEqual({ count: 5 })
    expect(database.sqlite.prepare('SELECT * FROM concept_memories').get()).toEqual(memoryBeforeCollision)
    database.close()
  })

  it('keeps a stable concept while multiple topic revisions map to it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'coach-concepts-')); directories.push(directory)
    const database = openCoachDatabase({ databasePath: join(directory, 'coach.sqlite'), migrationsFolder: resolve('drizzle/migrations') })
    const workspaceId = crypto.randomUUID(); database.sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES (?,'Python','Laços','active',1,1)").run(workspaceId)
    const service = new SqliteLearningEvidenceService(database)
    for (const [index, topicId] of ['old-module:Laços', 'new-module:Laços'].entries()) service.record({ workspaceId, environment: 'checkpoint', sourceRef: `check-${index}`, sourceRevision: `revision-${index}`, idempotencyKey: `key-${index}`, occurredAt: index + 1, outcome: 'correct', correct: true, independent: true, topicId, conceptLabel: 'Laços', conceptDomain: 'Python', mappingProvenance: 'explicit', mappingConfidence: 1, difficulty: 'standard', prerequisiteConceptIds: [], reasoningQuality: 'coherent', events: [{ type: 'answer_correct', strength: 'strong', ordinal: 0, metadata: {} }] })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM concepts').get()).toEqual({ count: 1 })
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM topic_concepts WHERE mapping_status='mapped'").get()).toEqual({ count: 2 })
    database.close()
  })

  it('isolates variant identity and rejects cross-workspace ownership', () => {
    const directory = mkdtempSync(join(tmpdir(), 'coach-ownership-')); directories.push(directory)
    const database = openCoachDatabase({ databasePath: join(directory, 'coach.sqlite'), migrationsFolder: resolve('drizzle/migrations') })
    const first = crypto.randomUUID(); const second = crypto.randomUUID()
    for (const id of [first, second]) database.sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES (?,'W','O','active',1,1)").run(id)
    const service = new SqliteLearningEvidenceService(database)
    const record = (workspaceId: string, key: string) => service.record({ workspaceId, environment: 'checkpoint', sourceRef: 'same-source', sourceRevision: 'same-revision', idempotencyKey: key, occurredAt: 1, outcome: 'correct', correct: true, independent: true, conceptLabel: 'Loops', conceptDomain: 'Programming', mappingProvenance: 'explicit', mappingConfidence: 1, difficulty: 'standard', prerequisiteConceptIds: [], reasoningQuality: 'coherent', events: [{ type: 'answer_correct', strength: 'strong', ordinal: 0, metadata: {} }] })
    record(first, 'first-key'); record(second, 'second-key')
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM assessment_variants').get()).toEqual({ count: 2 })
    const foreignConcept = (database.sqlite.prepare('SELECT id FROM concepts WHERE workspace_id=?').get(first) as { id: string }).id
    expect(() => service.record({ workspaceId: second, environment: 'practice', sourceRef: 'p', sourceRevision: 'r', idempotencyKey: 'foreign-key', occurredAt: 2, outcome: 'correct', correct: true, independent: true, conceptId: foreignConcept, prerequisiteConceptIds: [], reasoningQuality: 'not_assessed', events: [{ type: 'answer_correct', strength: 'strong', ordinal: 0, metadata: {} }] })).toThrow(/does not belong/)
    database.close()
  })

  it('keeps heuristic topic labels unmapped until an explicit mapping exists', () => {
    const directory = mkdtempSync(join(tmpdir(), 'coach-unmapped-')); directories.push(directory)
    const database = openCoachDatabase({ databasePath: join(directory, 'coach.sqlite'), migrationsFolder: resolve('drizzle/migrations') })
    const workspaceId = crypto.randomUUID(); database.sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES (?,'W','O','active',1,1)").run(workspaceId)
    new SqliteLearningEvidenceService(database).record({ workspaceId, environment: 'exercise', sourceRef: 'e', sourceRevision: 'r', idempotencyKey: 'unmapped-key', occurredAt: 1, outcome: 'incorrect', correct: false, independent: true, topicId: 'module:Loops', conceptLabel: 'Loops', conceptDomain: 'Programming', mappingProvenance: 'legacy_backfill', mappingConfidence: 0, difficulty: 'standard', prerequisiteConceptIds: [], reasoningQuality: 'not_assessed', events: [{ type: 'answer_incorrect', strength: 'moderate', ordinal: 0, metadata: {} }] })
    expect(database.sqlite.prepare('SELECT concept_id AS conceptId FROM learning_attempts').get()).toEqual({ conceptId: null })
    expect(database.sqlite.prepare('SELECT mapping_status AS status,confidence FROM topic_concepts').get()).toEqual({ status: 'unknown', confidence: 0 })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM concepts').get()).toEqual({ count: 0 })
    database.close()
  })
})
