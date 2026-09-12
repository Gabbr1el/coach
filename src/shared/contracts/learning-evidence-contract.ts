import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'

const entityIdSchema = z.string().min(1).max(420)

export const reasoningRequirementSchema = z.enum(['none', 'optional', 'required'])
export const learningEnvironmentSchema = z.enum(['checkpoint', 'exercise', 'study_interactive', 'practice', 'review'])
export const learningOutcomeSchema = z.enum(['correct', 'incorrect', 'completed', 'observed'])
export const learningEvidenceTypeSchema = z.enum([
  'answer_correct',
  'answer_incorrect',
  'hint_requested',
  'reinforcement_shown',
  'coach_help_requested',
  'worked_example_shown',
  'solution_revealed',
  'automatic_intervention',
  'attempt_observed',
])
export const evidenceStrengthSchema = z.enum(['none', 'weak', 'moderate', 'strong'])
export const conceptMappingStatusSchema = z.enum(['mapped', 'unknown', 'rejected'])
export const conceptMappingProvenanceSchema = z.enum(['explicit', 'legacy_backfill', 'manual'])

export const recordLearningAttemptSchema = z.object({
  workspaceId: workspaceIdSchema,
  environment: learningEnvironmentSchema,
  sourceRef: entityIdSchema,
  sourceRevision: z.string().min(1).max(128),
  firstSeenAt: z.number().int().nonnegative().nullable().default(null),
  idempotencyKey: z.string().min(1).max(300),
  occurredAt: z.number().int().nonnegative(),
  outcome: learningOutcomeSchema,
  correct: z.boolean().nullable(),
  independent: z.boolean(),
  topicId: entityIdSchema.optional(),
  conceptId: entityIdSchema.optional(),
  conceptLabel: z.string().trim().min(1).max(240).optional(),
  conceptDomain: z.string().trim().min(1).max(120).optional(),
  mappingProvenance: conceptMappingProvenanceSchema.optional(),
  mappingConfidence: z.number().min(0).max(1).optional(),
  assessmentIntentId: entityIdSchema.optional(),
  assessmentVariantId: entityIdSchema.optional(),
  difficulty: z.enum(['introductory', 'standard', 'challenge']).optional(),
  prerequisiteConceptIds: z.array(entityIdSchema).max(30).default([]),
  reasoningQuality: z.enum(['coherent', 'partial', 'misconception', 'insufficient', 'off_topic', 'not_assessed']).default('not_assessed'),
  events: z.array(z.object({ type: learningEvidenceTypeSchema, strength: evidenceStrengthSchema, ordinal: z.number().int().nonnegative(), metadata: z.record(z.string(), z.unknown()).default({}) }).strict()).min(1).max(20),
}).strict()

export const conceptMemorySchema = z.object({
  workspaceId: workspaceIdSchema,
  conceptId: entityIdSchema,
  performance: z.enum(['unknown', 'struggling', 'developing', 'secure']),
  evidenceQuantity: z.enum(['none', 'sparse', 'some', 'substantial']),
  independence: z.enum(['unknown', 'dependent', 'mixed', 'independent']),
  diversity: z.enum(['single_context', 'mixed_contexts', 'diverse_contexts']),
  recency: z.enum(['unknown', 'recent', 'aging', 'stale']),
  retention: z.enum(['unknown', 'fragile', 'developing', 'durable']),
  confidence: z.enum(['low', 'medium', 'high']),
  successfulRetrievals: z.number().int().nonnegative(),
  independentSuccesses: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  helpEvents: z.number().int().nonnegative(),
  environmentCount: z.number().int().nonnegative(),
  intervalDays: z.number().int().min(1).max(60),
  lastEvidenceAt: z.number().int().nonnegative().nullable(),
  nextReviewAt: z.number().int().nonnegative().nullable(),
  updatedAt: z.number().int().nonnegative(),
}).strict()

export type ReasoningRequirement = z.infer<typeof reasoningRequirementSchema>
export type RecordLearningAttempt = z.input<typeof recordLearningAttemptSchema>
export type ConceptMemory = z.infer<typeof conceptMemorySchema>

export interface LearningEvidenceRecorder {
  record(input: RecordLearningAttempt): { attemptId: string; inserted: boolean; memory: ConceptMemory | null }
}
