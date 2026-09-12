import { createHash } from 'node:crypto'
import type { CoachDatabase } from '../../main/database/connection'
import { conceptMemorySchema, recordLearningAttemptSchema, type ConceptMemory, type LearningEvidenceRecorder, type RecordLearningAttempt } from '../../shared/contracts/learning-evidence-contract'

const DAY = 86_400_000
const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9+#]+/g, ' ').trim()
const stableId = (prefix: string, ...parts: string[]) => `${prefix}:${createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32)}`
function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
}
export function learningAttemptPayloadHash(input: RecordLearningAttempt): string {
  const parsed = recordLearningAttemptSchema.parse(input)
  const { idempotencyKey: _key, occurredAt: _occurredAt, ...payload } = parsed
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}

type AttemptRow = { environment: RecordLearningAttempt['environment']; outcome: RecordLearningAttempt['outcome']; correct: number | null; independent: number; reasoningQuality: RecordLearningAttempt['reasoningQuality']; occurredAt: number; firstSeenAt?: number | null; assessmentVariantId?: string | null; sourceRef?: string; sourceRevision?: string; helpCount: number }

export function calculateConceptMemory(workspaceId: string, conceptId: string, rows: AttemptRow[], now: number): ConceptMemory {
  const ordered = [...rows].sort((a, b) => a.occurredAt - b.occurredAt)
  let intervalDays = 1
  let lastSuccessAt: number | null = null
  let rawIndependentSuccesses = 0
  let independentOpportunities = 0
  let successes = 0
  let errors = 0
  let helpEvents = 0
  const environments = new Set<string>()
  const successfulVariants = new Set<string>()
  const opportunityVariants = new Set<string>()
  const attemptedVariants = new Set<string>()
  let spacedOpportunities = 0
  for (const row of ordered) {
    environments.add(row.environment)
    const rowVariant = row.assessmentVariantId ?? `${row.environment}:${row.sourceRef ?? 'unknown'}:${row.sourceRevision ?? 'unknown'}`
    attemptedVariants.add(rowVariant)
    helpEvents += row.helpCount
    const strongReasoning = row.reasoningQuality === 'coherent' || row.reasoningQuality === 'not_assessed'
    const success = row.correct === 1 && strongReasoning
    if (success) {
      successes++
      if (row.independent) {
        rawIndependentSuccesses++
        const delayDays = Math.max(0, (row.occurredAt - (lastSuccessAt ?? row.firstSeenAt ?? row.occurredAt)) / DAY)
        const variant = rowVariant
        const distinctVariant = !opportunityVariants.has(variant)
        const spacedRetrieval = lastSuccessAt !== null && delayDays >= Math.max(1, intervalDays)
        if (distinctVariant || spacedRetrieval) {
          independentOpportunities++
          if (spacedRetrieval) spacedOpportunities++
          opportunityVariants.add(variant)
          successfulVariants.add(variant)
          intervalDays = Math.min(60, Math.max(intervalDays + 1, Math.round(intervalDays * (spacedRetrieval ? 2 : 1.35)), delayDays >= 3 ? Math.min(14, Math.round(delayDays)) : 1))
        }
        lastSuccessAt = row.occurredAt
      } else intervalDays = Math.max(1, Math.floor(intervalDays * 0.8))
    } else if (row.correct === 0 || row.reasoningQuality === 'misconception' || row.reasoningQuality === 'insufficient' || row.reasoningQuality === 'off_topic') {
      errors++
      intervalDays = Math.max(1, Math.floor(intervalDays * 0.5))
    }
      if (row.helpCount) intervalDays = Math.max(1, Math.floor(intervalDays * 0.5))
  }
  const quantity = ordered.length === 0 ? 'none' : ordered.length < 3 ? 'sparse' : ordered.length < 7 ? 'some' : 'substantial'
  const performance = ordered.length === 0 ? 'unknown' : errors >= successes ? 'struggling' : independentOpportunities >= 4 && successfulVariants.size >= 2 && errors <= Math.floor(successes / 2) ? 'secure' : 'developing'
  const independence = successes === 0 ? 'unknown' : rawIndependentSuccesses === successes ? 'independent' : rawIndependentSuccesses === 0 ? 'dependent' : 'mixed'
  const diversity = environments.size >= 3 || attemptedVariants.size >= 3 ? 'diverse_contexts' : environments.size >= 2 || attemptedVariants.size >= 2 ? 'mixed_contexts' : 'single_context'
  const lastEvidenceAt = ordered.at(-1)?.occurredAt ?? null
  const ageDays = lastEvidenceAt === null ? Infinity : Math.max(0, (now - lastEvidenceAt) / DAY)
  const recency = lastEvidenceAt === null ? 'unknown' : ageDays <= intervalDays ? 'recent' : ageDays <= intervalDays * 2 ? 'aging' : 'stale'
  const opportunityDiversity = successfulVariants.size >= 2 || spacedOpportunities >= 2
  const retention = independentOpportunities < 2 ? 'unknown' : errors > successes / 2 || helpEvents >= successes ? 'fragile' : independentOpportunities >= 4 && opportunityDiversity && intervalDays >= 7 ? 'durable' : 'developing'
  const confidence = independentOpportunities >= 5 && opportunityDiversity && (environments.size >= 2 || successfulVariants.size >= 2 || spacedOpportunities >= 3) ? 'high' : independentOpportunities >= 3 ? 'medium' : 'low'
  return conceptMemorySchema.parse({ workspaceId, conceptId, performance, evidenceQuantity: quantity, independence, diversity, recency, retention, confidence, successfulRetrievals: successes, independentSuccesses: independentOpportunities, errorCount: errors, helpEvents, environmentCount: environments.size, intervalDays, lastEvidenceAt, nextReviewAt: lastEvidenceAt === null ? null : lastEvidenceAt + intervalDays * DAY, updatedAt: now })
}

export class SqliteLearningEvidenceService implements LearningEvidenceRecorder {
  constructor(private readonly database: CoachDatabase) {}

  record(raw: RecordLearningAttempt): { attemptId: string; inserted: boolean; memory: ConceptMemory | null } {
    const input = recordLearningAttemptSchema.parse(raw)
    const payloadHash = learningAttemptPayloadHash(input)
    return this.database.sqlite.transaction(() => {
      const replay = this.database.sqlite.prepare('SELECT id,concept_id AS conceptId,payload_hash AS payloadHash FROM learning_attempts WHERE workspace_id=? AND environment=? AND idempotency_key=?').get(input.workspaceId, input.environment, input.idempotencyKey) as { id: string; conceptId: string | null; payloadHash: string } | undefined
      if (replay) {
        if (replay.payloadHash !== payloadHash) throw new Error('Learning attempt idempotency collision: key was used with a different canonical payload')
        const memory = replay.conceptId ? this.readMemory(input.workspaceId, replay.conceptId) : null
        return { attemptId: replay.id, inserted: false, memory }
      }
      const conceptId = this.resolveConcept(input)
      if (input.topicId) this.ensureTopicMapping(input, conceptId)
      const { intentId, variantId } = conceptId ? this.ensureAssessment(input, conceptId) : { intentId: null, variantId: null }
      const attemptId = stableId('attempt', input.workspaceId, input.environment, input.idempotencyKey)
      this.database.sqlite.prepare('INSERT INTO learning_attempts (id,workspace_id,concept_id,assessment_intent_id,assessment_variant_id,environment,source_ref,source_revision,first_seen_at,idempotency_key,payload_hash,outcome,correct,independent,reasoning_quality,occurred_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(attemptId, input.workspaceId, conceptId, input.assessmentIntentId ?? intentId, input.assessmentVariantId ?? variantId, input.environment, input.sourceRef, input.sourceRevision, input.firstSeenAt, input.idempotencyKey, payloadHash, input.outcome, input.correct === null ? null : Number(input.correct), Number(input.independent), input.reasoningQuality, input.occurredAt, input.occurredAt)
      const insertEvidence = this.database.sqlite.prepare('INSERT INTO learning_evidence (id,attempt_id,concept_id,type,strength,ordinal,metadata_json,occurred_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      for (const event of input.events) insertEvidence.run(stableId('evidence', attemptId, event.type, String(event.ordinal)), attemptId, conceptId, event.type, event.strength, event.ordinal, JSON.stringify(event.metadata), input.occurredAt, input.occurredAt)
      return { attemptId, inserted: true, memory: conceptId ? this.rebuildMemory(input.workspaceId, conceptId, input.occurredAt) : null }
    })()
  }

  private readMemory(workspaceId: string, conceptId: string): ConceptMemory | null {
    const row = this.database.sqlite.prepare('SELECT workspace_id AS workspaceId,concept_id AS conceptId,performance,evidence_quantity AS evidenceQuantity,independence,diversity,recency,retention,confidence,successful_retrievals AS successfulRetrievals,independent_successes AS independentSuccesses,error_count AS errorCount,help_events AS helpEvents,environment_count AS environmentCount,interval_days AS intervalDays,last_evidence_at AS lastEvidenceAt,next_review_at AS nextReviewAt,updated_at AS updatedAt FROM concept_memories WHERE workspace_id=? AND concept_id=?').get(workspaceId, conceptId)
    return row ? conceptMemorySchema.parse(row) : null
  }

  private resolveConcept(input: RecordLearningAttempt): string | null {
    if (input.conceptId) {
      const owned = this.database.sqlite.prepare('SELECT id FROM concepts WHERE id=? AND workspace_id=?').get(input.conceptId, input.workspaceId) as { id: string } | undefined
      if (!owned) throw new Error('Concept does not belong to workspace')
      return owned.id
    }
    if (input.topicId) {
      const mapped = this.database.sqlite.prepare("SELECT concept_id AS conceptId FROM topic_concepts WHERE workspace_id=? AND topic_id=? AND mapping_status='mapped' AND concept_id IS NOT NULL ORDER BY confidence DESC,id LIMIT 1").get(input.workspaceId, input.topicId) as { conceptId: string } | undefined
      if (mapped) return mapped.conceptId
    }
    if (input.mappingProvenance === 'explicit' && input.conceptLabel && input.mappingConfidence === 1) return this.ensureConcept(input)
    return null
  }

  private ensureConcept(input: RecordLearningAttempt): string {
    const canonicalName = input.conceptLabel!.trim()
    const domain = input.conceptDomain ?? 'workspace-curriculum'
    const found = this.database.sqlite.prepare('SELECT id FROM concepts WHERE workspace_id=? AND domain=? AND canonical_name=?').get(input.workspaceId, domain, canonicalName) as { id: string } | undefined
    if (found) return found.id
    const id = stableId('concept', input.workspaceId, domain, normalize(canonicalName))
    this.database.sqlite.prepare("INSERT OR IGNORE INTO concepts (id,workspace_id,canonical_name,domain,parent_concept_id,metadata_json,created_at,updated_at) VALUES (?,?,?,?,NULL,'{}',?,?)").run(id, input.workspaceId, canonicalName, domain, input.occurredAt, input.occurredAt)
    this.database.sqlite.prepare('INSERT OR IGNORE INTO concept_aliases (id,concept_id,alias,normalized_alias,provenance,created_at) VALUES (?,?,?,?,?,?)').run(stableId('alias', id, normalize(canonicalName)), id, canonicalName, normalize(canonicalName), input.mappingProvenance, input.occurredAt)
    return id
  }

  private ensureTopicMapping(input: RecordLearningAttempt, conceptId: string | null): void {
    const existing = this.database.sqlite.prepare('SELECT id FROM topic_concepts WHERE workspace_id=? AND topic_id=? AND concept_id IS ?').get(input.workspaceId, input.topicId, conceptId) as { id: string } | undefined
    if (existing) {
      if (conceptId) this.database.sqlite.prepare("DELETE FROM topic_concepts WHERE workspace_id=? AND topic_id=? AND concept_id IS NULL AND mapping_status='unknown'").run(input.workspaceId, input.topicId)
      return
    }
    if (conceptId) this.database.sqlite.prepare("DELETE FROM topic_concepts WHERE workspace_id=? AND topic_id=? AND concept_id IS NULL AND mapping_status='unknown'").run(input.workspaceId, input.topicId)
    const moduleId = input.topicId!.split(':')[0] ?? 'unknown'
    const roadmapId = this.database.sqlite.prepare("SELECT id FROM roadmaps WHERE workspace_id=? AND status='accepted' ORDER BY version DESC LIMIT 1").get(input.workspaceId) as { id: string } | undefined
    this.database.sqlite.prepare('INSERT INTO topic_concepts (id,workspace_id,roadmap_id,module_id,topic_id,concept_id,provenance,confidence,mapping_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(stableId('mapping', input.workspaceId, input.topicId!, conceptId ?? 'unknown'), input.workspaceId, roadmapId?.id ?? 'unknown', moduleId, input.topicId, conceptId, input.mappingProvenance ?? 'legacy_backfill', input.mappingConfidence ?? 0, conceptId ? 'mapped' : 'unknown', input.occurredAt, input.occurredAt)
  }

  private ensureAssessment(input: RecordLearningAttempt, conceptId: string): { intentId: string | null; variantId: string | null } {
    if (!input.difficulty) return { intentId: null, variantId: null }
    const prerequisites = input.prerequisiteConceptIds ?? []
    const invalidPrerequisite = prerequisites.find((id) => !this.database.sqlite.prepare("SELECT 1 FROM concepts c WHERE c.id=? AND c.workspace_id=? AND (c.id=? OR EXISTS (SELECT 1 FROM topic_concepts tc WHERE tc.workspace_id=c.workspace_id AND tc.concept_id=c.id AND tc.mapping_status='mapped'))").get(id, input.workspaceId, conceptId))
    if (invalidPrerequisite) throw new Error('Prerequisite concept is not taught or mapped in workspace')
    const kind = input.environment === 'checkpoint' ? 'conceptual_recall' : input.environment === 'exercise' ? 'applied_problem' : 'guided_practice'
    const intentId = input.assessmentIntentId ?? stableId('intent', input.workspaceId, conceptId, kind)
    if (input.assessmentIntentId && !this.database.sqlite.prepare('SELECT 1 FROM assessment_intents WHERE id=? AND workspace_id=? AND concept_id=?').get(intentId, input.workspaceId, conceptId)) throw new Error('Assessment intent does not belong to workspace concept')
    this.database.sqlite.prepare('INSERT OR IGNORE INTO assessment_intents (id,workspace_id,concept_id,kind,objective,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(intentId, input.workspaceId, conceptId, kind, `Demonstrar ${input.conceptLabel ?? 'o conceito'}`, input.occurredAt, input.occurredAt)
    const variantId = input.assessmentVariantId ?? stableId('variant', input.workspaceId, intentId, input.environment, input.sourceRef, input.sourceRevision)
    if (input.assessmentVariantId && !this.database.sqlite.prepare('SELECT 1 FROM assessment_variants WHERE id=? AND workspace_id=? AND intent_id=?').get(variantId, input.workspaceId, intentId)) throw new Error('Assessment variant does not belong to workspace intent')
    this.database.sqlite.prepare("INSERT OR IGNORE INTO assessment_variants (id,workspace_id,intent_id,environment,source_ref,source_revision,difficulty,prerequisite_concept_ids_json,public_metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'{}',?,?)").run(variantId, input.workspaceId, intentId, input.environment, input.sourceRef, input.sourceRevision, input.difficulty, JSON.stringify(prerequisites), input.occurredAt, input.occurredAt)
    return { intentId, variantId }
  }

  private rebuildMemory(workspaceId: string, conceptId: string, now: number): ConceptMemory {
    const rows = this.database.sqlite.prepare(`SELECT a.environment,a.outcome,a.correct,a.independent,a.reasoning_quality AS reasoningQuality,a.occurred_at AS occurredAt,a.first_seen_at AS firstSeenAt,a.assessment_variant_id AS assessmentVariantId,a.source_ref AS sourceRef,a.source_revision AS sourceRevision,(SELECT COUNT(*) FROM learning_evidence e WHERE e.attempt_id=a.id AND e.type IN ('hint_requested','coach_help_requested','worked_example_shown','solution_revealed','automatic_intervention')) AS helpCount FROM learning_attempts a WHERE a.workspace_id=? AND a.concept_id=? ORDER BY a.occurred_at,a.id`).all(workspaceId, conceptId) as AttemptRow[]
    const memory = calculateConceptMemory(workspaceId, conceptId, rows, now)
    this.database.sqlite.prepare(`INSERT INTO concept_memories (workspace_id,concept_id,performance,evidence_quantity,independence,diversity,recency,retention,confidence,successful_retrievals,independent_successes,error_count,help_events,environment_count,interval_days,last_evidence_at,next_review_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,concept_id) DO UPDATE SET performance=excluded.performance,evidence_quantity=excluded.evidence_quantity,independence=excluded.independence,diversity=excluded.diversity,recency=excluded.recency,retention=excluded.retention,confidence=excluded.confidence,successful_retrievals=excluded.successful_retrievals,independent_successes=excluded.independent_successes,error_count=excluded.error_count,help_events=excluded.help_events,environment_count=excluded.environment_count,interval_days=excluded.interval_days,last_evidence_at=excluded.last_evidence_at,next_review_at=excluded.next_review_at,updated_at=excluded.updated_at`).run(memory.workspaceId, memory.conceptId, memory.performance, memory.evidenceQuantity, memory.independence, memory.diversity, memory.recency, memory.retention, memory.confidence, memory.successfulRetrievals, memory.independentSuccesses, memory.errorCount, memory.helpEvents, memory.environmentCount, memory.intervalDays, memory.lastEvidenceAt, memory.nextReviewAt, memory.updatedAt)
    return memory
  }
}
