import { closeSync, existsSync, fsyncSync, openSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import type Database from 'better-sqlite3'

function syncDirectory(path: string): void {
  const descriptor = openSync(dirname(path), 'r')
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

export function recoverPendingRestore(databasePath: string): void {
  const marker = `${databasePath}.restore-pending`
  if (!existsSync(marker)) return
  const previous = `${databasePath}.restore-previous`
  const staging = `${databasePath}.restore-staging`
  if (!existsSync(previous) && existsSync(databasePath) && existsSync(staging)) {
    rmSync(`${databasePath}-wal`, { force: true })
    rmSync(`${databasePath}-shm`, { force: true })
    renameSync(databasePath, previous)
    syncDirectory(databasePath)
  }
  if (!existsSync(databasePath)) {
    if (existsSync(staging)) renameSync(staging, databasePath)
    else if (existsSync(previous)) renameSync(previous, databasePath)
    else throw new Error('Coach restore recovery could not find a database copy')
    syncDirectory(databasePath)
  }
}

export function rollbackPendingRestore(databasePath: string): void {
  const marker = `${databasePath}.restore-pending`
  const previous = `${databasePath}.restore-previous`
  if (!existsSync(marker) || !existsSync(previous)) return
  rmSync(databasePath, { force: true })
  renameSync(previous, databasePath)
  rmSync(`${databasePath}.restore-staging`, { force: true })
  rmSync(marker, { force: true })
  syncDirectory(databasePath)
}

export function validateCoachDatabaseSchema(sqlite: Database.Database, expectedMigrationCount?: number): void {
  const integrity = sqlite.pragma('quick_check') as Array<{ quick_check: string }>
  if (integrity.length !== 1 || integrity[0]?.quick_check !== 'ok') throw new Error('Coach database integrity check failed')
  const foreignKeyErrors = sqlite.pragma('foreign_key_check') as unknown[]
  if (foreignKeyErrors.length) throw new Error('Coach database contains invalid relationships')
  if (expectedMigrationCount !== undefined) {
    const migrationCount = (sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get() as { count: number }).count
    if (migrationCount !== expectedMigrationCount) throw new Error('Coach backup version is incompatible with this application')
  }
  const requirements: Record<string, string[]> = {
    workspaces: ['id', 'name', 'objective'], conversation_threads: ['id', 'workspace_id'], conversation_messages: ['id', 'thread_id', 'content'],
    academic_subject_contexts: ['subject', 'declared_level', 'declared_knowledge_json', 'declared_difficulties_json', 'goals_json', 'source_evidence_json'],
    workspace_academic_contexts: ['workspace_id', 'subject', 'relation'],
    workspace_learning_overrides: ['workspace_id', 'subject', 'canonical_focus', 'canonical_context', 'declared_level', 'declared_knowledge_json', 'declared_difficulties_json', 'goals_json'],
    workspace_provisioning: ['workspace_id', 'status', 'stage', 'material_ids_json', 'attempt_count', 'stage_updated_at', 'retry_after', 'error_code'],
    workspace_content_revisions: ['workspace_id', 'revision', 'input_hash', 'state', 'cancellation_generation', 'roadmap_id', 'first_topic_id', 'first_lesson_id'],
    content_jobs: ['id', 'workspace_id', 'revision', 'kind', 'unit_key', 'priority', 'status', 'idempotency_key', 'input_hash', 'generator_contract_version', 'dependency_keys_json', 'attempt_count', 'max_attempts', 'available_at', 'lease_token', 'lease_expires_at', 'last_error_code'],
    content_job_dependencies: ['job_id', 'dependency_key'],
    content_revision_required_units: ['workspace_id', 'revision', 'kind', 'unit_key', 'input_hash'],
    study_sessions: ['id', 'workspace_id', 'status'], workspace_study_states: ['workspace_id', 'active_session_id', 'timer_started_monotonic_ms', 'timer_boot_id'], learning_events: ['id', 'session_id', 'type'],
    provider_configurations: ['id', 'provider_id', 'secret_reference'], materials: ['id', 'workspace_id', 'status', 'relevance'], material_chunks: ['id', 'material_id', 'content'],
    study_deadlines: ['id', 'workspace_id', 'due_at'], study_plan_items: ['id', 'session_id', 'status'], session_memories: ['id', 'session_id'], workspace_memories: ['id', 'workspace_id'], student_memory: ['id', 'summary'], saved_for_later: ['id', 'workspace_id'], session_topics: ['id', 'session_id'], routine_notes: ['id', 'content'],
    workspace_projects: ['id', 'workspace_id', 'language'], project_files: ['id', 'project_id', 'path', 'revision'], project_ui_states: ['project_id', 'active_file_id'], project_builds: ['id', 'project_id', 'diagnostics_json'],
    roadmaps: ['id', 'workspace_id', 'status', 'generation_kind', 'version', 'content_revision', 'content_hash'], workspace_learning_path_state: ['workspace_id', 'status', 'active_roadmap_id', 'retry_after'], study_lessons: ['id', 'workspace_id', 'roadmap_id', 'topic_id', 'generation_kind', 'content_json', 'content_revision', 'input_hash'], study_lesson_adaptations: ['id', 'workspace_id', 'lesson_id', 'source_block_id', 'revision', 'reason', 'mode', 'adapted_block_json', 'is_active'], workspace_study_preferences: ['workspace_id', 'preferences_json'], roadmap_modules: ['id', 'roadmap_id', 'position', 'status', 'topics_json', 'practice', 'completion_criteria_json', 'resources_json'],
    topic_learning_states: ['workspace_id', 'topic_id', 'evidence_count', 'difficulty_level', 'mastery_estimate', 'confidence', 'needs_review', 'reasons_json'],
    checkpoint_reasoning_evidence: ['answer_id', 'workspace_id', 'topic_id', 'lesson_id', 'checkpoint_id', 'alternative_correct', 'reasoning_status', 'summary', 'misconception', 'feedback', 'evaluated_at', 'retry_count', 'next_retry_at'],
    study_interactive_code_states: ['workspace_id', 'lesson_id', 'block_id', 'current_code', 'prediction', 'attempts', 'last_execution_json', 'validation_result_json', 'evidence_granted_at', 'current_source_revision', 'updated_at'],
    roadmap_adaptations: ['id', 'roadmap_id', 'module_id', 'topic_id', 'kind', 'source', 'reason_json'],
    planner_actions: ['id', 'origin_message_id', 'label', 'context_version', 'idempotency_key', 'type', 'status', 'payload_json'],
    academic_life_items: ['id', 'kind', 'status', 'title', 'timezone', 'provenance_source', 'fingerprint', 'share_with_ai', 'replaces_id', 'replaced_by_id'],
    weekly_plans: ['id', 'week_start', 'timezone', 'revision', 'generated_at'], weekly_plan_items: ['id', 'plan_id', 'workspace_id', 'source_key', 'date_key', 'status', 'topic_id', 'scheduled_start_minutes'],
    daily_planning_budgets: ['date_key', 'timezone', 'minutes', 'updated_at'], plan_item_completion_history: ['id', 'item_id', 'workspace_id', 'completed', 'duration_minutes', 'created_at'],
    planning_settings: ['id', 'timezone', 'updated_at'],
    workspace_content_authority: ['workspace_id', 'mutation_fingerprint', 'updated_at'],
    exercise_sets: ['id', 'workspace_id', 'topic_id', 'status', 'retry_after', 'content_revision', 'input_hash'], exercises: ['id', 'set_id', 'kind', 'difficulty', 'public_tests_json', 'private_tests_json', 'reference_solution', 'expected_prediction', 'prediction_prompt', 'code_to_observe', 'required_for_topic_completion'], exercise_progress: ['workspace_id', 'exercise_id', 'status', 'current_code', 'attempts', 'last_run_json', 'last_submission_json', 'passed_tests', 'total_tests', 'help_used', 'first_try_success', 'help_count', 'passed_at'], exercise_attempts: ['id', 'workspace_id', 'exercise_id', 'idempotency_key', 'prediction', 'private_result_json'],
    concepts: ['id', 'workspace_id', 'canonical_name', 'domain', 'parent_concept_id', 'metadata_json'], concept_aliases: ['id', 'concept_id', 'alias', 'normalized_alias', 'provenance'], topic_concepts: ['id', 'workspace_id', 'topic_id', 'concept_id', 'provenance', 'confidence', 'mapping_status'],
    assessment_intents: ['id', 'workspace_id', 'concept_id', 'kind', 'objective'], assessment_variants: ['id', 'workspace_id', 'intent_id', 'environment', 'source_ref', 'source_revision', 'difficulty', 'prerequisite_concept_ids_json', 'public_metadata_json', 'public_payload_json', 'evaluator_json'],
    learning_attempts: ['id', 'workspace_id', 'concept_id', 'environment', 'source_ref', 'source_revision', 'first_seen_at', 'idempotency_key', 'payload_hash', 'outcome', 'independent', 'reasoning_quality', 'occurred_at'], learning_evidence: ['id', 'attempt_id', 'concept_id', 'type', 'strength', 'ordinal', 'metadata_json', 'occurred_at'],
    concept_memories: ['workspace_id', 'concept_id', 'performance', 'evidence_quantity', 'independence', 'diversity', 'recency', 'retention', 'confidence', 'interval_days', 'next_review_at'],
    exercise_help_events: ['request_id', 'workspace_id', 'exercise_id', 'type', 'created_at'],
    review_sessions: ['id', 'workspace_id', 'target_size', 'status', 'started_at', 'completed_at', 'updated_at'], review_items: ['id', 'session_id', 'position', 'concept_id', 'assessment_intent_id', 'assessment_variant_id', 'status', 'first_seen_at'], review_help_events: ['request_id', 'review_item_id', 'created_at'],
  }
  for (const [table, requiredColumns] of Object.entries(requirements)) {
    const columns = new Set((sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>).map((column) => column.name))
    if (requiredColumns.some((column) => !columns.has(column))) throw new Error(`Coach database schema is missing ${table}`)
  }
}

export function finishPendingRestore(databasePath: string): void {
  const marker = `${databasePath}.restore-pending`
  if (!existsSync(marker)) return
  rmSync(`${databasePath}.restore-previous`, { force: true })
  rmSync(`${databasePath}.restore-staging`, { force: true })
  rmSync(marker, { force: true })
}
