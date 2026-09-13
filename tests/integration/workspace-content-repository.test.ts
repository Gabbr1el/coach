import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { openCoachDatabase, type CoachDatabase } from '../../src/main/database/connection'
import { SqliteWorkspaceContentRepository } from '../../src/main/repositories/sqlite-workspace-content-repository'
import { InitialProvisioningCoordinator } from '../../src/main/content/initial-provisioning-coordinator'
import { ContentGenerationWorker, type ContentJobHandler } from '../../src/application/workspaces/content-generation-worker'
import { HeavyGenerationQueue } from '../../src/application/ai/heavy-generation-queue'
import { PerformanceTimelineStore } from '../../src/main/telemetry/performance-timeline'
import { DrizzleRoadmapRepository } from '../../src/main/repositories/drizzle-roadmap-repository'
import { roadmapRebuildPreviewSchema, roadmapSchema } from '../../src/shared/contracts/roadmap-contract'
import { RoadmapService } from '../../src/application/roadmaps/roadmap-service'
import { AIProviderManager } from '../../src/application/ai/ai-provider-manager'

const directories: string[] = []
const migrationsFolder = resolve('drizzle/migrations')
const hash = (character: string) => character.repeat(64)

afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function database(): CoachDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'coach-content-jobs-'))
  directories.push(directory)
  return openCoachDatabase({ databasePath: join(directory, 'coach.sqlite'), migrationsFolder })
}

function workspace(db: CoachDatabase, id = '00000000-0000-4000-8000-000000000001') {
  db.sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES (?,'C','Ponteiros','active',1,1)").run(id)
  return id
}

function migrationsThrough0044(): string {
  const directory = mkdtempSync(join(tmpdir(), 'coach-migrations-0044-'))
  directories.push(directory)
  cpSync(migrationsFolder, directory, { recursive: true })
  const journalPath = join(directory, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: Array<{ idx: number }> }
  journal.entries = journal.entries.filter((entry) => entry.idx <= 44)
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`)
  rmSync(join(directory, '0045_progressive_content_jobs.sql'))
  return directory
}

function migrationsThrough0045(): string {
  const directory = mkdtempSync(join(tmpdir(), 'coach-migrations-0045-'))
  directories.push(directory)
  cpSync(migrationsFolder, directory, { recursive: true })
  const journalPath = join(directory, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: Array<{ idx: number; tag: string }> }
  const removed = journal.entries.filter((entry) => entry.idx > 45)
  journal.entries = journal.entries.filter((entry) => entry.idx <= 45)
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`)
  for (const entry of removed) rmSync(join(directory, `${entry.tag}.sql`), { force: true })
  return directory
}

describe('SqliteWorkspaceContentRepository', () => {
  it('upgrades a copied 45-migration profile through the current journal without touching the source database', () => {
    const sourceDirectory = mkdtempSync(join(tmpdir(), 'coach-profile-source-')); directories.push(sourceDirectory)
    const sourcePath = join(sourceDirectory, 'coach.sqlite'); const source = openCoachDatabase({ databasePath: sourcePath, migrationsFolder: migrationsThrough0045() }); workspace(source); source.close()
    const before = readFileSync(sourcePath); const copyDirectory = mkdtempSync(join(tmpdir(), 'coach-profile-copy-')); directories.push(copyDirectory); const copyPath = join(copyDirectory, 'coach.sqlite'); cpSync(sourcePath, copyPath)
    const copy = openCoachDatabase({ databasePath: copyPath, migrationsFolder }); const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as { entries: unknown[] }; expect((copy.sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get() as { count: number }).count).toBe(journal.entries.length); expect(copy.sqlite.pragma('integrity_check', { simple: true })).toBe('ok'); copy.close()
    expect(readFileSync(sourcePath)).toEqual(before)
  }, 15_000)

  it('backfills existing workspaces conservatively and survives reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'coach-content-upgrade-')); directories.push(directory)
    const path = join(directory, 'coach.sqlite'); const sqlite = new Database(path); sqlite.pragma('foreign_keys = ON'); migrate(drizzle(sqlite), { migrationsFolder: migrationsThrough0044() }); const id = '00000000-0000-4000-8000-000000000001'; sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES (?,'C','Ponteiros','active',1,1)").run(id); sqlite.close()
    const reopened = openCoachDatabase({ databasePath: path, migrationsFolder })
    expect(new SqliteWorkspaceContentRepository(reopened).getRevision(id)).toMatchObject({ revision: 1, inputHash: 'legacy-unavailable', state: 'PROVISIONING', legacyState: 'legacy_accessible' })
    expect(reopened.sqlite.pragma('quick_check')).toEqual([{ quick_check: 'ok' }])
    expect(reopened.sqlite.pragma('foreign_key_check')).toEqual([])
    reopened.close()
  })

  it('coalesces enqueue, promotes priority, and leases in stable priority order', () => {
    const db = database(); const id = workspace(db); const repository = new SqliteWorkspaceContentRepository(db)
    const revision = repository.createRevision({ workspaceId: id, inputHash: hash('a'), now: 10 })
    const low = repository.enqueue({ workspaceId: id, revision: revision.revision, kind: 'lesson_generate', unitKey: 'low', priority: 200, inputHash: hash('a'), generatorContractVersion: 'lesson-v1' }, 20)
    const high = repository.enqueue({ workspaceId: id, revision: revision.revision, kind: 'roadmap_generate', unitKey: 'high', priority: 900, inputHash: hash('a'), generatorContractVersion: 'roadmap-v1' }, 21)
    const promoted = repository.enqueue({ workspaceId: id, revision: revision.revision, kind: 'lesson_generate', unitKey: 'low', priority: 700, inputHash: hash('a'), generatorContractVersion: 'lesson-v1' }, 22)
    expect(promoted.id).toBe(low.id)
    expect(promoted.priority).toBe(700)
    expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM content_jobs').get()).toEqual({ count: 2 })
    expect(repository.claimNext({ owner: 'worker', now: 30 })?.id).toBe(high.id)
    db.close()
  })

  it('uses CAS leases, requeues only expired generation, and rejects stale publication', () => {
    const db = database(); const id = workspace(db); const repository = new SqliteWorkspaceContentRepository(db)
    const revision = repository.createRevision({ workspaceId: id, inputHash: hash('b'), now: 10 })
    repository.enqueue({ workspaceId: id, revision: revision.revision, kind: 'roadmap_generate', unitKey: 'roadmap', priority: 900, inputHash: hash('b'), generatorContractVersion: 'v1' }, 20)
    const leased = repository.claimNext({ owner: 'one', now: 30, leaseMs: 100 })!
    expect(repository.renewLease({ jobId: leased.id, leaseToken: 'wrong', now: 40 })).toBe(false)
    expect(repository.reconcile(100)).toEqual({ requeued: 0, obsoleted: 0 })
    expect(repository.reconcile(131)).toEqual({ requeued: 1, obsoleted: 0 })
    const reclaimed = repository.claimNext({ owner: 'two', now: 132, leaseMs: 100 })!
    repository.createRevision({ workspaceId: id, inputHash: hash('c'), now: 140 })
    let published = false
    expect(repository.publishLease({ jobId: reclaimed.id, leaseToken: reclaimed.leaseToken!, now: 141, publish: () => { published = true } })).toBeNull()
    expect(published).toBe(false)
    expect(repository.getJob(reclaimed.id)?.status).toBe('obsolete')
    db.close()
  })

  it('requeues restart-expired leases without duplicate publication', () => {
    const db = database(); const id = workspace(db); const repository = new SqliteWorkspaceContentRepository(db); repository.createRevision({ workspaceId: id, inputHash: hash('a'), now: 1 })
    const queued = repository.enqueue({ workspaceId: id, revision: 1, kind: 'lesson_generate', unitKey: 'm:t', priority: 10, inputHash: hash('a'), generatorContractVersion: 'lesson-v1', availableAt: 1 }, 1)
    const leased = repository.claimNext({ owner: 'dead-process', now: 2, leaseMs: 10 })!; expect(leased.id).toBe(queued.id); expect(repository.claimNext({ owner: 'new-process', now: 5, leaseMs: 10 })).toBeNull()
    expect(repository.reconcile(13)).toEqual({ requeued: 1, obsoleted: 0 }); const resumed = repository.claimNext({ owner: 'new-process', now: 13, leaseMs: 10 })!; expect(resumed.id).toBe(queued.id)
    expect(repository.publishLease({ jobId: resumed.id, leaseToken: resumed.leaseToken!, now: 14, publish: () => 'once' })).toBe('once')
    expect(repository.publishLease({ jobId: leased.id, leaseToken: leased.leaseToken!, now: 15, publish: () => 'duplicate' })).toBeNull(); db.close()
  })

  it('requires roadmap, actionable lesson, exercise, plan, and ready jobs before USABLE', () => {
    const db = database(); const id = workspace(db); const repository = new SqliteWorkspaceContentRepository(db)
    const revision = repository.createRevision({ workspaceId: id, inputHash: hash('d'), now: 10 })
    db.sqlite.prepare("INSERT INTO roadmaps (id,workspace_id,title,status,generation_kind,version,content_revision,content_hash,created_at,updated_at) VALUES ('roadmap',?,'C','accepted','ai_generated',1,?,?,20,20)").run(id, revision.revision, hash('e'))
    db.sqlite.prepare("INSERT INTO roadmap_modules (id,roadmap_id,title,objective,estimated_minutes,position,status,topics_json,outcomes_json,practice,completion_criteria_json,resources_json) VALUES ('module','roadmap','Base','Aprender',60,1,'active','[\"Ponteiros\",\"Arrays\"]','[\"Entender\"]','Praticar','[\"Concluir\"]','[]')").run()
    expect(repository.evaluateReadiness({ workspaceId: id, expectedRevision: revision.revision, todayDateKey: '2026-09-11', now: 30 }).state).toBe('PROVISIONING')
    db.close()
  })

  it('accepts a single-topic revision as USABLE without an N+1 job', () => {
    const db = database(); const id = workspace(db); const repository = new SqliteWorkspaceContentRepository(db); const inputHash = hash('a'); const revision = repository.createRevision({ workspaceId: id, inputHash, now: 10 })
    db.sqlite.prepare("INSERT INTO roadmaps (id,workspace_id,title,status,generation_kind,version,content_revision,content_hash,created_at,updated_at) VALUES ('single-roadmap',?,'C','accepted','ai_generated',1,?,?,20,20)").run(id, revision.revision, inputHash)
    db.sqlite.prepare("INSERT INTO roadmap_modules (id,roadmap_id,title,objective,estimated_minutes,position,status,topics_json,outcomes_json,practice,completion_criteria_json,resources_json) VALUES ('single-module','single-roadmap','Base','Aprender',60,1,'active','[\"Único\"]','[\"Entender\"]','Praticar','[\"Concluir\"]','[]')").run()
    const lesson = { title: 'Único', level: 'basic', objective: 'Aprender', sources: [], blocks: [{ id: 'a', type: 'explanation', title: 'A', content: 'A' }, { id: 'b', type: 'explanation', title: 'B', content: 'B' }, { id: 'c', type: 'explanation', title: 'C', content: 'C' }, { id: 'check', type: 'checkpoint', title: 'Check', questionType: 'multiple_choice', question: 'Qual?', options: Array.from({ length: 5 }, (_, index) => ({ id: `o${index}`, text: `O${index}`, rationale: `R${index}` })), correctOptionId: 'o1', reasoningRequirement: 'required' as const, hint: 'H', reinforcement: 'R' }] }
    db.sqlite.prepare("INSERT INTO study_lessons (id,workspace_id,roadmap_id,module_id,topic_id,generation_kind,content_revision,input_hash,content_json,created_at,updated_at) VALUES ('single-lesson',?,'single-roadmap','single-module','single-module:Único','ai_generated',?,?,?,20,20)").run(id, revision.revision, inputHash, JSON.stringify(lesson))
    db.sqlite.prepare("INSERT INTO exercise_sets (id,workspace_id,roadmap_id,module_id,topic_id,lesson_id,content_revision,input_hash,status,generation_attempts,created_at,updated_at) VALUES ('single-set',?,'single-roadmap','single-module','single-module:Único','single-lesson',?,?,'ready',1,20,20)").run(id, revision.revision, inputHash)
    db.sqlite.prepare("INSERT INTO exercises (id,set_id,position,kind,difficulty,title,statement,input_description,output_description,language,starter_code,required_for_topic_completion,public_tests_json,private_tests_json,reference_solution,hint,created_at) VALUES ('single-exercise','single-set',1,'PROGRAMMING_PROBLEM','introductory','P','S','','','c','int main(){}',1,?,?,?,'H',20)").run(JSON.stringify([{ id: 'p', input: '', expectedOutput: '' }]), JSON.stringify(Array.from({ length: 3 }, (_, i) => ({ id: `h${i}`, input: '', expectedOutput: '' }))), 'int main(){}')
    db.sqlite.prepare("INSERT INTO weekly_plans (id,week_start,timezone,revision,generated_at,updated_at) VALUES ('single-plan','2026-09-07','UTC',1,20,20)").run(); db.sqlite.prepare("INSERT INTO weekly_plan_items (id,plan_id,workspace_id,source_key,date_key,title,duration_minutes,position,status,module_id,topic_id,activity_type,scheduled_start_minutes,reason,created_at,updated_at) VALUES ('single-item','single-plan',?,'single','2026-09-11','Único',30,1,'pending','single-module','single-module:Único','introduction',600,'first',20,20)").run(id)
    for (const kind of ['roadmap_generate', 'lesson_generate', 'exercise_generate'] as const) repository.enqueue({ workspaceId: id, revision: revision.revision, kind, unitKey: kind === 'roadmap_generate' ? 'roadmap' : 'single-module:Único', priority: 10, inputHash, generatorContractVersion: 'v1' }, 30)
    for (let index = 0; index < 3; index += 1) { const lease = repository.claimNext({ owner: 'worker', now: 31 + index })!; repository.publishLease({ jobId: lease.id, leaseToken: lease.leaseToken!, now: 40 + index, publish: () => true }) }
    expect(repository.evaluateReadiness({ workspaceId: id, expectedRevision: revision.revision, todayDateKey: '2026-09-11', now: 40 }).state).toBe('USABLE'); db.close()
  })

  it('adopts a rebuilt roadmap into exactly one new revision with a ready roadmap unit', () => { const db = database(); const id = workspace(db); const repository = new SqliteWorkspaceContentRepository(db); repository.createRevision({ workspaceId: id, inputHash: hash('a'), now: 1 }); db.sqlite.prepare("INSERT INTO roadmaps (id,workspace_id,title,status,generation_kind,version,created_at,updated_at) VALUES ('rebuilt',?,'B','accepted','ai_generated',2,2,2)").run(id); const adopted = repository.adoptRoadmapRevision({ workspaceId: id, roadmapId: 'rebuilt', inputHash: hash('b'), now: 3 }); expect(adopted.revision).toBe(2); expect(repository.getRevision(id)?.revision).toBe(2); expect(db.sqlite.prepare("SELECT content_revision AS revision,content_hash AS hash FROM roadmaps WHERE id='rebuilt'").get()).toEqual({ revision: 2, hash: hash('b') }); expect(db.sqlite.prepare("SELECT status FROM content_jobs WHERE workspace_id=? AND revision=2 AND kind='roadmap_generate'").get(id)).toEqual({ status: 'ready' }); db.close() })

  it('keeps rebuild mutation authoritative through callback, repeated initialize, and later material change', async () => {
    const db = database(); const id = workspace(db); const content = new SqliteWorkspaceContentRepository(db); let now = 10; const coordinator = new InitialProvisioningCoordinator(db, content, () => {}, () => ++now)
    db.sqlite.prepare("INSERT INTO workspace_learning_overrides (workspace_id,subject,canonical_focus,canonical_context,declared_knowledge_json,declared_difficulties_json,goals_json,created_at,updated_at) VALUES (?,'C','Ponteiros','','[]','[]','[]',1,1)").run(id)
    coordinator.initialize(id); const first = content.getRevision(id)!; const roadmaps = new DrizzleRoadmapRepository(db); const moduleA = crypto.randomUUID(); const roadmapA = roadmapSchema.parse({ id: crypto.randomUUID(), workspaceId: id, title: 'A', status: 'accepted', generationKind: 'ai_generated', version: 1, providerId: null, modelId: null, modules: [{ id: moduleA, title: 'A', objective: 'A', estimatedMinutes: 60, position: 1, status: 'active', topics: ['A'], outcomes: ['A'], practice: 'A', completionCriteria: ['A'], resources: [] }], createdAt: now, updatedAt: now }); roadmaps.activate(roadmapA); roadmaps.setContentRevision(roadmapA.id, first.revision, first.inputHash)
    const preview = roadmapRebuildPreviewSchema.parse({ id: crypto.randomUUID(), workspaceId: id, currentRoadmapId: roadmapA.id, title: 'B', modules: [{ ...roadmapA.modules[0], title: 'B', topics: ['B'] }], materialIds: [crypto.randomUUID()], impact: { preservedModuleIds: [], preservedTopicIds: [], addedTopics: [`${moduleA}:B`], removedTopics: [`${moduleA}:A`], unsafeProgressTopicIds: [], requiresAcknowledgement: false }, status: 'pending', appliedRoadmapId: null, createdAt: now, resolvedAt: null }); roadmaps.saveRebuildPreview(preview)
    const atomicRoadmaps = new DrizzleRoadmapRepository(db, (roadmap) => coordinator.adoptApprovedRoadmap(roadmap)); const service = new RoadmapService(atomicRoadmaps, new AIProviderManager(), async () => ({ id, name: 'C', objective: 'Ponteiros', status: 'active', createdAt: 1, updatedAt: 1, lastOpenedAt: null, archivedAt: null })); service.setRoadmapChangedHandler((roadmap, atomicallyAdopted) => { if (atomicallyAdopted) coordinator.resumeApprovedRoadmap(roadmap.workspaceId) }); const roadmapB = await service.applyRebuild({ workspaceId: id, previewId: preview.id, acknowledgeUnsafeChanges: false }); const second = content.getRevision(id)!
    expect(second.revision).toBe(first.revision + 1); expect(db.sqlite.prepare('SELECT content_revision AS revision,content_hash AS hash FROM roadmaps WHERE id=?').get(roadmapB.id)).toEqual({ revision: second.revision, hash: second.inputHash }); expect(db.sqlite.prepare("SELECT status FROM content_jobs WHERE workspace_id=? AND revision=? AND kind='roadmap_generate'").get(id, second.revision)).toEqual({ status: 'ready' }); expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM roadmaps WHERE workspace_id=?').get(id)).toEqual({ count: 2 })
    coordinator.initialize(id); expect(content.getRevision(id)?.revision).toBe(second.revision); expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM roadmaps WHERE workspace_id=?').get(id)).toEqual({ count: 2 })
    db.sqlite.prepare("INSERT INTO materials (id,workspace_id,name,media_type,page_count,status,relevance,role,content_hash,created_at) VALUES (?,?, 'novo.pdf','application/pdf',1,'ready',100,'base',?,?)").run(crypto.randomUUID(), id, hash('c'), ++now); coordinator.initialize(id); expect(content.getRevision(id)?.revision).toBe(second.revision + 1); expect(db.sqlite.prepare("SELECT status FROM content_jobs WHERE workspace_id=? AND revision=? AND kind='roadmap_generate'").get(id, second.revision + 1)).toEqual({ status: 'queued' }); db.close()
  })

  it('rolls back roadmap B, authority, revision, and ready job when atomic adoption fails', () => { const db = database(); const id = workspace(db); const content = new SqliteWorkspaceContentRepository(db); const first = content.createRevision({ workspaceId: id, inputHash: hash('a'), now: 1 }); const base = new DrizzleRoadmapRepository(db); const roadmapA = roadmapSchema.parse({ id: crypto.randomUUID(), workspaceId: id, title: 'A', status: 'accepted', generationKind: 'ai_generated', version: 1, providerId: null, modelId: null, modules: [{ id: crypto.randomUUID(), title: 'A', objective: 'A', estimatedMinutes: 60, position: 1, status: 'active', topics: ['A'], outcomes: ['A'], practice: 'A', completionCriteria: ['A'], resources: [] }], createdAt: 1, updatedAt: 1 }); base.activate(roadmapA); base.setContentRevision(roadmapA.id, first.revision, first.inputHash); const preview = roadmapRebuildPreviewSchema.parse({ id: crypto.randomUUID(), workspaceId: id, currentRoadmapId: roadmapA.id, title: 'B', modules: [{ ...roadmapA.modules[0], title: 'B' }], materialIds: [crypto.randomUUID()], impact: { preservedModuleIds: [], preservedTopicIds: [], addedTopics: [], removedTopics: [], unsafeProgressTopicIds: [], requiresAcknowledgement: false }, status: 'pending', appliedRoadmapId: null, createdAt: 2, resolvedAt: null }); base.saveRebuildPreview(preview); const failing = new DrizzleRoadmapRepository(db, () => { throw new Error('adoption failed') }); expect(() => failing.applyRebuildPreview(preview, 3, hash('b'))).toThrow('adoption failed'); expect(base.findCurrent(id)?.id).toBe(roadmapA.id); expect(base.findRebuildPreview(id, preview.id)?.status).toBe('pending'); expect(content.getRevision(id)?.revision).toBe(first.revision); expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_content_authority WHERE workspace_id=?').get(id)).toEqual({ count: 0 }); expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM content_jobs WHERE workspace_id=? AND revision=?').get(id, first.revision + 1)).toEqual({ count: 0 }); db.close() })

  it('publishes USABLE and FULLY_PROVISIONED only from the exact validated revision', () => {
    const db = database(); const id = workspace(db); const repository = new SqliteWorkspaceContentRepository(db); const inputHash = hash('1')
    const revision = repository.createRevision({ workspaceId: id, inputHash, now: 10 })
    db.sqlite.prepare("INSERT INTO roadmaps (id,workspace_id,title,status,generation_kind,version,content_revision,content_hash,created_at,updated_at) VALUES ('roadmap',?,'C','accepted','ai_generated',1,?,?,20,20)").run(id, revision.revision, inputHash)
    db.sqlite.prepare("INSERT INTO roadmap_modules (id,roadmap_id,title,objective,estimated_minutes,position,status,topics_json,outcomes_json,practice,completion_criteria_json,resources_json) VALUES ('module','roadmap','Base','Aprender',60,1,'active','[\"Ponteiros\",\"Arrays\"]','[\"Entender\"]','Praticar','[\"Concluir\"]','[]')").run()
    const lesson = { title: 'Ponteiros', level: 'basic', objective: 'Usar ponteiros', sources: [], blocks: [
      { id: 'a', type: 'explanation', title: 'A', content: 'Conteudo' },
      { id: 'b', type: 'explanation', title: 'B', content: 'Conteudo' },
      { id: 'c', type: 'explanation', title: 'C', content: 'Conteudo' },
      { id: 'check', type: 'checkpoint', title: 'Check', questionType: 'multiple_choice', question: 'Qual?', options: Array.from({ length: 5 }, (_, index) => ({ id: `o${index}`, text: `Opcao ${index}`, rationale: `Razao ${index}` })), correctOptionId: 'o1', reasoningRequirement: 'required' as const, hint: 'Pense', reinforcement: 'Revise' },
    ] }
    db.sqlite.prepare("INSERT INTO study_lessons (id,workspace_id,roadmap_id,module_id,topic_id,generation_kind,content_revision,input_hash,content_json,created_at,updated_at) VALUES ('lesson',?,'roadmap','module','module:Ponteiros','ai_generated',?,?,?,20,20)").run(id, revision.revision, inputHash, JSON.stringify(lesson))
    db.sqlite.prepare("INSERT INTO exercise_sets (id,workspace_id,roadmap_id,module_id,topic_id,lesson_id,content_revision,input_hash,status,generation_attempts,created_at,updated_at) VALUES ('set',?,'roadmap','module','module:Ponteiros','lesson',?,?,'ready',1,20,20)").run(id, revision.revision, inputHash)
    db.sqlite.prepare("INSERT INTO exercises (id,set_id,position,kind,difficulty,title,statement,input_description,output_description,language,starter_code,required_for_topic_completion,public_tests_json,private_tests_json,reference_solution,hint,created_at) VALUES ('exercise','set',1,'PROGRAMMING_PROBLEM','introductory','Pratica','Execute','','','c','int main(){}',1,?,?,?,'Dica',20)").run(JSON.stringify([{ id: 'p', input: '', expectedOutput: '' }]), JSON.stringify(Array.from({ length: 3 }, (_, index) => ({ id: `h${index}`, input: '', expectedOutput: '' }))), 'int main(){}')
    db.sqlite.prepare("INSERT INTO weekly_plans (id,week_start,timezone,revision,generated_at,updated_at) VALUES ('plan','2026-09-07','UTC',1,20,20)").run()
    db.sqlite.prepare("INSERT INTO weekly_plan_items (id,plan_id,workspace_id,source_key,date_key,title,duration_minutes,position,status,module_id,topic_id,activity_type,scheduled_start_minutes,reason,created_at,updated_at) VALUES ('item','plan',?,'source','2026-09-11','Ponteiros',30,1,'pending','module','module:Ponteiros','introduction',600,'Primeiro topico',20,20)").run(id)
    const units = ['roadmap_generate', 'lesson_generate', 'exercise_generate'] as const
    for (const [index, kind] of units.entries()) {
      const unitKey = kind === 'roadmap_generate' ? 'roadmap' : 'module:Ponteiros'
      const job = repository.enqueue({ workspaceId: id, revision: revision.revision, kind, unitKey, priority: 900 - index, inputHash, generatorContractVersion: 'v1' }, 30 + index)
      const lease = repository.claimNext({ owner: 'worker', now: 40 + index })!
      expect(lease.id).toBe(job.id)
      expect(repository.publishLease({ jobId: lease.id, leaseToken: lease.leaseToken!, now: 50 + index, publish: () => true })).toBe(true)
    }
    repository.enqueue({ workspaceId: id, revision: revision.revision, kind: 'lesson_generate', unitKey: 'module:Arrays', priority: 700, inputHash, generatorContractVersion: 'v1' }, 55)
    expect(repository.evaluateReadiness({ workspaceId: id, expectedRevision: revision.revision, todayDateKey: '2026-09-11', now: 60 }).state).toBe('USABLE')
    repository.replaceRequiredUnits(id, revision.revision, units.map((kind) => ({ kind, unitKey: kind === 'roadmap_generate' ? 'roadmap' : 'module:Ponteiros', inputHash })), 61)
    expect(repository.evaluateReadiness({ workspaceId: id, expectedRevision: revision.revision, todayDateKey: '2026-09-11', now: 62 }).state).toBe('FULLY_PROVISIONED')
    db.sqlite.prepare("UPDATE study_lessons SET input_hash=? WHERE id='lesson'").run(hash('9'))
    expect(repository.evaluateReadiness({ workspaceId: id, expectedRevision: revision.revision, todayDateKey: '2026-09-11', now: 63 }).state).toBe('PROVISIONING')
    db.close()
  })

  it('obsoletes jobs removed from the immutable required-unit replacement', () => {
    const db = database(); const id = workspace(db); const repository = new SqliteWorkspaceContentRepository(db)
    const revision = repository.createRevision({ workspaceId: id, inputHash: hash('f'), now: 10 })
    repository.replaceRequiredUnits(id, revision.revision, [{ kind: 'lesson_generate', unitKey: 'topic', inputHash: hash('f') }], 20)
    const job = repository.enqueue({ workspaceId: id, revision: revision.revision, kind: 'lesson_generate', unitKey: 'topic', priority: 300, inputHash: hash('f'), generatorContractVersion: 'v1' }, 21)
    repository.replaceRequiredUnits(id, revision.revision, [], 22)
    expect(repository.getJob(job.id)?.status).toBe('obsolete')
    db.close()
  })

  it('runs material-first provisioning to USABLE, repairs an empty plan, and leaves N+1 queued', async () => {
    const db = database(); const id = workspace(db); const repository = new SqliteWorkspaceContentRepository(db); const now = Date.now()
    db.sqlite.prepare("INSERT INTO workspace_provisioning (workspace_id,status,stage,material_ids_json,attempt_count,created_at,started_at,stage_updated_at) VALUES (?,'running','materials','[]',0,?,?,?)").run(id, now, now, now)
    db.sqlite.prepare("INSERT INTO workspace_learning_overrides (workspace_id,subject,canonical_focus,canonical_context,declared_knowledge_json,declared_difficulties_json,goals_json,created_at,updated_at) VALUES (?,'C','Ponteiros','Prova','[]','[]','[]',?,?)").run(id, now, now)
    db.sqlite.prepare("INSERT INTO planning_settings (id,timezone,updated_at) VALUES ('current','UTC',?)").run(now)
    const materialId = crypto.randomUUID(); db.sqlite.prepare("INSERT INTO materials (id,workspace_id,name,media_type,content_hash,status,page_count,created_at,role,relevance,extraction_fingerprint,analysis_fingerprint) VALUES (?,?,'Apostila','application/pdf',?,'ready',1,?,'priority',100,?,?)").run(materialId, id, hash('a'), now, hash('b'), hash('c'))
    const order: string[] = []; const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)); let coordinator!: InitialProvisioningCoordinator
    const handlers: Partial<Record<import('../../src/shared/contracts/workspace-content-contract').ContentUnitKind, ContentJobHandler>> = {
      roadmap_generate: async (job) => { order.push('roadmap'); await delay(15); return { publish: () => { db.sqlite.prepare("INSERT INTO roadmaps (id,workspace_id,title,status,generation_kind,version,content_revision,content_hash,created_at,updated_at) VALUES ('roadmap',?,'Material C','accepted','ai_generated',1,?,?,?,?)").run(id, job.revision, job.inputHash, now, now); db.sqlite.prepare("INSERT INTO roadmap_modules (id,roadmap_id,title,objective,estimated_minutes,position,status,topics_json,outcomes_json,practice,completion_criteria_json,resources_json) VALUES ('module','roadmap','Ponteiros','Aplicar',60,1,'active','[\"Ponteiros\",\"Arrays\"]','[\"Aplicar\"]','Praticar','[\"Concluir\"]',?)").run(JSON.stringify([{ kind: 'material', title: 'Apostila', type: 'material', materialId, pageNumber: 1, role: 'priority', excerptHash: hash('d') }])) } } },
      lesson_generate: async (job) => { order.push(`lesson:${job.unitKey}`); await delay(15); return { publish: () => { const lesson = { title: job.unitKey, level: 'basic', objective: job.unitKey, sources: [], blocks: [{ id: `${job.unitKey}:a`, type: 'explanation', title: 'A', content: job.unitKey }, { id: `${job.unitKey}:b`, type: 'explanation', title: 'B', content: job.unitKey }, { id: `${job.unitKey}:c`, type: 'explanation', title: 'C', content: job.unitKey }, { id: `${job.unitKey}:check`, type: 'checkpoint', title: 'Check', questionType: 'multiple_choice', question: 'Qual?', options: Array.from({ length: 5 }, (_, index) => ({ id: `o${index}`, text: `Opcao ${index}`, rationale: `Razao ${index}` })), correctOptionId: 'o1', reasoningRequirement: 'required' as const, hint: 'Pense', reinforcement: 'Revise' }] }; db.sqlite.prepare("INSERT INTO study_lessons (id,workspace_id,roadmap_id,module_id,topic_id,generation_kind,content_revision,input_hash,content_json,created_at,updated_at) VALUES (?,?, 'roadmap','module',?,'ai_generated',?,?,?, ?,?)").run(`${job.unitKey}:lesson`, id, job.unitKey, job.revision, job.inputHash, JSON.stringify(lesson), now, now) } } },
      exercise_generate: async (job) => { order.push('exercise'); await delay(15); return { publish: () => { db.sqlite.prepare("INSERT INTO exercise_sets (id,workspace_id,roadmap_id,module_id,topic_id,lesson_id,content_revision,input_hash,status,generation_attempts,created_at,updated_at) VALUES ('set',?,'roadmap','module',? ,?, ?,?,'ready',1,?,?)").run(id, job.unitKey, `${job.unitKey}:lesson`, job.revision, job.inputHash, now, now); db.sqlite.prepare("INSERT INTO exercises (id,set_id,position,kind,difficulty,title,statement,input_description,output_description,language,starter_code,required_for_topic_completion,public_tests_json,private_tests_json,reference_solution,hint,created_at) VALUES ('exercise','set',1,'PROGRAMMING_PROBLEM','introductory','Pratica','Execute','','','c','int main(){}',1,?,?,?,'Dica',?)").run(JSON.stringify([{ id: 'p', input: '', expectedOutput: '' }]), JSON.stringify(Array.from({ length: 3 }, (_, index) => ({ id: `h${index}`, input: '', expectedOutput: '' }))), 'int main(){}', now) } } },
      plan_recalculate: async () => { order.push('plan'); return { publish: () => { db.sqlite.prepare("INSERT INTO weekly_plans (id,week_start,timezone,revision,generated_at,updated_at) VALUES ('plan',date(?,'weekday 1','-7 days'),'UTC',1,?,?)").run(new Date(now).toISOString(), now, now); const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); db.sqlite.prepare("INSERT INTO weekly_plan_items (id,plan_id,workspace_id,source_key,date_key,title,duration_minutes,position,status,module_id,topic_id,activity_type,scheduled_start_minutes,reason,created_at,updated_at) VALUES ('item','plan',?,'first',?,'Ponteiros',30,1,'pending','module','module:Ponteiros','introduction',600,'Primeiro',?,?)").run(id, dateKey, now, now) } } },
    }
    const worker = new ContentGenerationWorker({ repository, admission: new HeavyGenerationQueue(), handlers, pollMs: 5, onPublished: (job) => coordinator.onPublished(job) }); coordinator = new InitialProvisioningCoordinator(db, repository, () => worker.wake(), Date.now, new PerformanceTimelineStore(db))
    const sequentialStarted = performance.now(); for (let call = 0; call < 5; call += 1) await delay(15); const legacySequentialMs = performance.now() - sequentialStarted
    const started = performance.now(); worker.start(); coordinator.initialize(id)
    await vi.waitFor(() => expect(repository.getRevision(id)?.usableAt).not.toBeNull(), { timeout: 3000 }); const usableMs = repository.getRevision(id)!.usableAt! - now
    expect(order.slice(0, 4)).toEqual(['roadmap', 'lesson:module:Ponteiros', 'exercise', 'plan'])
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM content_jobs WHERE kind='lesson_generate' AND unit_key='module:Arrays' AND status IN ('pending','queued','generating','ready')").get()).toEqual({ count: 1 })
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM weekly_plan_items WHERE workspace_id=?").get(id)).toEqual({ count: 1 })
    const eventCount = (db.sqlite.prepare("SELECT COUNT(*) AS count FROM performance_timeline_events WHERE workspace_id=? AND operation_type='provisioning'").get(id) as { count: number }).count
    expect(eventCount).toBeGreaterThan(0)
    await worker.stop(); console.info(`[controlled-provisioning] legacy_sequential_provider_ms=${legacySequentialMs.toFixed(1)} progressive_provider_baseline_ms=45.0 progressive_usable_ms=${usableMs.toFixed(1)} provider_delay_ms=15 legacy_provider_calls=5 provider_calls_before_usable=3`); db.close()
  })

  it('persists, fetches, applies, and reloads a strict roadmap preview without module primary-key collisions', () => {
    const db = database(); const id = workspace(db); const repository = new DrizzleRoadmapRepository(db); const now = Date.now(); const moduleId = crypto.randomUUID()
    const roadmap = roadmapSchema.parse({ id: crypto.randomUUID(), workspaceId: id, title: 'Original', status: 'accepted', generationKind: 'ai_generated', version: 1, providerId: 'controlled', modelId: 'delayed', modules: [{ id: moduleId, title: 'Modulo', objective: 'Aprender', estimatedMinutes: 60, position: 1, status: 'active', topics: ['Primeiro', 'Segundo'], outcomes: ['Aplicar'], practice: 'Praticar', completionCriteria: ['Concluir'], resources: [] }], createdAt: now, updatedAt: now })
    repository.activate(roadmap)
    const preview = roadmapRebuildPreviewSchema.parse({ id: crypto.randomUUID(), workspaceId: id, currentRoadmapId: roadmap.id, title: 'Atualizado', modules: [{ ...roadmap.modules[0], topics: ['Primeiro', 'Terceiro'] }], materialIds: [crypto.randomUUID()], impact: { preservedModuleIds: [moduleId], preservedTopicIds: [`${moduleId}:Primeiro`], addedTopics: [`${moduleId}:Terceiro`], removedTopics: [`${moduleId}:Segundo`], unsafeProgressTopicIds: [], requiresAcknowledgement: false }, status: 'pending', appliedRoadmapId: null, createdAt: now, resolvedAt: null })
    repository.saveRebuildPreview(preview); expect(repository.findLatestRebuildPreview(id)).toEqual(preview)
    const applied = roadmapSchema.parse(repository.applyRebuildPreview(preview, now + 1, hash('f'))); expect(applied.modules[0]!.id).not.toBe(moduleId); expect(repository.findLatestRebuildPreview(id)?.status).toBe('applied')
    const databasePath = db.path; db.close(); const reopened = openCoachDatabase({ databasePath, migrationsFolder }); expect(roadmapSchema.parse(new DrizzleRoadmapRepository(reopened).findCurrent(id))).toMatchObject({ id: applied.id, title: 'Atualizado' }); reopened.close()
  })
})
