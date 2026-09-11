import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { openCoachDatabase, type CoachDatabase } from '../../src/main/database/connection'
import { SqliteWorkspaceContentRepository } from '../../src/main/repositories/sqlite-workspace-content-repository'

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

describe('SqliteWorkspaceContentRepository', () => {
  it('backfills existing workspaces conservatively and survives reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'coach-content-upgrade-')); directories.push(directory)
    const path = join(directory, 'coach.sqlite'); const sqlite = new Database(path); sqlite.pragma('foreign_keys = ON'); migrate(drizzle(sqlite), { migrationsFolder: migrationsThrough0044() }); const id = '00000000-0000-4000-8000-000000000001'; sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES (?,'C','Ponteiros','active',1,1)").run(id); sqlite.close()
    const reopened = openCoachDatabase({ databasePath: path, migrationsFolder })
    expect(new SqliteWorkspaceContentRepository(reopened).getRevision(id)).toMatchObject({ revision: 1, inputHash: 'legacy-unavailable', state: 'PROVISIONING' })
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

  it('requires roadmap, actionable lesson, exercise, plan, and ready jobs before USABLE', () => {
    const db = database(); const id = workspace(db); const repository = new SqliteWorkspaceContentRepository(db)
    const revision = repository.createRevision({ workspaceId: id, inputHash: hash('d'), now: 10 })
    db.sqlite.prepare("INSERT INTO roadmaps (id,workspace_id,title,status,generation_kind,version,content_revision,content_hash,created_at,updated_at) VALUES ('roadmap',?,'C','accepted','ai_generated',1,?,?,20,20)").run(id, revision.revision, hash('e'))
    db.sqlite.prepare("INSERT INTO roadmap_modules (id,roadmap_id,title,objective,estimated_minutes,position,status,topics_json,outcomes_json,practice,completion_criteria_json,resources_json) VALUES ('module','roadmap','Base','Aprender',60,1,'active','[\"Ponteiros\",\"Arrays\"]','[\"Entender\"]','Praticar','[\"Concluir\"]','[]')").run()
    expect(repository.evaluateReadiness({ workspaceId: id, expectedRevision: revision.revision, todayDateKey: '2026-09-11', now: 30 }).state).toBe('PROVISIONING')
    db.close()
  })

  it('publishes USABLE and FULLY_PROVISIONED only from the exact validated revision', () => {
    const db = database(); const id = workspace(db); const repository = new SqliteWorkspaceContentRepository(db); const inputHash = hash('1')
    const revision = repository.createRevision({ workspaceId: id, inputHash, now: 10 })
    db.sqlite.prepare("INSERT INTO roadmaps (id,workspace_id,title,status,generation_kind,version,content_revision,content_hash,created_at,updated_at) VALUES ('roadmap',?,'C','accepted','ai_generated',1,?,?,20,20)").run(id, revision.revision, hash('2'))
    db.sqlite.prepare("INSERT INTO roadmap_modules (id,roadmap_id,title,objective,estimated_minutes,position,status,topics_json,outcomes_json,practice,completion_criteria_json,resources_json) VALUES ('module','roadmap','Base','Aprender',60,1,'active','[\"Ponteiros\",\"Arrays\"]','[\"Entender\"]','Praticar','[\"Concluir\"]','[]')").run()
    const lesson = { title: 'Ponteiros', level: 'basic', objective: 'Usar ponteiros', sources: [], blocks: [
      { id: 'a', type: 'explanation', title: 'A', content: 'Conteudo' },
      { id: 'b', type: 'explanation', title: 'B', content: 'Conteudo' },
      { id: 'c', type: 'explanation', title: 'C', content: 'Conteudo' },
      { id: 'check', type: 'checkpoint', title: 'Check', questionType: 'multiple_choice', question: 'Qual?', options: Array.from({ length: 5 }, (_, index) => ({ id: `o${index}`, text: `Opcao ${index}`, rationale: `Razao ${index}` })), correctOptionId: 'o1', requiresJustification: true, hint: 'Pense', reinforcement: 'Revise' },
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
})
