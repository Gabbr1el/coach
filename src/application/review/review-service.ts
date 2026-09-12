import { createHash } from 'node:crypto'
import type { CoachDatabase } from '../../main/database/connection'
import type { LearningEvidenceRecorder, ConceptMemory } from '../../shared/contracts/learning-evidence-contract'
import { conceptMemorySchema } from '../../shared/contracts/learning-evidence-contract'
import { reviewPayloadSchema, reviewSessionSchema, type ReviewSession } from '../../shared/contracts/review-contract'

const DAY = 86_400_000
const RECENT_FAILURE_WINDOW = 7 * DAY
const JUST_REVIEWED_WINDOW = DAY
type Candidate = { conceptId: string; conceptName: string; intentId: string; variantId: string; sourceRef: string; sourceTopicId: string | null; prerequisitesJson: string; payloadJson: string; performance: string; retention: string; recency: string; nextReviewAt: number | null; errorCount: number; successfulRetrievals: number; lastEvidenceAt: number | null; lastOutcome: 'correct' | 'incorrect' | 'completed' | 'observed' | null; lastReviewedAt: number | null; lastVariantId: string | null; deadlineAt: number | null }
type ItemRow = { id: string; position: number; conceptId: string; conceptName: string; assessmentIntentId: string; assessmentVariantId: string; sourceTopicId: string | null; sourceExerciseId: string | null; selectionReason: ReviewSession['items'][number]['reason']; status: 'pending' | 'answered'; attempts: number; helpCount: number; result: 'correct' | 'incorrect' | null; payloadJson: string; memoryBeforeJson: string | null; memoryAfterJson: string | null; firstSeenAt: number; answeredAt: number | null }

const memory = (json: string | null): ConceptMemory | null => json ? conceptMemorySchema.parse(JSON.parse(json)) : null
const canonicalAnswer = (value: string) => value.replace(/\r\n/g, '\n').trim()
const answerHash = (value: string) => createHash('sha256').update(canonicalAnswer(value)).digest('hex')

export class ReviewService {
  constructor(private readonly database: CoachDatabase, private readonly evidence: LearningEvidenceRecorder, private readonly now = Date.now, private readonly createId = () => crypto.randomUUID()) {}

  getActive(workspaceId: string): ReviewSession | null {
    const row = this.database.sqlite.prepare("SELECT id FROM review_sessions WHERE workspace_id=? AND status IN ('active','preparation') ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,updated_at DESC LIMIT 1").get(workspaceId) as { id: string } | undefined
    return row ? this.read(row.id, workspaceId) : null
  }

  start(input: { workspaceId: string; targetSize?: number }): ReviewSession {
    const existing = this.getActive(input.workspaceId)
    if (existing?.status === 'active') return existing
    const targetSize = Math.max(4, Math.min(12, input.targetSize ?? 8))
    const now = this.now()
    this.hydratePublicObservationVariants(input.workspaceId, now)
    const candidates = this.candidates(input.workspaceId, now)
    const selected: Array<Candidate & { reason: ReviewSession['items'][number]['reason'] }> = []
    const conceptCounts = new Map<string, number>()
    const maintenanceLimit = Math.min(2, Math.max(1, Math.floor(targetSize / 2)))
    let maintenanceCount = 0
    for (const candidate of candidates) {
      if (selected.length >= targetSize) break
      if (candidate.variantId === candidate.lastVariantId) continue
      const count = conceptCounts.get(candidate.conceptId) ?? 0
      if (count >= 2) continue
      const prerequisites = JSON.parse(candidate.prerequisitesJson) as string[]
      if (!this.prerequisitesAllowed(input.workspaceId, prerequisites)) continue
      const cause = this.hasCause(candidate, now)
      if (!cause && candidate.lastReviewedAt !== null && now - candidate.lastReviewedAt < JUST_REVIEWED_WINDOW) continue
      const reason = this.reason(candidate, now)
      if (reason === 'maintenance' && maintenanceCount >= maintenanceLimit) continue
      selected.push({ ...candidate, reason })
      if (reason === 'maintenance') maintenanceCount++
      conceptCounts.set(candidate.conceptId, count + 1)
    }
    if (selected.length < 4) selected.splice(0)
    const sessionId = existing?.id ?? this.createId()
    const status = selected.length >= 4 ? 'active' : 'preparation'
    this.database.sqlite.transaction(() => {
      if (existing) {
        this.database.sqlite.prepare('DELETE FROM review_items WHERE session_id=?').run(sessionId)
        this.database.sqlite.prepare('UPDATE review_sessions SET target_size=?,status=?,completed_at=NULL,updated_at=? WHERE id=?').run(targetSize, status, now, sessionId)
      } else this.database.sqlite.prepare('INSERT INTO review_sessions (id,workspace_id,target_size,status,started_at,completed_at,updated_at) VALUES (?,?,?,?,?,NULL,?)').run(sessionId, input.workspaceId, targetSize, status, now, now)
      const insert = this.database.sqlite.prepare('INSERT INTO review_items (id,session_id,position,concept_id,assessment_intent_id,assessment_variant_id,source_topic_id,source_exercise_id,selection_reason,status,attempts,help_count,result,answer_json,memory_before_json,memory_after_json,learning_attempt_id,first_seen_at,answered_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,\'pending\',0,0,NULL,NULL,NULL,NULL,NULL,?,NULL,?,?)')
      selected.forEach((item, index) => insert.run(this.createId(), sessionId, index + 1, item.conceptId, item.intentId, item.variantId, item.sourceTopicId, item.sourceRef.startsWith('exercise:') ? item.sourceRef.slice(9) : null, item.reason, now, now, now))
    })()
    return this.read(sessionId, input.workspaceId)
  }

  submit(input: { workspaceId: string; sessionId: string; itemId: string; answer: string; idempotencyKey: string }): ReviewSession {
    return this.database.sqlite.transaction(() => {
      const replay = this.database.sqlite.prepare("SELECT i.answer_json AS answerJson FROM review_items i JOIN review_sessions s ON s.id=i.session_id WHERE i.id=? AND i.session_id=? AND s.workspace_id=? AND i.status='answered'").get(input.itemId, input.sessionId, input.workspaceId) as { answerJson: string } | undefined
      if (replay) {
        if ((JSON.parse(replay.answerJson) as { hash: string }).hash !== answerHash(input.answer)) throw new Error('Review item was already answered differently')
        return this.read(input.sessionId, input.workspaceId)
      }
      const row = this.requirePending(input)
      const evaluator = JSON.parse(row.evaluatorJson) as { type?: string; expected?: string }
      if (evaluator.type !== 'exact_text' || typeof evaluator.expected !== 'string') throw new Error('Review variant has no authoritative evaluator')
      const correct = canonicalAnswer(input.answer) === canonicalAnswer(evaluator.expected)
      const before = this.readMemory(input.workspaceId, row.conceptId)
      const recorded = this.evidence.record({ workspaceId: input.workspaceId, environment: 'review', sourceRef: input.itemId, sourceRevision: row.variantId, firstSeenAt: row.firstSeenAt, idempotencyKey: input.idempotencyKey, occurredAt: this.now(), outcome: correct ? 'correct' : 'incorrect', correct, independent: row.helpCount === 0, conceptId: row.conceptId, assessmentIntentId: row.intentId, assessmentVariantId: row.variantId, difficulty: row.difficulty as 'introductory' | 'standard' | 'challenge', prerequisiteConceptIds: JSON.parse(row.prerequisitesJson) as string[], reasoningQuality: 'not_assessed', events: [{ type: correct ? 'answer_correct' : 'answer_incorrect', strength: correct && row.helpCount === 0 ? 'strong' : correct ? 'weak' : 'moderate', ordinal: 0, metadata: { reviewItemId: input.itemId } }] })
      const after = recorded.memory
      this.database.sqlite.prepare("UPDATE review_items SET status='answered',attempts=attempts+1,result=?,answer_json=?,memory_before_json=?,memory_after_json=?,learning_attempt_id=?,answered_at=?,updated_at=? WHERE id=? AND status='pending'").run(correct ? 'correct' : 'incorrect', JSON.stringify({ hash: answerHash(input.answer) }), before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, recorded.attemptId, this.now(), this.now(), input.itemId)
      if (!correct) this.addBoundedFollowup(input.sessionId, input.workspaceId, row.conceptId, row.intentId, row.variantId)
      const remaining = (this.database.sqlite.prepare("SELECT COUNT(*) AS count FROM review_items WHERE session_id=? AND status='pending'").get(input.sessionId) as { count: number }).count
      if (!remaining) this.database.sqlite.prepare("UPDATE review_sessions SET status='completed',completed_at=?,updated_at=? WHERE id=?").run(this.now(), this.now(), input.sessionId)
      else this.database.sqlite.prepare('UPDATE review_sessions SET updated_at=? WHERE id=?').run(this.now(), input.sessionId)
      return this.read(input.sessionId, input.workspaceId)
    })()
  }

  requestHelp(input: { workspaceId: string; sessionId: string; itemId: string; requestId: string }): ReviewSession {
    this.database.sqlite.transaction(() => {
      this.requirePending(input)
      const inserted = this.database.sqlite.prepare('INSERT OR IGNORE INTO review_help_events (request_id,review_item_id,created_at) VALUES (?,?,?)').run(input.requestId, input.itemId, this.now())
      if (inserted.changes) this.database.sqlite.prepare('UPDATE review_items SET help_count=help_count+1,updated_at=? WHERE id=?').run(this.now(), input.itemId)
    })()
    return this.read(input.sessionId, input.workspaceId)
  }

  private requirePending(input: { workspaceId: string; sessionId: string; itemId: string }) {
    const row = this.database.sqlite.prepare("SELECT i.concept_id AS conceptId,i.assessment_intent_id AS intentId,i.assessment_variant_id AS variantId,i.help_count AS helpCount,i.first_seen_at AS firstSeenAt,v.difficulty,v.prerequisite_concept_ids_json AS prerequisitesJson,v.evaluator_json AS evaluatorJson FROM review_items i JOIN review_sessions s ON s.id=i.session_id JOIN assessment_variants v ON v.id=i.assessment_variant_id WHERE i.id=? AND i.session_id=? AND s.workspace_id=? AND s.status='active'").get(input.itemId, input.sessionId, input.workspaceId) as { conceptId: string; intentId: string; variantId: string; helpCount: number; firstSeenAt: number; difficulty: string; prerequisitesJson: string; evaluatorJson: string } | undefined
    if (!row) throw new Error('Active review item not found')
    return row
  }

  private read(sessionId: string, workspaceId: string): ReviewSession {
    const session = this.database.sqlite.prepare('SELECT id,workspace_id AS workspaceId,target_size AS targetSize,status,started_at AS startedAt,completed_at AS completedAt,updated_at AS updatedAt FROM review_sessions WHERE id=? AND workspace_id=?').get(sessionId, workspaceId) as Omit<ReviewSession, 'items' | 'message'> | undefined
    if (!session) throw new Error('Review session not found')
    const rows = this.database.sqlite.prepare('SELECT i.id,i.position,i.concept_id AS conceptId,c.canonical_name AS conceptName,i.assessment_intent_id AS assessmentIntentId,i.assessment_variant_id AS assessmentVariantId,i.source_topic_id AS sourceTopicId,i.source_exercise_id AS sourceExerciseId,i.selection_reason AS selectionReason,i.status,i.attempts,i.help_count AS helpCount,i.result,v.public_payload_json AS payloadJson,i.memory_before_json AS memoryBeforeJson,i.memory_after_json AS memoryAfterJson,i.first_seen_at AS firstSeenAt,i.answered_at AS answeredAt FROM review_items i JOIN concepts c ON c.id=i.concept_id JOIN assessment_variants v ON v.id=i.assessment_variant_id WHERE i.session_id=? ORDER BY i.position').all(sessionId) as ItemRow[]
    const items = rows.map(({ selectionReason, payloadJson, memoryBeforeJson, memoryAfterJson, ...item }) => ({ ...item, reason: selectionReason, payload: reviewPayloadSchema.parse(JSON.parse(payloadJson)), memoryBefore: memory(memoryBeforeJson), memoryAfter: memory(memoryAfterJson) }))
    return reviewSessionSchema.parse({ ...session, items, message: session.status === 'preparation' ? 'Ainda não há variantes avaliáveis suficientes. Continue estudando; a Revisão será preparada sem gerar conteúdo pesado agora.' : null })
  }

  private readMemory(workspaceId: string, conceptId: string): ConceptMemory | null {
    const row = this.database.sqlite.prepare('SELECT workspace_id AS workspaceId,concept_id AS conceptId,performance,evidence_quantity AS evidenceQuantity,independence,diversity,recency,retention,confidence,successful_retrievals AS successfulRetrievals,independent_successes AS independentSuccesses,error_count AS errorCount,help_events AS helpEvents,environment_count AS environmentCount,interval_days AS intervalDays,last_evidence_at AS lastEvidenceAt,next_review_at AS nextReviewAt,updated_at AS updatedAt FROM concept_memories WHERE workspace_id=? AND concept_id=?').get(workspaceId, conceptId)
    return row ? conceptMemorySchema.parse(row) : null
  }

  private prerequisitesAllowed(workspaceId: string, ids: string[]): boolean { return ids.every((id) => Boolean(this.database.sqlite.prepare("SELECT 1 FROM concepts c WHERE c.id=? AND c.workspace_id=? AND EXISTS (SELECT 1 FROM topic_concepts tc WHERE tc.concept_id=c.id AND tc.workspace_id=c.workspace_id AND tc.mapping_status='mapped') AND EXISTS (SELECT 1 FROM learning_attempts a WHERE a.concept_id=c.id AND a.workspace_id=c.workspace_id)").get(id, workspaceId))) }
  private hasCause(item: Candidate, now: number): boolean { return item.nextReviewAt !== null && item.nextReviewAt <= now || item.retention === 'fragile' || item.lastOutcome === 'incorrect' && item.lastEvidenceAt !== null && now - item.lastEvidenceAt <= RECENT_FAILURE_WINDOW }
  private addBoundedFollowup(sessionId: string, workspaceId: string, conceptId: string, intentId: string, previousVariantId: string): void {
    const counts = this.database.sqlite.prepare('SELECT (SELECT COUNT(*) FROM review_items WHERE session_id=?) AS total,(SELECT COUNT(*) FROM review_items WHERE session_id=? AND concept_id=?) AS conceptCount,(SELECT target_size FROM review_sessions WHERE id=?) AS target').get(sessionId, sessionId, conceptId, sessionId) as { total: number; conceptCount: number; target: number }
    if (counts.total >= counts.target || counts.conceptCount >= 3) return
    const variant = this.database.sqlite.prepare("SELECT v.id,v.prerequisite_concept_ids_json AS prerequisitesJson,(SELECT tc.topic_id FROM topic_concepts tc WHERE tc.workspace_id=? AND tc.concept_id=? AND tc.mapping_status='mapped' ORDER BY tc.confidence DESC,tc.id LIMIT 1) AS topicId FROM assessment_variants v WHERE v.workspace_id=? AND v.intent_id=? AND v.id<>? AND v.public_payload_json<>'{}' AND v.evaluator_json<>'{}' AND NOT EXISTS (SELECT 1 FROM review_items ri WHERE ri.session_id=? AND ri.assessment_variant_id=v.id) ORDER BY v.id LIMIT 1").get(workspaceId, conceptId, workspaceId, intentId, previousVariantId, sessionId) as { id: string; prerequisitesJson: string; topicId: string | null } | undefined
    if (!variant || !this.prerequisitesAllowed(workspaceId, JSON.parse(variant.prerequisitesJson) as string[])) return
    const position = (this.database.sqlite.prepare('SELECT COALESCE(MAX(position),0)+1 AS position FROM review_items WHERE session_id=?').get(sessionId) as { position: number }).position
    const now = this.now()
    this.database.sqlite.prepare("INSERT INTO review_items (id,session_id,position,concept_id,assessment_intent_id,assessment_variant_id,source_topic_id,source_exercise_id,selection_reason,status,attempts,help_count,result,answer_json,memory_before_json,memory_after_json,learning_attempt_id,first_seen_at,answered_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,NULL,'misconception_followup','pending',0,0,NULL,NULL,NULL,NULL,NULL,?,NULL,?,?)").run(this.createId(), sessionId, position, conceptId, intentId, variant.id, variant.topicId, now, now, now)
  }
  private reason(item: Candidate, now: number): ReviewSession['items'][number]['reason'] { if (item.deadlineAt !== null && item.deadlineAt - now <= 7 * DAY) return 'deadline_priority'; if (item.lastOutcome === 'incorrect' && item.lastEvidenceAt !== null && now - item.lastEvidenceAt <= RECENT_FAILURE_WINDOW) return 'recent_failure'; if (item.retention === 'fragile') return 'retention_decay'; if (item.nextReviewAt !== null && item.nextReviewAt <= now) return 'due_review'; return 'maintenance' }

  private candidates(workspaceId: string, now: number): Candidate[] {
    return this.database.sqlite.prepare(`SELECT c.id AS conceptId,c.canonical_name AS conceptName,i.id AS intentId,v.id AS variantId,v.source_ref AS sourceRef,(SELECT tc.topic_id FROM topic_concepts tc WHERE tc.workspace_id=c.workspace_id AND tc.concept_id=c.id AND tc.mapping_status='mapped' ORDER BY tc.confidence DESC,tc.id LIMIT 1) AS sourceTopicId,v.prerequisite_concept_ids_json AS prerequisitesJson,v.public_payload_json AS payloadJson,m.performance,m.retention,m.recency,m.next_review_at AS nextReviewAt,m.error_count AS errorCount,m.successful_retrievals AS successfulRetrievals,m.last_evidence_at AS lastEvidenceAt,(SELECT a.outcome FROM learning_attempts a WHERE a.workspace_id=c.workspace_id AND a.concept_id=c.id ORDER BY a.occurred_at DESC,a.id DESC LIMIT 1) AS lastOutcome,(SELECT MAX(ri.answered_at) FROM review_items ri JOIN review_sessions rs ON rs.id=ri.session_id WHERE rs.workspace_id=c.workspace_id AND ri.concept_id=c.id) AS lastReviewedAt,(SELECT ri.assessment_variant_id FROM review_items ri JOIN review_sessions rs ON rs.id=ri.session_id WHERE rs.workspace_id=c.workspace_id AND ri.concept_id=c.id AND ri.answered_at IS NOT NULL ORDER BY ri.answered_at DESC LIMIT 1) AS lastVariantId,(SELECT MIN(due_at) FROM study_deadlines d WHERE d.workspace_id=c.workspace_id AND d.completed=0 AND d.due_at>=?) AS deadlineAt FROM concepts c JOIN concept_memories m ON m.workspace_id=c.workspace_id AND m.concept_id=c.id JOIN assessment_intents i ON i.workspace_id=c.workspace_id AND i.concept_id=c.id JOIN assessment_variants v ON v.workspace_id=c.workspace_id AND v.intent_id=i.id WHERE c.workspace_id=? AND v.public_payload_json<>'{}' AND v.evaluator_json<>'{}' AND EXISTS (SELECT 1 FROM topic_concepts tc WHERE tc.workspace_id=c.workspace_id AND tc.concept_id=c.id AND tc.mapping_status='mapped') AND EXISTS (SELECT 1 FROM learning_attempts a WHERE a.workspace_id=c.workspace_id AND a.concept_id=c.id) ORDER BY CASE WHEN m.next_review_at IS NOT NULL AND m.next_review_at<=? THEN 0 WHEN (SELECT a.outcome FROM learning_attempts a WHERE a.workspace_id=c.workspace_id AND a.concept_id=c.id ORDER BY a.occurred_at DESC,a.id DESC LIMIT 1)='incorrect' AND m.last_evidence_at>=? THEN 1 WHEN m.retention='fragile' THEN 2 ELSE 3 END,m.next_review_at,c.id,v.id`).all(now, workspaceId, now, now - RECENT_FAILURE_WINDOW) as Candidate[]
  }

  private hydratePublicObservationVariants(workspaceId: string, now: number): void {
    const rows = this.database.sqlite.prepare("SELECT v.id,e.id AS exerciseId,e.title,e.statement,e.language,e.prediction_prompt AS prompt,e.code_to_observe AS code,e.expected_prediction AS expected,s.topic_id AS topicId FROM assessment_variants v JOIN assessment_intents i ON i.id=v.intent_id JOIN exercises e ON e.id=v.source_ref JOIN exercise_sets s ON s.id=e.set_id AND s.workspace_id=v.workspace_id WHERE v.workspace_id=? AND e.kind='PREDICT_OUTPUT' AND e.expected_prediction IS NOT NULL AND e.code_to_observe IS NOT NULL AND EXISTS (SELECT 1 FROM topic_concepts tc WHERE tc.workspace_id=v.workspace_id AND tc.concept_id=i.concept_id AND tc.mapping_status='mapped')").all(workspaceId) as Array<{ id: string; exerciseId: string; title: string; statement: string; language: string; prompt: string; code: string; expected: string; topicId: string }>
    const update = this.database.sqlite.prepare('UPDATE assessment_variants SET source_ref=?,public_payload_json=?,evaluator_json=?,public_metadata_json=?,updated_at=? WHERE id=?')
    for (const row of rows) update.run(`exercise:${row.exerciseId}`, JSON.stringify({ type: 'code_observation', prompt: `${row.statement}\n${row.prompt}`, language: row.language, code: row.code }), JSON.stringify({ type: 'exact_text', expected: row.expected }), JSON.stringify({ sourceTopicId: row.topicId }), now, row.id)
  }
}
