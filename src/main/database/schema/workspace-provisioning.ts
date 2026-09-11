import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { workspaces } from './workspaces'

export const workspaceLearningOverrides = sqliteTable('workspace_learning_overrides', {
  workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  subject: text('subject').notNull(),
  canonicalFocus: text('canonical_focus').notNull().default(''),
  canonicalContext: text('canonical_context').notNull().default(''),
  declaredLevel: text('declared_level', { enum: ['beginner', 'intermediate', 'advanced'] }),
  declaredKnowledgeJson: text('declared_knowledge_json').notNull().default('[]'),
  declaredDifficultiesJson: text('declared_difficulties_json').notNull().default('[]'),
  goalsJson: text('goals_json').notNull().default('[]'),
  onboardingAnalysisRevision: integer('onboarding_analysis_revision'),
  onboardingAnalysisFingerprint: text('onboarding_analysis_fingerprint'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [check('workspace_learning_overrides_level_check', sql`${table.declaredLevel} is null or ${table.declaredLevel} in ('beginner','intermediate','advanced')`)])

export const workspaceProvisioning = sqliteTable('workspace_provisioning', {
  workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['draft', 'queued', 'running', 'waiting_for_provider', 'failed_retryable', 'ready'] }).notNull(),
  stage: text('stage', { enum: ['workspace', 'materials', 'roadmap', 'lesson', 'exercises', 'plan', 'background', 'ready'] }).notNull(),
  materialIdsJson: text('material_ids_json').notNull().default('[]'),
  attemptCount: integer('attempt_count').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  startedAt: integer('started_at'),
  stageUpdatedAt: integer('stage_updated_at').notNull(),
  completedAt: integer('completed_at'),
  retryAfter: integer('retry_after'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
}, (table) => [check('workspace_provisioning_status_check', sql`${table.status} in ('draft','queued','running','waiting_for_provider','failed_retryable','ready')`), check('workspace_provisioning_stage_check', sql`${table.stage} in ('workspace','materials','roadmap','lesson','exercises','plan','background','ready')`), index('workspace_provisioning_resume_idx').on(table.status, table.retryAfter)])

export const workspaceContentRevisions = sqliteTable('workspace_content_revisions', {
  workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  inputHash: text('input_hash').notNull(),
  roadmapId: text('roadmap_id'),
  firstTopicId: text('first_topic_id'),
  firstLessonId: text('first_lesson_id'),
  state: text('state', { enum: ['provisioning', 'usable', 'fully_provisioned'] }).notNull().default('provisioning'),
  cancellationGeneration: integer('cancellation_generation').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  usableAt: integer('usable_at'),
  fullyProvisionedAt: integer('fully_provisioned_at'),
  legacyState: text('legacy_state', { enum: ['legacy_accessible'] }),
}, (table) => [
  check('workspace_content_revisions_revision_check', sql`${table.revision} > 0`),
  check('workspace_content_revisions_state_check', sql`${table.state} in ('provisioning','usable','fully_provisioned')`),
  index('workspace_content_revisions_state_idx').on(table.state, table.updatedAt),
])

export const contentJobs = sqliteTable('content_jobs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  kind: text('kind', { enum: ['material_extract', 'material_analyze', 'roadmap_generate', 'lesson_generate', 'exercise_generate', 'plan_recalculate'] }).notNull(),
  unitKey: text('unit_key').notNull(),
  priority: integer('priority').notNull(),
  status: text('status', { enum: ['pending', 'queued', 'generating', 'ready', 'failed', 'obsolete'] }).notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  inputHash: text('input_hash').notNull(),
  generatorContractVersion: text('generator_contract_version').notNull(),
  dependencyKeysJson: text('dependency_keys_json').notNull().default('[]'),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  availableAt: integer('available_at').notNull(),
  leaseOwner: text('lease_owner'),
  leaseToken: text('lease_token'),
  leaseExpiresAt: integer('lease_expires_at'),
  claimedCancellationGeneration: integer('claimed_cancellation_generation'),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
  obsoleteAt: integer('obsolete_at'),
  lastErrorCode: text('last_error_code'),
  lastErrorMessage: text('last_error_message'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  check('content_jobs_revision_check', sql`${table.revision} > 0`),
  check('content_jobs_priority_check', sql`${table.priority} >= 0`),
  check('content_jobs_attempts_check', sql`${table.attemptCount} >= 0 and ${table.maxAttempts} > 0`),
  check('content_jobs_status_check', sql`${table.status} in ('pending','queued','generating','ready','failed','obsolete')`),
  uniqueIndex('content_jobs_idempotency_idx').on(table.idempotencyKey),
  uniqueIndex('content_jobs_unit_idx').on(table.workspaceId, table.revision, table.kind, table.unitKey),
  index('content_jobs_claim_idx').on(table.status, table.priority, table.availableAt, table.createdAt),
  index('content_jobs_lease_idx').on(table.status, table.leaseExpiresAt),
  index('content_jobs_workspace_revision_idx').on(table.workspaceId, table.revision, table.status),
])

export const contentJobDependencies = sqliteTable('content_job_dependencies', {
  jobId: text('job_id').notNull().references(() => contentJobs.id, { onDelete: 'cascade' }),
  dependencyKey: text('dependency_key').notNull(),
}, (table) => [
  uniqueIndex('content_job_dependencies_key_idx').on(table.jobId, table.dependencyKey),
  index('content_job_dependencies_lookup_idx').on(table.dependencyKey, table.jobId),
])

export const contentRevisionRequiredUnits = sqliteTable('content_revision_required_units', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  kind: text('kind', { enum: ['material_extract', 'material_analyze', 'roadmap_generate', 'lesson_generate', 'exercise_generate', 'plan_recalculate'] }).notNull(),
  unitKey: text('unit_key').notNull(),
  inputHash: text('input_hash').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  uniqueIndex('content_required_units_key_idx').on(table.workspaceId, table.revision, table.kind, table.unitKey),
  index('content_required_units_revision_idx').on(table.workspaceId, table.revision),
])
