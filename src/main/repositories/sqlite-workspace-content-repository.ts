import { createHash, randomUUID } from 'node:crypto'
import { studyLessonContentSchema } from '../../shared/contracts/study-lesson-contract'
import { contentJobSchema, requiredContentUnitSchema, workspaceContentRevisionSchema, type ContentJob, type RequiredContentUnit, type WorkspaceContentRevision } from '../../shared/contracts/workspace-content-contract'
import { CONTENT_JOB_DEFAULTS, type EnqueueContentJobInput, type WorkspaceContentRepository } from '../../application/workspaces/workspace-content-repository'
import type { CoachDatabase } from '../database/connection'
import { validExerciseData } from '../database/exercise-data-repair'

type RevisionRow = Omit<WorkspaceContentRevision, 'state'> & { state: 'provisioning' | 'usable' | 'fully_provisioned' }
type JobRow = Omit<ContentJob, 'dependencyKeys'> & { dependencyKeysJson: string }
type RawExercise = Parameters<typeof validExerciseData>[0]

const revisionColumns = 'workspace_id AS workspaceId,revision,input_hash AS inputHash,roadmap_id AS roadmapId,first_topic_id AS firstTopicId,first_lesson_id AS firstLessonId,state,cancellation_generation AS cancellationGeneration,created_at AS createdAt,updated_at AS updatedAt,usable_at AS usableAt,fully_provisioned_at AS fullyProvisionedAt,legacy_state AS legacyState'
const jobColumns = 'id,workspace_id AS workspaceId,revision,kind,unit_key AS unitKey,priority,status,idempotency_key AS idempotencyKey,input_hash AS inputHash,generator_contract_version AS generatorContractVersion,dependency_keys_json AS dependencyKeysJson,attempt_count AS attemptCount,max_attempts AS maxAttempts,available_at AS availableAt,lease_owner AS leaseOwner,lease_token AS leaseToken,lease_expires_at AS leaseExpiresAt,claimed_cancellation_generation AS claimedCancellationGeneration,started_at AS startedAt,completed_at AS completedAt,obsolete_at AS obsoleteAt,last_error_code AS lastErrorCode,last_error_message AS lastErrorMessage,created_at AS createdAt,updated_at AS updatedAt'

function mapRevision(row: RevisionRow): WorkspaceContentRevision {
  return workspaceContentRevisionSchema.parse({ ...row, state: row.state.toUpperCase() })
}

function mapJob(row: JobRow): ContentJob {
  const { dependencyKeysJson, ...job } = row
  return contentJobSchema.parse({ ...job, dependencyKeys: JSON.parse(dependencyKeysJson) })
}

function idempotencyKey(input: EnqueueContentJobInput): string {
  return createHash('sha256').update([input.workspaceId, input.revision, input.kind, input.unitKey, input.inputHash, input.generatorContractVersion].join('|')).digest('hex')
}

function safeErrorMessage(value: string | undefined): string | null {
  return value ? value.replace(/[\r\n\t]+/g, ' ').slice(0, 500) : null
}

export class SqliteWorkspaceContentRepository implements WorkspaceContentRepository {
  constructor(private readonly database: CoachDatabase) {}

  getRevision(workspaceId: string): WorkspaceContentRevision | null {
    const row = this.database.sqlite.prepare(`SELECT ${revisionColumns} FROM workspace_content_revisions WHERE workspace_id=?`).get(workspaceId) as RevisionRow | undefined
    return row ? mapRevision(row) : null
  }

  createRevision(input: { workspaceId: string; inputHash: string; now: number }): WorkspaceContentRevision {
    return this.immediate(() => {
      const current = this.getRevision(input.workspaceId)
      const revision = (current?.revision ?? 0) + 1
      const cancellationGeneration = (current?.cancellationGeneration ?? 0) + 1
      this.database.sqlite.prepare("UPDATE content_jobs SET status='obsolete',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,claimed_cancellation_generation=NULL,obsolete_at=?,updated_at=?,last_error_code='REVISION_SUPERSEDED' WHERE workspace_id=? AND revision<>? AND status<>'obsolete'").run(input.now, input.now, input.workspaceId, revision)
      this.database.sqlite.prepare("INSERT INTO workspace_content_revisions (workspace_id,revision,input_hash,state,cancellation_generation,created_at,updated_at,legacy_state) VALUES (?,?,?,'provisioning',?,?,?,NULL) ON CONFLICT(workspace_id) DO UPDATE SET revision=excluded.revision,input_hash=excluded.input_hash,roadmap_id=NULL,first_topic_id=NULL,first_lesson_id=NULL,state='provisioning',cancellation_generation=excluded.cancellation_generation,created_at=excluded.created_at,updated_at=excluded.updated_at,usable_at=NULL,fully_provisioned_at=NULL,legacy_state=NULL").run(input.workspaceId, revision, input.inputHash, cancellationGeneration, input.now, input.now)
      return this.getRevision(input.workspaceId)!
    })
  }

  replaceRequiredUnits(workspaceId: string, revision: number, units: readonly Omit<RequiredContentUnit, 'workspaceId' | 'revision' | 'createdAt'>[], now: number): RequiredContentUnit[] {
    return this.immediate(() => {
      this.requireCurrent(workspaceId, revision)
      const canonical = [...units].sort((a, b) => `${a.kind}:${a.unitKey}`.localeCompare(`${b.kind}:${b.unitKey}`))
      const keys = new Set(canonical.map((unit) => `${unit.kind}\u0000${unit.unitKey}`))
      const existing = this.database.sqlite.prepare('SELECT kind,unit_key AS unitKey FROM content_revision_required_units WHERE workspace_id=? AND revision=?').all(workspaceId, revision) as Array<{ kind: string; unitKey: string }>
      for (const unit of existing) if (!keys.has(`${unit.kind}\u0000${unit.unitKey}`)) this.database.sqlite.prepare("UPDATE content_jobs SET status='obsolete',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,claimed_cancellation_generation=NULL,obsolete_at=?,updated_at=?,last_error_code='UNIT_REMOVED' WHERE workspace_id=? AND revision=? AND kind=? AND unit_key=? AND status<>'obsolete'").run(now, now, workspaceId, revision, unit.kind, unit.unitKey)
      this.database.sqlite.prepare('DELETE FROM content_revision_required_units WHERE workspace_id=? AND revision=?').run(workspaceId, revision)
      const insert = this.database.sqlite.prepare('INSERT INTO content_revision_required_units (workspace_id,revision,kind,unit_key,input_hash,created_at) VALUES (?,?,?,?,?,?)')
      for (const unit of canonical) insert.run(workspaceId, revision, unit.kind, unit.unitKey, unit.inputHash, now)
      return this.listRequiredUnits(workspaceId, revision)
    })
  }

  listRequiredUnits(workspaceId: string, revision: number): RequiredContentUnit[] {
    return (this.database.sqlite.prepare('SELECT workspace_id AS workspaceId,revision,kind,unit_key AS unitKey,input_hash AS inputHash,created_at AS createdAt FROM content_revision_required_units WHERE workspace_id=? AND revision=? ORDER BY kind,unit_key').all(workspaceId, revision) as RequiredContentUnit[]).map((row) => requiredContentUnitSchema.parse(row))
  }

  enqueue(input: EnqueueContentJobInput, now: number): ContentJob {
    const dependencies = [...new Set(input.dependencyKeys ?? [])].sort()
    const key = idempotencyKey(input)
    this.immediate(() => {
      this.requireCurrent(input.workspaceId, input.revision, input.inputHash)
      this.database.sqlite.prepare("INSERT INTO content_jobs (id,workspace_id,revision,kind,unit_key,priority,status,idempotency_key,input_hash,generator_contract_version,dependency_keys_json,max_attempts,available_at,created_at,updated_at) VALUES (?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,revision,kind,unit_key) DO UPDATE SET priority=MAX(content_jobs.priority,excluded.priority),available_at=MIN(content_jobs.available_at,excluded.available_at),updated_at=excluded.updated_at").run(randomUUID(), input.workspaceId, input.revision, input.kind, input.unitKey, input.priority, key, input.inputHash, input.generatorContractVersion, JSON.stringify(dependencies), input.maxAttempts ?? CONTENT_JOB_DEFAULTS.maxAttempts, input.availableAt ?? now, now, now)
      const job = this.findUnit(input.workspaceId, input.revision, input.kind, input.unitKey)!
      if (job.inputHash !== input.inputHash || job.generatorContractVersion !== input.generatorContractVersion || job.idempotencyKey !== key || JSON.stringify(job.dependencyKeys) !== JSON.stringify(dependencies)) throw new Error('Content job unit was already enqueued with different immutable inputs')
      this.database.sqlite.prepare('DELETE FROM content_job_dependencies WHERE job_id=?').run(job.id)
      const insertDependency = this.database.sqlite.prepare('INSERT INTO content_job_dependencies (job_id,dependency_key) VALUES (?,?)')
      for (const dependency of dependencies) insertDependency.run(job.id, dependency)
      this.promoteEligible(input.workspaceId, input.revision, now)
    })
    return this.findUnit(input.workspaceId, input.revision, input.kind, input.unitKey)!
  }

  getJob(id: string): ContentJob | null {
    const row = this.database.sqlite.prepare(`SELECT ${jobColumns} FROM content_jobs WHERE id=?`).get(id) as JobRow | undefined
    return row ? mapJob(row) : null
  }

  claimNext(input: { owner: string; now: number; leaseMs?: number }): ContentJob | null {
    return this.immediate(() => {
      this.reconcileWithinTransaction(input.now)
      const row = this.database.sqlite.prepare(`SELECT j.id FROM content_jobs j JOIN workspace_content_revisions r ON r.workspace_id=j.workspace_id AND r.revision=j.revision AND r.input_hash=j.input_hash JOIN workspaces w ON w.id=j.workspace_id AND w.status='active' WHERE j.status='queued' AND j.available_at<=? AND j.attempt_count<j.max_attempts AND NOT EXISTS (SELECT 1 FROM content_job_dependencies edge LEFT JOIN content_jobs dependency ON dependency.idempotency_key=edge.dependency_key AND dependency.workspace_id=j.workspace_id AND dependency.revision=j.revision AND dependency.status='ready' WHERE edge.job_id=j.id AND dependency.id IS NULL) ORDER BY j.priority DESC,j.available_at,j.created_at,j.id LIMIT 1`).get(input.now) as { id: string } | undefined
      if (!row) return null
      const token = randomUUID()
      const changed = this.database.sqlite.prepare("UPDATE content_jobs SET status='generating',lease_owner=?,lease_token=?,lease_expires_at=?,claimed_cancellation_generation=(SELECT cancellation_generation FROM workspace_content_revisions WHERE workspace_id=content_jobs.workspace_id),attempt_count=attempt_count+1,started_at=COALESCE(started_at,?),updated_at=? WHERE id=? AND status='queued'").run(input.owner, token, input.now + (input.leaseMs ?? CONTENT_JOB_DEFAULTS.leaseMs), input.now, input.now, row.id).changes
      return changed === 1 ? this.getJob(row.id) : null
    })
  }

  renewLease(input: { jobId: string; leaseToken: string; now: number; leaseMs?: number }): boolean {
    return this.database.sqlite.prepare("UPDATE content_jobs SET lease_expires_at=?,updated_at=? WHERE id=? AND status='generating' AND lease_token=? AND lease_expires_at>?").run(input.now + (input.leaseMs ?? CONTENT_JOB_DEFAULTS.leaseMs), input.now, input.jobId, input.leaseToken, input.now).changes === 1
  }

  releaseLease(input: { jobId: string; leaseToken: string; now: number; errorCode?: string; errorMessage?: string }): boolean {
    return this.database.sqlite.prepare("UPDATE content_jobs SET status='queued',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,claimed_cancellation_generation=NULL,available_at=?,updated_at=?,last_error_code=?,last_error_message=? WHERE id=? AND status='generating' AND lease_token=?").run(input.now, input.now, input.errorCode ?? null, safeErrorMessage(input.errorMessage), input.jobId, input.leaseToken).changes === 1
  }

  failLease(input: { jobId: string; leaseToken: string; now: number; retryAt?: number; errorCode: string; errorMessage?: string }): boolean {
    return this.immediate(() => {
      const job = this.getJob(input.jobId)
      if (!job || job.status !== 'generating' || job.leaseToken !== input.leaseToken) return false
      const terminal = job.attemptCount >= job.maxAttempts
      const status = terminal ? 'failed' : 'queued'
      const exponent = Math.max(0, job.attemptCount - 1)
      const retryAt = input.retryAt ?? input.now + Math.min(CONTENT_JOB_DEFAULTS.retryBaseMs * 2 ** exponent, CONTENT_JOB_DEFAULTS.retryCapMs)
      this.database.sqlite.prepare('UPDATE content_jobs SET status=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,claimed_cancellation_generation=NULL,available_at=?,completed_at=?,updated_at=?,last_error_code=?,last_error_message=? WHERE id=? AND status=\'generating\' AND lease_token=?').run(status, retryAt, terminal ? input.now : null, input.now, input.errorCode, safeErrorMessage(input.errorMessage), input.jobId, input.leaseToken)
      return true
    })
  }

  publishLease<T>(input: { jobId: string; leaseToken: string; now: number; publish: () => T }): T | null {
    return this.immediate(() => {
      const job = this.getJob(input.jobId)
      if (!job || job.status !== 'generating' || job.leaseToken !== input.leaseToken) return null
      const valid = this.database.sqlite.prepare(`SELECT 1 FROM content_jobs j JOIN workspace_content_revisions r ON r.workspace_id=j.workspace_id AND r.revision=j.revision AND r.input_hash=j.input_hash AND r.cancellation_generation=j.claimed_cancellation_generation JOIN workspaces w ON w.id=j.workspace_id AND w.status='active' WHERE j.id=? AND j.status='generating' AND j.lease_token=? AND j.lease_expires_at>? AND NOT EXISTS (SELECT 1 FROM content_job_dependencies edge LEFT JOIN content_jobs dependency ON dependency.idempotency_key=edge.dependency_key AND dependency.workspace_id=j.workspace_id AND dependency.revision=j.revision AND dependency.status='ready' WHERE edge.job_id=j.id AND dependency.id IS NULL)`).get(input.jobId, input.leaseToken, input.now)
      if (!valid) {
        this.obsoleteLease(input.jobId, input.leaseToken, input.now, 'STALE_WRITE_REJECTED')
        return null
      }
      const result = input.publish()
      const changed = this.database.sqlite.prepare("UPDATE content_jobs SET status='ready',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,claimed_cancellation_generation=NULL,completed_at=?,updated_at=?,last_error_code=NULL,last_error_message=NULL WHERE id=? AND status='generating' AND lease_token=?").run(input.now, input.now, input.jobId, input.leaseToken).changes
      if (changed !== 1) throw new Error('Content job publication lost its lease')
      this.promoteEligible(job.workspaceId, job.revision, input.now)
      return result
    })
  }

  invalidateWorkspace(workspaceId: string, inputHash: string, now: number): WorkspaceContentRevision {
    return this.createRevision({ workspaceId, inputHash, now })
  }

  reconcile(now: number): { requeued: number; obsoleted: number } {
    return this.immediate(() => this.reconcileWithinTransaction(now))
  }

  evaluateReadiness(input: { workspaceId: string; expectedRevision: number; todayDateKey: string; now: number }): WorkspaceContentRevision {
    return this.immediate(() => {
      const revision = this.requireCurrent(input.workspaceId, input.expectedRevision)
      const roadmap = this.database.sqlite.prepare("SELECT r.id,r.generation_kind AS generationKind,r.content_revision AS contentRevision FROM roadmaps r JOIN workspaces w ON w.id=r.workspace_id AND w.status='active' WHERE r.workspace_id=? AND r.status='accepted' AND r.generation_kind='ai_generated' AND r.content_revision=? ORDER BY r.version DESC LIMIT 1").get(input.workspaceId, input.expectedRevision) as { id: string; generationKind: string; contentRevision: number } | undefined
      const first = roadmap ? this.firstRoadmapTopic(roadmap.id) : null
      const lesson = first ? this.database.sqlite.prepare("SELECT id,content_json AS contentJson FROM study_lessons WHERE workspace_id=? AND roadmap_id=? AND module_id=? AND topic_id=? AND generation_kind='ai_generated' AND content_revision=? ORDER BY updated_at DESC LIMIT 1").get(input.workspaceId, roadmap!.id, first.moduleId, first.topicId, input.expectedRevision) as { id: string; contentJson: string } | undefined : undefined
      const lessonValid = lesson ? this.validActionableLesson(lesson.contentJson) : false
      const exerciseValid = lesson && first ? this.validExerciseSet(input.workspaceId, roadmap!.id, first.moduleId, first.topicId, lesson.id, input.expectedRevision) : false
      const planValid = first ? Boolean(this.database.sqlite.prepare("SELECT 1 FROM weekly_plan_items WHERE workspace_id=? AND date_key=? AND topic_id=? AND status<>'completed' LIMIT 1").get(input.workspaceId, input.todayDateKey, first.topicId) ?? this.database.sqlite.prepare("SELECT 1 FROM study_plan_items WHERE workspace_id=? AND topic_id=? AND status<>'completed' LIMIT 1").get(input.workspaceId, first.topicId)) : false
      const readinessJobs = first ? this.database.sqlite.prepare("SELECT kind,unit_key AS unitKey FROM content_jobs WHERE workspace_id=? AND revision=? AND input_hash=? AND status='ready' AND ((kind='roadmap_generate' AND unit_key='roadmap') OR (kind IN ('lesson_generate','exercise_generate') AND unit_key=?))").all(input.workspaceId, input.expectedRevision, revision.inputHash, first.topicId) as Array<{ kind: string; unitKey: string }> : []
      const readyKinds = new Set(readinessJobs.map((job) => job.kind))
      const nextQueued = first ? Boolean(this.database.sqlite.prepare("SELECT 1 FROM roadmap_modules m,json_each(m.topics_json) topic JOIN content_jobs j ON j.workspace_id=? AND j.revision=? AND j.kind='lesson_generate' AND j.unit_key=(m.id || ':' || topic.value) AND j.status IN ('pending','queued','generating','ready') WHERE m.roadmap_id=? AND (m.position>(SELECT position FROM roadmap_modules WHERE id=?) OR (m.id=? AND CAST(topic.key AS integer)>0)) LIMIT 1").get(input.workspaceId, input.expectedRevision, roadmap!.id, first.moduleId, first.moduleId) ?? this.database.sqlite.prepare("SELECT 1 WHERE (SELECT SUM(json_array_length(topics_json)) FROM roadmap_modules WHERE roadmap_id=?)=1").get(roadmap!.id)) : false
      const usable = Boolean(roadmap && first && lesson && lessonValid && exerciseValid && planValid && nextQueued && readyKinds.has('roadmap_generate') && readyKinds.has('lesson_generate') && readyKinds.has('exercise_generate'))
      const required = this.listRequiredUnits(input.workspaceId, input.expectedRevision)
      const allRequiredReady = required.length > 0 && required.every((unit) => Boolean(this.database.sqlite.prepare("SELECT 1 FROM content_jobs WHERE workspace_id=? AND revision=? AND kind=? AND unit_key=? AND input_hash=? AND status='ready'").get(unit.workspaceId, unit.revision, unit.kind, unit.unitKey, unit.inputHash)))
      const state = usable && allRequiredReady ? 'fully_provisioned' : usable ? 'usable' : 'provisioning'
      this.database.sqlite.prepare('UPDATE workspace_content_revisions SET roadmap_id=?,first_topic_id=?,first_lesson_id=?,state=?,usable_at=CASE WHEN ?<>\'provisioning\' THEN COALESCE(usable_at,?) ELSE NULL END,fully_provisioned_at=CASE WHEN ?=\'fully_provisioned\' THEN COALESCE(fully_provisioned_at,?) ELSE NULL END,updated_at=? WHERE workspace_id=? AND revision=?').run(usable ? roadmap!.id : null, usable ? first!.topicId : null, usable ? lesson!.id : null, state, state, input.now, state, input.now, input.now, input.workspaceId, input.expectedRevision)
      return this.getRevision(input.workspaceId) ?? revision
    })
  }

  private findUnit(workspaceId: string, revision: number, kind: string, unitKey: string): ContentJob | null {
    const row = this.database.sqlite.prepare(`SELECT ${jobColumns} FROM content_jobs WHERE workspace_id=? AND revision=? AND kind=? AND unit_key=?`).get(workspaceId, revision, kind, unitKey) as JobRow | undefined
    return row ? mapJob(row) : null
  }

  private requireCurrent(workspaceId: string, revision: number, inputHash?: string): WorkspaceContentRevision {
    const current = this.getRevision(workspaceId)
    if (!current || current.revision !== revision || (inputHash !== undefined && current.inputHash !== inputHash)) throw new Error('Workspace content revision mismatch')
    return current
  }

  private promoteEligible(workspaceId: string, revision: number, now: number): void {
    this.database.sqlite.prepare(`UPDATE content_jobs AS j SET status='queued',updated_at=? WHERE workspace_id=? AND revision=? AND status='pending' AND NOT EXISTS (SELECT 1 FROM content_job_dependencies edge LEFT JOIN content_jobs dependency ON dependency.idempotency_key=edge.dependency_key AND dependency.workspace_id=j.workspace_id AND dependency.revision=j.revision AND dependency.status='ready' WHERE edge.job_id=j.id AND dependency.id IS NULL)`).run(now, workspaceId, revision)
  }

  private reconcileWithinTransaction(now: number): { requeued: number; obsoleted: number } {
    const obsoleted = this.database.sqlite.prepare("UPDATE content_jobs SET status='obsolete',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,claimed_cancellation_generation=NULL,obsolete_at=?,updated_at=?,last_error_code='REVISION_OR_WORKSPACE_STALE' WHERE status<>'obsolete' AND (NOT EXISTS (SELECT 1 FROM workspace_content_revisions r WHERE r.workspace_id=content_jobs.workspace_id AND r.revision=content_jobs.revision AND r.input_hash=content_jobs.input_hash) OR NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.id=content_jobs.workspace_id AND w.status='active'))").run(now, now).changes
    const requeued = this.database.sqlite.prepare("UPDATE content_jobs SET status='queued',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,claimed_cancellation_generation=NULL,available_at=?,updated_at=?,last_error_code='LEASE_EXPIRED' WHERE status='generating' AND lease_expires_at<=? AND EXISTS (SELECT 1 FROM workspace_content_revisions r JOIN workspaces w ON w.id=r.workspace_id AND w.status='active' WHERE r.workspace_id=content_jobs.workspace_id AND r.revision=content_jobs.revision AND r.input_hash=content_jobs.input_hash)").run(now, now, now).changes
    return { requeued, obsoleted }
  }

  private obsoleteLease(jobId: string, token: string, now: number, code: string): void {
    this.database.sqlite.prepare("UPDATE content_jobs SET status='obsolete',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,claimed_cancellation_generation=NULL,obsolete_at=?,updated_at=?,last_error_code=? WHERE id=? AND status='generating' AND lease_token=?").run(now, now, code, jobId, token)
  }

  private firstRoadmapTopic(roadmapId: string): { moduleId: string; topicId: string; topicName: string } | null {
    const row = this.database.sqlite.prepare("SELECT id,topics_json AS topicsJson FROM roadmap_modules WHERE roadmap_id=? AND status IN ('active','available') ORDER BY position LIMIT 1").get(roadmapId) as { id: string; topicsJson: string } | undefined
    if (!row) return null
    try {
      const topic = (JSON.parse(row.topicsJson) as unknown[])[0]
      return typeof topic === 'string' && topic.trim() ? { moduleId: row.id, topicId: `${row.id}:${topic}`, topicName: topic } : null
    } catch { return null }
  }

  private validActionableLesson(contentJson: string): boolean {
    try {
      const lesson = studyLessonContentSchema.parse(JSON.parse(contentJson))
      return lesson.blocks.some((block) => block.type === 'checkpoint' || block.type === 'miniExercise' || (block.type === 'interactiveCode' && block.requiredForTopicCompletion))
    } catch { return false }
  }

  private validExerciseSet(workspaceId: string, roadmapId: string, moduleId: string, topicId: string, lessonId: string, revision: number): boolean {
    const set = this.database.sqlite.prepare("SELECT id FROM exercise_sets WHERE workspace_id=? AND roadmap_id=? AND module_id=? AND topic_id=? AND lesson_id=? AND content_revision=? AND status='ready'").get(workspaceId, roadmapId, moduleId, topicId, lessonId, revision) as { id: string } | undefined
    if (!set) return false
    const rows = this.database.sqlite.prepare('SELECT id,set_id AS setId,position,kind,difficulty,title,statement,input_description AS inputDescription,output_description AS outputDescription,language,starter_code AS starterCode,prediction_prompt AS predictionPrompt,code_to_observe AS codeToObserve,required_for_topic_completion AS requiredForTopicCompletion,public_tests_json AS publicTestsJson,private_tests_json AS privateTestsJson,reference_solution AS referenceSolution,expected_prediction AS expectedPrediction,hint FROM exercises WHERE set_id=? ORDER BY position').all(set.id) as RawExercise[]
    return rows.length > 0 && rows.every(validExerciseData)
  }

  private immediate<T>(operation: () => T): T {
    return this.database.sqlite.transaction(operation).immediate()
  }
}
