import { createHash } from 'node:crypto'
import { CONTENT_GENERATOR_VERSIONS, contentJobKey, type WorkspaceContentRepository } from '../../application/workspaces/workspace-content-repository'
import type { ContentJob } from '../../shared/contracts/workspace-content-contract'
import type { CoachDatabase } from '../database/connection'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

export class InitialProvisioningCoordinator {
  constructor(private readonly database: CoachDatabase, private readonly repository: WorkspaceContentRepository, private readonly wake: () => void, private readonly now = Date.now) {}

  initialize(workspaceId: string): void {
    const now = this.now()
    const existing = this.repository.getRevision(workspaceId)
    if (existing && existing.inputHash !== 'legacy-unavailable') { this.advance(workspaceId); return }
    const workspace = this.database.sqlite.prepare('SELECT name,objective FROM workspaces WHERE id=?').get(workspaceId) as { name: string; objective: string }
    const override = this.database.sqlite.prepare('SELECT canonical_focus AS focus,canonical_context AS context,declared_level AS level,declared_knowledge_json AS knowledge,declared_difficulties_json AS difficulties,goals_json AS goals,onboarding_analysis_revision AS analysisRevision,onboarding_analysis_fingerprint AS analysisFingerprint FROM workspace_learning_overrides WHERE workspace_id=?').get(workspaceId) as Record<string, unknown>
    const materials = this.database.sqlite.prepare("SELECT id,content_hash AS contentHash,analysis_fingerprint AS analysisFingerprint,role,relevance,semantic_analysis_json AS analysis FROM materials WHERE workspace_id=? AND status='ready' ORDER BY CASE role WHEN 'priority' THEN 0 WHEN 'base' THEN 1 ELSE 2 END,created_at,id").all(workspaceId)
    const inputHash = createHash('sha256').update(canonical({ workspace, override, materials })).digest('hex')
    const revision = this.repository.createRevision({ workspaceId, inputHash, now })
    this.enqueue(workspaceId, revision.revision, inputHash, 'roadmap_generate', 'roadmap', 900, [])
    this.stage(workspaceId, 'roadmap')
    this.wake()
  }

  advance(workspaceId: string): void {
    const revision = this.repository.getRevision(workspaceId)
    if (!revision || revision.inputHash === 'legacy-unavailable') return
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
    const next = topics[1]
    if (next) this.enqueue(workspaceId, revision.revision, revision.inputHash, 'lesson_generate', next, 700, [roadmapKey])
    const units = [
      { kind: 'roadmap_generate' as const, unitKey: 'roadmap', inputHash: revision.inputHash },
      ...topics.map((unitKey) => ({ kind: 'lesson_generate' as const, unitKey, inputHash: revision.inputHash })),
      { kind: 'exercise_generate' as const, unitKey: first, inputHash: revision.inputHash },
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
    const timezone = (this.database.sqlite.prepare('SELECT timezone FROM weekly_plans ORDER BY generated_at,rowid LIMIT 1').get() as { timezone: string } | undefined)?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(this.now())
    const state = this.repository.evaluateReadiness({ workspaceId, expectedRevision: revision.revision, todayDateKey: today, now: this.now() })
    if (state.state === 'PROVISIONING') return
    const pending = this.database.sqlite.prepare("SELECT COUNT(*) AS count FROM content_jobs WHERE workspace_id=? AND revision=? AND status IN ('pending','queued','generating')").get(workspaceId, revision.revision) as { count: number }
    this.database.sqlite.prepare("UPDATE workspace_provisioning SET status='ready',stage=?,completed_at=COALESCE(completed_at,?),stage_updated_at=?,retry_after=NULL,error_code=NULL,error_message=NULL WHERE workspace_id=?").run(state.state === 'FULLY_PROVISIONED' ? 'ready' : pending.count ? 'background' : 'ready', this.now(), this.now(), workspaceId)
  }

  onPublished(job: ContentJob): void { this.advance(job.workspaceId) }
  private stage(workspaceId: string, stage: string): void { this.database.sqlite.prepare("UPDATE workspace_provisioning SET status='running',stage=?,stage_updated_at=?,retry_after=NULL,error_code=NULL,error_message=NULL WHERE workspace_id=? AND status<>'draft'").run(stage, this.now(), workspaceId) }
  private jobReady(workspaceId: string, revision: number, kind: string, unitKey: string): boolean { return Boolean(this.database.sqlite.prepare("SELECT 1 FROM content_jobs WHERE workspace_id=? AND revision=? AND kind=? AND unit_key=? AND status='ready'").get(workspaceId, revision, kind, unitKey)) }
  private key(workspaceId: string, revision: number, inputHash: string, kind: keyof typeof CONTENT_GENERATOR_VERSIONS, unitKey: string): string { return contentJobKey({ workspaceId, revision, inputHash, kind, unitKey, generatorContractVersion: CONTENT_GENERATOR_VERSIONS[kind] }) }
  private enqueue(workspaceId: string, revision: number, inputHash: string, kind: keyof typeof CONTENT_GENERATOR_VERSIONS, unitKey: string, priority: number, dependencyKeys: string[]): void { this.repository.enqueue({ workspaceId, revision, kind, unitKey, priority, inputHash, generatorContractVersion: CONTENT_GENERATOR_VERSIONS[kind], dependencyKeys }, this.now()) }
}
