import { CONTENT_GENERATOR_VERSIONS, contentJobKey, type WorkspaceContentRepository } from '../../application/workspaces/workspace-content-repository'
import { contentRevisionFingerprint, effectiveContentRevisionFingerprint, NO_CONTENT_MUTATION } from '../../application/workspaces/content-revision-fingerprint'
import type { Roadmap } from '../../shared/contracts/roadmap-contract'
import type { ContentJob } from '../../shared/contracts/workspace-content-contract'
import type { CoachDatabase } from '../database/connection'
import type { PerformanceTimelineStore } from '../telemetry/performance-timeline'

export class InitialProvisioningCoordinator {
  private startupQueue: string[] = []
  private startupTimer: ReturnType<typeof setTimeout> | null = null
  constructor(private readonly database: CoachDatabase, private readonly repository: WorkspaceContentRepository, private readonly wake: () => void, private readonly now = Date.now, private readonly timelines?: PerformanceTimelineStore) {}

  initialize(workspaceId: string): void {
    const now = this.now()
    const provisioning = this.database.sqlite.prepare('SELECT status FROM workspace_provisioning WHERE workspace_id=?').get(workspaceId) as { status: string } | undefined
    if (provisioning?.status === 'draft') return
    this.ensureProjection(workspaceId, now)
    const existing = this.repository.getRevision(workspaceId)
    if (existing?.inputHash === 'legacy-unavailable') {
      const accepted = this.database.sqlite.prepare("SELECT id FROM roadmaps WHERE workspace_id=? AND status='accepted' ORDER BY version DESC LIMIT 1").get(workspaceId) as { id: string } | undefined
      if (accepted) {
        this.repository.adoptRoadmapRevision({ workspaceId, roadmapId: accepted.id, inputHash: 'legacy-unavailable', now })
        this.resumeApprovedRoadmap(workspaceId)
        this.wake()
      }
      return
    }
    const { inputHash } = this.authoritativeInput(workspaceId)
    if (existing && existing.inputHash === inputHash) { this.advance(workspaceId); return }
    const accepted = this.database.sqlite.prepare("SELECT id FROM roadmaps WHERE workspace_id=? AND status='accepted' ORDER BY version DESC LIMIT 1").get(workspaceId) as { id: string } | undefined
    if (accepted && !existing) {
      this.repository.adoptRoadmapRevision({ workspaceId, roadmapId: accepted.id, inputHash, now })
      this.advance(workspaceId)
      this.wake()
      return
    }
    const revision = this.repository.ensureRevision({ workspaceId, inputHash, now })
    this.enqueue(workspaceId, revision.revision, inputHash, 'roadmap_generate', 'roadmap', 900, [])
    this.timelines?.markProvisioning(workspaceId, 'roadmap', { outcome: 'queued' })
    this.stage(workspaceId, 'roadmap')
    this.wake()
  }

  adoptApprovedRoadmap(roadmap: Roadmap): void {
    const now = this.now()
    const { inputHash } = this.authoritativeInput(roadmap.workspaceId)
    this.repository.adoptRoadmapRevision({ workspaceId: roadmap.workspaceId, roadmapId: roadmap.id, inputHash, now })
  }

  resumeApprovedRoadmap(workspaceId: string): void {
    this.advance(workspaceId)
    this.wake()
  }

  adoptAndResumeApprovedRoadmap(roadmap: Roadmap): void {
    this.adoptApprovedRoadmap(roadmap)
    this.advance(roadmap.workspaceId)
    this.wake()
  }

  private authoritativeInput(workspaceId: string): { baseInputHash: string; inputHash: string } {
    const workspace = this.database.sqlite.prepare('SELECT name,objective FROM workspaces WHERE id=?').get(workspaceId) as { name: string; objective: string } | undefined
    if (!workspace) throw new Error('Workspace not found')
    const override = this.database.sqlite.prepare('SELECT canonical_focus AS focus,canonical_context AS context,declared_level AS level,declared_knowledge_json AS knowledge,declared_difficulties_json AS difficulties,goals_json AS goals,onboarding_analysis_revision AS analysisRevision,onboarding_analysis_fingerprint AS analysisFingerprint FROM workspace_learning_overrides WHERE workspace_id=?').get(workspaceId) as Record<string, unknown> | undefined ?? {}
    this.timelines?.markProvisioning(workspaceId, 'analyze', { outcome: override.analysisFingerprint ? 'validated' : 'unavailable' })
    const materials = this.database.sqlite.prepare("SELECT id,content_hash AS contentHash,analysis_fingerprint AS analysisFingerprint,role,relevance,semantic_analysis_json AS analysis FROM materials WHERE workspace_id=? AND status='ready' ORDER BY CASE role WHEN 'priority' THEN 0 WHEN 'base' THEN 1 ELSE 2 END,created_at,id").all(workspaceId)
    this.timelines?.markProvisioning(workspaceId, 'context')
    this.timelines?.markProvisioning(workspaceId, 'material_analysis', { cache: materials.length && materials.every((item: any) => Boolean(item.analysisFingerprint)) ? 'hit' : 'unavailable' })
    const baseInputHash = contentRevisionFingerprint({ workspace, override, materials })
    const mutation = this.database.sqlite.prepare('SELECT mutation_fingerprint AS mutationFingerprint FROM workspace_content_authority WHERE workspace_id=?').get(workspaceId) as { mutationFingerprint: string } | undefined
    return { baseInputHash, inputHash: effectiveContentRevisionFingerprint(baseInputHash, mutation?.mutationFingerprint ?? NO_CONTENT_MUTATION) }
  }

  advance(workspaceId: string): void {
    const revision = this.repository.getRevision(workspaceId)
    if (!revision) return
    const roadmap = this.database.sqlite.prepare("SELECT id FROM roadmaps WHERE workspace_id=? AND status='accepted' AND content_revision=? ORDER BY version DESC LIMIT 1").get(workspaceId, revision.revision) as { id: string } | undefined
    if (!roadmap) { this.stage(workspaceId, 'roadmap'); return }
    const topics = (this.database.sqlite.prepare('SELECT id,topics_json AS topics FROM roadmap_modules WHERE roadmap_id=? ORDER BY position').all(roadmap.id) as Array<{ id: string; topics: string }>).flatMap((module) => (JSON.parse(module.topics) as string[]).map((topic) => `${module.id}:${topic}`))
    if (!topics.length) throw new Error('Persisted roadmap has no actionable topic')
    const first = topics[0]!
    const roadmapKey = this.key(workspaceId, revision.revision, revision.inputHash, 'roadmap_generate', 'roadmap')
    if (!this.jobReady(workspaceId, revision.revision, 'roadmap_generate', 'roadmap')) { this.stage(workspaceId, 'roadmap'); return }
    this.enqueue(workspaceId, revision.revision, revision.inputHash, 'lesson_generate', first, 900, [roadmapKey])
    const lessonKey = this.key(workspaceId, revision.revision, revision.inputHash, 'lesson_generate', first)
    this.enqueue(workspaceId, revision.revision, revision.inputHash, 'exercise_generate', first, 900, [lessonKey])
    const exerciseKey = this.key(workspaceId, revision.revision, revision.inputHash, 'exercise_generate', first)
    this.enqueue(workspaceId, revision.revision, revision.inputHash, 'plan_recalculate', 'current-week', 850, [exerciseKey])
    const progress = this.database.sqlite.prepare('SELECT current_topic_id AS topicId FROM study_progress WHERE workspace_id=? AND roadmap_id=?').get(workspaceId, roadmap.id) as { topicId: string } | undefined
    const foundIndex = progress ? topics.indexOf(progress.topicId) : -1
    const currentIndex = foundIndex >= 0 ? foundIndex : 0
    const current = topics[currentIndex] ?? first
    const next = topics[currentIndex + 1]
    const currentLessonKey = this.key(workspaceId, revision.revision, revision.inputHash, 'lesson_generate', current)
    this.enqueue(workspaceId, revision.revision, revision.inputHash, 'lesson_generate', current, 700, [roadmapKey])
    this.enqueue(workspaceId, revision.revision, revision.inputHash, 'exercise_generate', current, 700, [currentLessonKey])
    if (next) {
      const nextLessonKey = this.key(workspaceId, revision.revision, revision.inputHash, 'lesson_generate', next)
      this.enqueue(workspaceId, revision.revision, revision.inputHash, 'lesson_generate', next, 500, [roadmapKey])
      this.enqueue(workspaceId, revision.revision, revision.inputHash, 'exercise_generate', next, 500, [nextLessonKey])
    }
    const units = [
      { kind: 'roadmap_generate' as const, unitKey: 'roadmap', inputHash: revision.inputHash },
      ...topics.flatMap((unitKey) => [
        { kind: 'lesson_generate' as const, unitKey, inputHash: revision.inputHash },
        { kind: 'exercise_generate' as const, unitKey, inputHash: revision.inputHash },
      ]),
      { kind: 'plan_recalculate' as const, unitKey: 'current-week', inputHash: revision.inputHash },
    ]
    const existingUnits = this.repository.listRequiredUnits(workspaceId, revision.revision)
    const sameManifest = existingUnits.length === units.length && units.every((unit) => existingUnits.some((existing) => existing.kind === unit.kind && existing.unitKey === unit.unitKey && existing.inputHash === unit.inputHash))
    if (!sameManifest) this.repository.replaceRequiredUnits(workspaceId, revision.revision, units, this.now())
    this.stage(workspaceId, this.jobReady(workspaceId, revision.revision, 'lesson_generate', first) ? this.jobReady(workspaceId, revision.revision, 'exercise_generate', first) ? 'plan' : 'exercises' : 'lesson')
    this.reconcileReadiness(workspaceId)
    const usable = this.repository.getRevision(workspaceId)?.state !== 'PROVISIONING'
    if (usable) for (const topic of topics.slice(2)) this.enqueue(workspaceId, revision.revision, revision.inputHash, 'lesson_generate', topic, 300, [roadmapKey])
    this.wake()
  }

  reconcileReadiness(workspaceId: string): void {
    const revision = this.repository.getRevision(workspaceId)
    if (!revision || revision.inputHash === 'legacy-unavailable') return
    const timezone = (this.database.sqlite.prepare("SELECT timezone FROM planning_settings WHERE id='current'").get() as { timezone: string } | undefined)?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(this.now())
    const state = this.repository.evaluateReadiness({ workspaceId, expectedRevision: revision.revision, todayDateKey: today, now: this.now() })
    if (state.state === 'PROVISIONING') return
    const pending = this.database.sqlite.prepare("SELECT COUNT(*) AS count FROM content_jobs WHERE workspace_id=? AND revision=? AND status IN ('pending','queued','generating')").get(workspaceId, revision.revision) as { count: number }
    this.database.sqlite.prepare("UPDATE workspace_provisioning SET status='ready',stage=?,completed_at=COALESCE(completed_at,?),stage_updated_at=?,retry_after=NULL,error_code=NULL,error_message=NULL WHERE workspace_id=?").run(state.state === 'FULLY_PROVISIONED' ? 'ready' : pending.count ? 'background' : 'ready', this.now(), this.now(), workspaceId)
    this.timelines?.markProvisioning(workspaceId, 'persistence', { outcome: state.state === 'FULLY_PROVISIONED' ? 'fully_provisioned' : 'usable' })
  }

  onPublished(job: ContentJob): void {
    const stage = job.kind === 'roadmap_generate' ? 'roadmap' : job.kind === 'lesson_generate' ? 'lesson' : job.kind === 'exercise_generate' ? 'exercises' : job.kind === 'plan_recalculate' ? 'planning' : null
    if (stage) this.timelines?.markProvisioning(job.workspaceId, stage, { jobKind: job.kind, outcome: 'published' })
    this.advance(job.workspaceId)
  }
  reconcileWorkspace(workspaceId: string): void { this.initialize(workspaceId) }
  reconcileAll(): void {
    const rows = this.database.sqlite.prepare("SELECT w.id FROM workspaces w JOIN workspace_provisioning p ON p.workspace_id=w.id WHERE w.status='active' AND p.status<>'draft' ORDER BY COALESCE(w.last_opened_at,w.updated_at) DESC").all() as Array<{ id: string }>
    this.startupQueue = rows.map((row) => row.id)
    this.reconcileStartupBatch()
  }
  private reconcileStartupBatch(): void {
    this.startupTimer = null
    const batch = this.startupQueue.splice(0, 5)
    for (const workspaceId of batch) { try { this.initialize(workspaceId) } catch (error) { console.error(`Workspace content reconciliation failed for ${workspaceId}:`, error) } }
    if (this.startupQueue.length) this.startupTimer = setTimeout(() => this.reconcileStartupBatch(), 25)
  }
  onJobSettled(job: ContentJob): void { this.syncFailure(job.workspaceId) }
  private syncFailure(workspaceId: string): void {
    const revision = this.repository.getRevision(workspaceId)
    if (!revision) return
    const failed = this.database.sqlite.prepare("SELECT status,last_error_code AS code,available_at AS retryAfter FROM content_jobs WHERE workspace_id=? AND revision=? AND status IN ('failed','queued') AND last_error_code IS NOT NULL ORDER BY CASE status WHEN 'failed' THEN 0 ELSE 1 END,priority DESC LIMIT 1").get(workspaceId, revision.revision) as { status: string; code: string; retryAfter: number } | undefined
    if (!failed) return
    const terminal = failed.status === 'failed'
    const message = terminal ? 'A preparação falhou definitivamente. O conteúdo já pronto permanece disponível.' : failed.code === 'PROVIDER_UNAVAILABLE' ? 'Aguardando o provedor de IA ficar disponível.' : 'Falha temporária. O Coach tentará novamente automaticamente.'
    this.database.sqlite.prepare("UPDATE workspace_provisioning SET status='failed_retryable',stage_updated_at=?,retry_after=?,error_code=?,error_message=? WHERE workspace_id=? AND status<>'draft'").run(this.now(), terminal ? null : failed.retryAfter, terminal ? `TERMINAL_${failed.code}` : failed.code, message, workspaceId)
  }
  private ensureProjection(workspaceId: string, now: number): void {
    this.database.sqlite.prepare("INSERT OR IGNORE INTO workspace_provisioning (workspace_id,status,stage,material_ids_json,attempt_count,created_at,started_at,stage_updated_at) VALUES (?,'queued','workspace','[]',0,?,?,?)").run(workspaceId, now, now, now)
  }
  private stage(workspaceId: string, stage: string): void { this.database.sqlite.prepare("UPDATE workspace_provisioning SET status='running',stage=?,stage_updated_at=?,retry_after=NULL,error_code=NULL,error_message=NULL WHERE workspace_id=? AND status<>'draft'").run(stage, this.now(), workspaceId) }
  private jobReady(workspaceId: string, revision: number, kind: string, unitKey: string): boolean { return Boolean(this.database.sqlite.prepare("SELECT 1 FROM content_jobs WHERE workspace_id=? AND revision=? AND kind=? AND unit_key=? AND status='ready'").get(workspaceId, revision, kind, unitKey)) }
  private key(workspaceId: string, revision: number, inputHash: string, kind: keyof typeof CONTENT_GENERATOR_VERSIONS, unitKey: string): string { return contentJobKey({ workspaceId, revision, inputHash, kind, unitKey, generatorContractVersion: CONTENT_GENERATOR_VERSIONS[kind] }) }
  private enqueue(workspaceId: string, revision: number, inputHash: string, kind: keyof typeof CONTENT_GENERATOR_VERSIONS, unitKey: string, priority: number, dependencyKeys: string[]): void { this.repository.enqueue({ workspaceId, revision, kind, unitKey, priority, inputHash, generatorContractVersion: CONTENT_GENERATOR_VERSIONS[kind], dependencyKeys }, this.now()) }
}
