import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openCoachDatabase } from '../../src/main/database/connection'
import { SqliteLearningEvidenceService } from '../../src/application/learning-evidence/learning-evidence-service'
import { ReviewService } from '../../src/application/review/review-service'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'coach-review-')); directories.push(directory)
  const path = join(directory, 'coach.sqlite'); const database = openCoachDatabase({ databasePath: path, migrationsFolder: resolve('drizzle/migrations') })
  const workspaceId = crypto.randomUUID(); const roadmapId = crypto.randomUUID(); const moduleId = crypto.randomUUID(); const topicId = `${moduleId}:Laços`; const now = Date.parse('2026-09-11T12:00:00Z')
  database.sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES (?,'Python','Laços','active',?,?)").run(workspaceId, now, now)
  database.sqlite.prepare("INSERT INTO roadmaps (id,workspace_id,title,status,generation_kind,version,content_revision,content_hash,provider_id,model_id,created_at,updated_at) VALUES (?,?,'Python','accepted','ai_generated',1,1,'test','test','test',?,?)").run(roadmapId, workspaceId, now, now)
  database.sqlite.prepare("INSERT INTO roadmap_modules (id,roadmap_id,title,objective,estimated_minutes,position,status,topics_json,outcomes_json,practice,completion_criteria_json,resources_json) VALUES (?,?,'Laços','Praticar',60,1,'active','[\"Laços\"]','[]','','[]','[]')").run(moduleId, roadmapId)
  const evidence = new SqliteLearningEvidenceService(database)
  const seed = (concept: string, conceptTopicId: string, index: number, correct: boolean) => evidence.record({ workspaceId, environment: 'checkpoint', sourceRef: `checkpoint-${concept}-${index}`, sourceRevision: '1', idempotencyKey: `seed-${concept}-${index}`, occurredAt: now - (4 - index) * 86_400_000, outcome: correct ? 'correct' : 'incorrect', correct, independent: true, topicId: conceptTopicId, conceptLabel: concept, conceptDomain: 'Python', mappingProvenance: 'explicit', mappingConfidence: 1, difficulty: 'standard', prerequisiteConceptIds: [], reasoningQuality: correct ? 'coherent' : 'misconception', events: [{ type: correct ? 'answer_correct' : 'answer_incorrect', strength: correct ? 'strong' : 'moderate', ordinal: 0, metadata: {} }] })
  for (const [concept, conceptTopicId] of [['Laços', topicId], ['Condições', `${moduleId}:Condições`]] as const) { seed(concept, conceptTopicId, 0, false); seed(concept, conceptTopicId, 1, false); seed(concept, conceptTopicId, 2, true) }
  const intents = database.sqlite.prepare('SELECT id,concept_id AS conceptId FROM assessment_intents ORDER BY id').all() as Array<{ id: string; conceptId: string }>
  for (const [intentIndex, intent] of intents.entries()) for (let index = 0; index < 3; index++) database.sqlite.prepare("INSERT INTO assessment_variants (id,workspace_id,intent_id,environment,source_ref,source_revision,difficulty,prerequisite_concept_ids_json,public_metadata_json,public_payload_json,evaluator_json,created_at,updated_at) VALUES (?,?,?,'checkpoint',?,?,'standard','[]','{}',?,?,?,?)").run(`review-variant-${intentIndex}-${index}`, workspaceId, intent.id, `review-source-${intentIndex}-${index}`, String(index), JSON.stringify({ type: 'multiple_choice', prompt: `Qual opção representa o conceito? ${intentIndex}-${index}`, options: [{ id: 'a', label: 'Resposta' }, { id: 'b', label: 'Distrator' }] }), JSON.stringify({ type: 'exact_text', expected: 'a' }), now, now)
  return { database, path, workspaceId, topicId, now, evidence }
}

describe('ReviewSession authority and persistence', () => {
  it('persists one preparation snapshot across restart and promotes the same session after variants arrive', () => {
    const fixtureData = fixture(); fixtureData.database.sqlite.prepare("UPDATE assessment_variants SET public_payload_json='{}',evaluator_json='{}'").run()
    const first = new ReviewService(fixtureData.database, fixtureData.evidence, () => fixtureData.now).start({ workspaceId: fixtureData.workspaceId, targetSize: 4 })
    expect(first).toMatchObject({ status: 'preparation', items: [] }); fixtureData.database.close()
    const database = openCoachDatabase({ databasePath: fixtureData.path, migrationsFolder: resolve('drizzle/migrations') }); const service = new ReviewService(database, new SqliteLearningEvidenceService(database), () => fixtureData.now)
    expect(service.getActive(fixtureData.workspaceId)?.id).toBe(first.id); expect(service.start({ workspaceId: fixtureData.workspaceId, targetSize: 4 }).id).toBe(first.id)
    expect((database.sqlite.prepare("SELECT COUNT(*) AS count FROM review_sessions WHERE workspace_id=? AND status='preparation'").get(fixtureData.workspaceId) as { count: number }).count).toBe(1)
    database.sqlite.prepare('UPDATE assessment_variants SET public_payload_json=?,evaluator_json=?').run(JSON.stringify({ type: 'multiple_choice', prompt: 'Qual opção?', options: [{ id: 'a', label: 'Resposta' }, { id: 'b', label: 'Distrator' }] }), JSON.stringify({ type: 'exact_text', expected: 'a' }))
    const promoted = service.start({ workspaceId: fixtureData.workspaceId, targetSize: 4 }); expect(promoted.id).toBe(first.id); expect(promoted.status).toBe('active'); expect(promoted.items).toHaveLength(4)
    expect((database.sqlite.prepare('SELECT COUNT(*) AS count FROM review_sessions WHERE workspace_id=?').get(fixtureData.workspaceId) as { count: number }).count).toBe(1); database.close()
  })

  it('uses current outcome for recent failure and includes bounded stable maintenance after due items', () => {
    const { database, workspaceId, now, evidence } = fixture(); const concepts = database.sqlite.prepare('SELECT id FROM concepts ORDER BY canonical_name').all() as Array<{ id: string }>
    database.sqlite.prepare("UPDATE concept_memories SET retention='durable',performance='secure',next_review_at=?,last_evidence_at=? WHERE concept_id=?").run(now + 30 * 86_400_000, now - 30 * 86_400_000, concepts[0]!.id)
    database.sqlite.prepare("UPDATE learning_attempts SET outcome='correct',correct=1,occurred_at=? WHERE concept_id=? AND occurred_at=(SELECT MAX(occurred_at) FROM learning_attempts WHERE concept_id=?)").run(now - 30 * 86_400_000, concepts[0]!.id, concepts[0]!.id)
    database.sqlite.prepare("UPDATE concept_memories SET next_review_at=?,retention='durable' WHERE concept_id=?").run(now - 1, concepts[1]!.id)
    const session = new ReviewService(database, evidence, () => now).start({ workspaceId, targetSize: 4 })
    expect(session.items.filter((item) => item.reason === 'due_review')).toHaveLength(2); expect(session.items.filter((item) => item.reason === 'maintenance')).toHaveLength(2); expect(session.items.some((item) => item.reason === 'recent_failure')).toBe(false); database.close()
  })

  it('excludes a just-reviewed stable concept without a due or weak cause', () => {
    const { database, workspaceId, now, evidence } = fixture(); const service = new ReviewService(database, evidence, () => now)
    const first = service.start({ workspaceId, targetSize: 4 }); for (const item of first.items) service.submit({ workspaceId, sessionId: first.id, itemId: item.id, answer: 'a', idempotencyKey: `stable-${item.id}` })
    database.sqlite.prepare("UPDATE concept_memories SET retention='durable',performance='secure',next_review_at=?").run(now + 30 * 86_400_000)
    const next = service.start({ workspaceId, targetSize: 4 }); expect(next.status).toBe('preparation'); expect(next.items).toHaveLength(0); database.close()
  })
  it('creates a finite concept-authoritative session without creating ExerciseSet or changing topics_json', () => {
    const { database, workspaceId, now, evidence } = fixture(); const topicsBefore = database.sqlite.prepare('SELECT topics_json FROM roadmap_modules').get()
    const session = new ReviewService(database, evidence, () => now).start({ workspaceId, targetSize: 12 })
    expect(session.status).toBe('active'); expect(session.items.length).toBe(4); expect(session.targetSize).toBe(12)
    expect(session.items.every((item) => item.conceptId && item.assessmentIntentId && item.assessmentVariantId)).toBe(true)
    expect(new Set(session.items.map((item) => item.conceptId)).size).toBe(2)
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM exercise_sets').get()).toEqual({ count: 0 })
    expect(database.sqlite.prepare('SELECT topics_json FROM roadmap_modules').get()).toEqual(topicsBefore)
    database.close()
  })

  it('records one idempotent LearningAttempt, memory snapshots, and resumes after restart', () => {
    const fixtureData = fixture(); let { database } = fixtureData; const service = new ReviewService(database, fixtureData.evidence, () => fixtureData.now)
    const started = service.start({ workspaceId: fixtureData.workspaceId, targetSize: 4 }); const item = started.items[0]!
    const result = service.submit({ workspaceId: fixtureData.workspaceId, sessionId: started.id, itemId: item.id, answer: 'a', idempotencyKey: 'review-submit-1' })
    const replay = service.submit({ workspaceId: fixtureData.workspaceId, sessionId: started.id, itemId: item.id, answer: 'a', idempotencyKey: 'review-submit-1' })
    expect(result.items[0]).toMatchObject({ status: 'answered', attempts: 1, result: 'correct' }); expect(result.items[0]?.memoryBefore).not.toBeNull(); expect(result.items[0]?.memoryAfter?.intervalDays).toBeGreaterThanOrEqual(result.items[0]!.memoryBefore!.intervalDays)
    expect(replay.items[0]?.attempts).toBe(1); expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM learning_attempts WHERE environment='review'").get()).toEqual({ count: 1 })
    database.close(); database = openCoachDatabase({ databasePath: fixtureData.path, migrationsFolder: resolve('drizzle/migrations') })
    const resumed = new ReviewService(database, new SqliteLearningEvidenceService(database), () => fixtureData.now).getActive(fixtureData.workspaceId)
    expect(resumed?.id).toBe(started.id); expect(resumed?.items[0]?.status).toBe('answered'); database.close()
  })

  it('does not immediately repeat the last variant in the next session', () => {
    const { database, workspaceId, now, evidence } = fixture(); const service = new ReviewService(database, evidence, () => now)
    const first = service.start({ workspaceId, targetSize: 4 }); for (const item of first.items) service.submit({ workspaceId, sessionId: first.id, itemId: item.id, answer: 'a', idempotencyKey: `submit-${item.id}` })
    const second = service.start({ workspaceId, targetSize: 4 }); expect(second.items.map((item) => item.assessmentVariantId)).not.toContain(first.items.at(-1)?.assessmentVariantId); database.close()
  })

  it('rejects a divergent idempotent replay and bounds misconception follow-up to one extra item', () => {
    const { database, workspaceId, now, evidence } = fixture(); const service = new ReviewService(database, evidence, () => now)
    const started = service.start({ workspaceId, targetSize: 12 }); const first = started.items[0]!
    const afterFailure = service.submit({ workspaceId, sessionId: started.id, itemId: first.id, answer: 'b', idempotencyKey: 'divergent-review-key' })
    expect(afterFailure.items.filter((item) => item.conceptId === first.conceptId)).toHaveLength(3)
    expect(afterFailure.items.filter((item) => item.conceptId === first.conceptId && item.reason === 'misconception_followup')).toHaveLength(1)
    expect(() => service.submit({ workspaceId, sessionId: started.id, itemId: first.id, answer: 'a', idempotencyKey: 'divergent-review-key' })).toThrow('already answered differently')
    const followup = afterFailure.items.find((item) => item.reason === 'misconception_followup')!
    const afterSecondFailure = service.submit({ workspaceId, sessionId: started.id, itemId: followup.id, answer: 'b', idempotencyKey: 'second-review-failure' })
    expect(afterSecondFailure.items.filter((item) => item.conceptId === first.conceptId)).toHaveLength(3)
    expect((database.sqlite.prepare("SELECT COUNT(*) AS count FROM learning_attempts WHERE environment='review'").get() as { count: number }).count).toBe(2)
    database.close()
  })
})
