import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'

export const workspaceReadinessStateSchema = z.enum(['PROVISIONING', 'USABLE', 'FULLY_PROVISIONED'])
export const contentUnitKindSchema = z.enum(['material_extract', 'material_analyze', 'roadmap_generate', 'lesson_generate', 'exercise_generate', 'plan_recalculate'])
export const contentJobStatusSchema = z.enum(['pending', 'queued', 'generating', 'ready', 'failed', 'obsolete'])
export const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$|^legacy-unavailable$/)

export const workspaceContentRevisionSchema = z.object({
  workspaceId: workspaceIdSchema,
  revision: z.number().int().positive(),
  inputHash: contentHashSchema,
  roadmapId: z.string().nullable(),
  firstTopicId: z.string().nullable(),
  firstLessonId: z.string().nullable(),
  state: workspaceReadinessStateSchema,
  cancellationGeneration: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  usableAt: z.number().int().nonnegative().nullable(),
  fullyProvisionedAt: z.number().int().nonnegative().nullable(),
  legacyState: z.literal('legacy_accessible').nullable(),
}).strict()

export const requiredContentUnitSchema = z.object({
  workspaceId: workspaceIdSchema,
  revision: z.number().int().positive(),
  kind: contentUnitKindSchema,
  unitKey: z.string().min(1).max(500),
  inputHash: contentHashSchema,
  createdAt: z.number().int().nonnegative(),
}).strict()

export const contentJobSchema = z.object({
  id: z.string().min(1).max(200),
  workspaceId: workspaceIdSchema,
  revision: z.number().int().positive(),
  kind: contentUnitKindSchema,
  unitKey: z.string().min(1).max(500),
  priority: z.number().int().nonnegative(),
  status: contentJobStatusSchema,
  idempotencyKey: contentHashSchema,
  inputHash: contentHashSchema,
  generatorContractVersion: z.string().min(1).max(100),
  dependencyKeys: z.array(contentHashSchema).max(100),
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  availableAt: z.number().int().nonnegative(),
  leaseOwner: z.string().nullable(),
  leaseToken: z.string().nullable(),
  leaseExpiresAt: z.number().int().nonnegative().nullable(),
  claimedCancellationGeneration: z.number().int().nonnegative().nullable(),
  startedAt: z.number().int().nonnegative().nullable(),
  completedAt: z.number().int().nonnegative().nullable(),
  obsoleteAt: z.number().int().nonnegative().nullable(),
  lastErrorCode: z.string().max(100).nullable(),
  lastErrorMessage: z.string().max(500).nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict()

export type WorkspaceReadinessState = z.infer<typeof workspaceReadinessStateSchema>
export type WorkspaceContentRevision = z.infer<typeof workspaceContentRevisionSchema>
export type ContentUnitKind = z.infer<typeof contentUnitKindSchema>
export type ContentJob = z.infer<typeof contentJobSchema>
export type RequiredContentUnit = z.infer<typeof requiredContentUnitSchema>
