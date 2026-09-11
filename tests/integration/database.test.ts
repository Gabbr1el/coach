import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { openCoachDatabase } from '../../src/main/database/connection'
import { validateCoachDatabaseSchema } from '../../src/main/database/restore-recovery'
import { migrationCount, repairExerciseSchema, repairInteractiveCodeStateSchema } from '../../src/main/database/migrate'
import { repairLegacyExerciseData } from '../../src/main/database/exercise-data-repair'
import { DrizzleWorkspaceRepository } from '../../src/main/repositories/drizzle-workspace-repository'
import { DrizzleConversationRepository } from '../../src/main/repositories/drizzle-conversation-repository'
import { DrizzleStudyWorkspaceRepository } from '../../src/main/repositories/drizzle-study-workspace-repository'
import { DrizzlePlannerActionRepository } from '../../src/main/repositories/drizzle-planner-action-repository'
import { DrizzleRoadmapRepository } from '../../src/main/repositories/drizzle-roadmap-repository'
import { SqliteStudyLessonRepository } from '../../src/main/repositories/sqlite-study-lesson-repository'
import { AIProviderManager } from '../../src/application/ai/ai-provider-manager'
import { WorkspaceService } from '../../src/application/workspaces/workspace-service'
import { RoadmapService } from '../../src/application/roadmaps/roadmap-service'
import { CurriculumSourceService } from '../../src/application/roadmaps/curriculum-source-service'
import { StudyLessonService } from '../../src/application/study-lessons/study-lesson-service'
import type { AIProvider } from '../../src/application/ai/ai-provider'
import { studyLessonContentSchema, studyPresentationPreferencesSchema, type StudyLessonBlock } from '../../src/shared/contracts/study-lesson-contract'
import { AcademicSubjectContextService } from '../../src/application/workspaces/academic-subject-context'
import { SqliteAcademicSubjectContextRepository } from '../../src/main/repositories/sqlite-academic-subject-context-repository'
import { SqliteExerciseRepository } from '../../src/main/repositories/sqlite-exercise-repository'
import { PlanningService } from '../../src/application/planning/planning-service'
import { DrizzlePlanningRepository } from '../../src/main/repositories/drizzle-planning-repository'

const temporaryDirectories: string[] = []
const migrationsFolder = resolve('drizzle/migrations')
const currentJournalMigrationCount = migrationCount(migrationsFolder)

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'coach-database-test-'))
  temporaryDirectories.push(directory)
  return join(directory, 'coach.sqlite')
}

function migrationsThrough0028(): string {
  const directory = mkdtempSync(join(tmpdir(), 'coach-migrations-0028-'))
  temporaryDirectories.push(directory)
  cpSync(migrationsFolder, directory, { recursive: true })
  const journalPath = join(directory, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: Array<{ idx: number }> }
  journal.entries = journal.entries.filter((entry) => entry.idx <= 28)
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`)
  rmSync(join(directory, '0029_adaptive_study_pages.sql'))
  return directory
}

describe('Coach database migrations', () => {
  it('keeps journal timestamps strictly increasing so upgrades cannot skip migrations', () => {
    const entries = (JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ when: number }> }).entries
    expect(entries.every((entry, index) => index === 0 || entry.when > entries[index - 1]!.when)).toBe(true)
  })
  it('repairs legacy prediction labels without inventing expected output', () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder })
    database.sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES ('legacy-workspace','Python','','active',1,1)").run()
    database.sqlite.prepare("INSERT INTO exercise_sets (id,workspace_id,roadmap_id,module_id,topic_id,lesson_id,status,generation_attempts,created_at,updated_at) VALUES ('legacy-set','legacy-workspace','roadmap','module','topic','lesson','ready',1,1,1)").run()
    const insert = database.sqlite.prepare("INSERT INTO exercises (id,set_id,position,kind,difficulty,title,statement,input_description,output_description,language,starter_code,prediction_prompt,code_to_observe,required_for_topic_completion,public_tests_json,private_tests_json,reference_solution,expected_prediction,hint,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    insert.run('legacy-code','legacy-set',1,'PREDICT_OUTPUT','introductory','Legacy','Execute','','','python','print(input())',null,null,1,JSON.stringify([{ id: 'public-1', input: 'a', expectedOutput: 'a' }]),JSON.stringify(Array.from({ length: 3 }, (_, index) => ({ id: `hidden-${index}`, input: 'b', expectedOutput: 'b' }))),'print(input())',null,'Hint',1)
    database.sqlite.prepare("INSERT INTO exercise_progress (workspace_id,exercise_id,status,current_code,attempts,updated_at) VALUES ('legacy-workspace','legacy-code','in_progress','print(typed)',3,2)").run()

    expect(repairLegacyExerciseData(database.sqlite, 100)).toEqual({ transformed: 1, quarantinedSets: 0 })
    expect(repairLegacyExerciseData(database.sqlite, 200)).toEqual({ transformed: 0, quarantinedSets: 0 })
    expect(database.sqlite.prepare("SELECT kind,expected_prediction AS expectedPrediction FROM exercises WHERE id='legacy-code'").get()).toEqual({ kind: 'PROGRAMMING_PROBLEM', expectedPrediction: null })
    expect(database.sqlite.prepare("SELECT current_code AS currentCode,attempts FROM exercise_progress WHERE exercise_id='legacy-code'").get()).toEqual({ currentCode: 'print(typed)', attempts: 3 })
    database.close()
  })

  it('quarantines only irreparable exercise sets with a persisted cooldown', () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder })
    database.sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES ('bad-workspace','Python','','active',1,1)").run()
    database.sqlite.prepare("INSERT INTO exercise_sets (id,workspace_id,roadmap_id,module_id,topic_id,lesson_id,status,generation_attempts,created_at,updated_at) VALUES ('bad-set','bad-workspace','roadmap','module','topic','lesson','ready',1,1,1)").run()
    database.sqlite.prepare("INSERT INTO exercises (id,set_id,position,kind,difficulty,title,statement,input_description,output_description,language,starter_code,prediction_prompt,code_to_observe,required_for_topic_completion,public_tests_json,private_tests_json,reference_solution,expected_prediction,hint,created_at) VALUES ('bad-predict','bad-set',1,'PREDICT_OUTPUT','introductory','Bad','Observe','','','python','',NULL,'print(1)',1,'[]','[]',NULL,NULL,'Hint',1)").run()

    expect(repairLegacyExerciseData(database.sqlite, 100)).toEqual({ transformed: 0, quarantinedSets: 1 })
    expect(database.sqlite.prepare("SELECT status,retry_after AS retryAfter,last_error_code AS lastErrorCode FROM exercise_sets WHERE id='bad-set'").get()).toEqual({ status: 'failed_retryable', retryAfter: 300100, lastErrorCode: 'EXERCISE_DATA_INVALID' })
    expect(database.sqlite.prepare("SELECT id FROM exercises WHERE id='bad-predict'").get()).toEqual({ id: 'bad-predict' })
    expect(repairLegacyExerciseData(database.sqlite, 200)).toEqual({ transformed: 0, quarantinedSets: 0 })
    database.close()
  })

  it('hydrates valid rows when one row is corrupt and preserves the invalid history', () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder })
    const workspaceId = crypto.randomUUID()
    database.sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES (?,'Python','','active',1,1)").run(workspaceId)
    database.sqlite.prepare("INSERT INTO exercise_sets (id,workspace_id,roadmap_id,module_id,topic_id,lesson_id,status,generation_attempts,created_at,updated_at) VALUES ('mixed-set',?,'roadmap','module','topic','lesson','ready',1,1,1)").run(workspaceId)
    const insert = database.sqlite.prepare("INSERT INTO exercises (id,set_id,position,kind,difficulty,title,statement,input_description,output_description,language,starter_code,prediction_prompt,code_to_observe,required_for_topic_completion,public_tests_json,private_tests_json,reference_solution,expected_prediction,hint,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    insert.run('valid-code','mixed-set',1,'PROGRAMMING_PROBLEM','introductory','Valid','Run','','','python','print(1)',null,null,1,JSON.stringify([{ id: 'public-1', input: '', expectedOutput: '1' }]),JSON.stringify(Array.from({ length: 3 }, (_, index) => ({ id: `hidden-${index}`, input: '', expectedOutput: '1' }))),'print(1)',null,'Hint',1)
    insert.run('invalid-predict','mixed-set',2,'PREDICT_OUTPUT','introductory','Invalid','Observe','','','python','',null,'print(2)',0,'[]','[]',null,null,'Hint',1)
    database.sqlite.prepare("INSERT INTO exercise_progress (workspace_id,exercise_id,status,current_code,attempts,updated_at) VALUES (?,'valid-code','in_progress','print(typed)',4,2),(?,'invalid-predict','in_progress','',2,2)").run(workspaceId, workspaceId)

    const set = new SqliteExerciseRepository(database, () => 100).findSet(workspaceId, 'topic')
    expect(set).toMatchObject({ status: 'failed_retryable', retryAfter: 300100, lastErrorCode: 'EXERCISE_DATA_INVALID' })
    expect(set?.exercises.map((exercise) => exercise.id)).toEqual(['valid-code'])
    expect(set?.progress).toEqual([expect.objectContaining({ exerciseId: 'valid-code', attempts: 4, currentCode: 'print(typed)' })])
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM exercises WHERE id='invalid-predict'").get()).toEqual({ count: 1 })
    database.close()
  })

  it('regenerates only an invalid row and preserves valid exercise evidence', () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder })
    const workspaceId = crypto.randomUUID()
    database.sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES (?,'Python','','active',1,1)").run(workspaceId)
    database.sqlite.prepare("INSERT INTO exercise_sets (id,workspace_id,roadmap_id,module_id,topic_id,lesson_id,status,generation_attempts,retry_after,last_error_code,created_at,updated_at) VALUES ('selective-set',?,'roadmap','module','topic','lesson','generating',2,NULL,'EXERCISE_DATA_INVALID',1,2)").run(workspaceId)
    const insert = database.sqlite.prepare("INSERT INTO exercises (id,set_id,position,kind,difficulty,title,statement,input_description,output_description,language,starter_code,prediction_prompt,code_to_observe,required_for_topic_completion,public_tests_json,private_tests_json,reference_solution,expected_prediction,hint,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    const hidden = Array.from({ length: 3 }, (_, index) => ({ id: `hidden-${index}`, input: '', expectedOutput: '1' }))
    insert.run('preserved-id','selective-set',1,'PROGRAMMING_PROBLEM','introductory','Valid','Run','','','python','print(1)',null,null,1,JSON.stringify([{ id: 'public-1', input: '', expectedOutput: '1' }]),JSON.stringify(hidden),'print(1)',null,'Hint',1)
    insert.run('repaired-id','selective-set',2,'PREDICT_OUTPUT','introductory','Invalid','Observe','','','python','',null,'print(2)',0,'[]','[]',null,null,'Hint',1)
    database.sqlite.prepare("INSERT INTO exercise_progress (workspace_id,exercise_id,status,current_code,attempts,updated_at) VALUES (?,'preserved-id','passed','print(learned)',4,2),(?,'repaired-id','in_progress','',2,2)").run(workspaceId, workspaceId)
    database.sqlite.prepare("INSERT INTO exercise_attempts (id,workspace_id,exercise_id,idempotency_key,source_revision,code,prediction,status,public_result_json,private_result_json,duration_ms,created_at) VALUES ('attempt',?,'preserved-id','key','revision','print(learned)',NULL,'passed',?,'[]',1,2)").run(workspaceId, JSON.stringify({ mode: 'submit', exerciseId: 'preserved-id', attemptId: 'attempt', status: 'passed', passed: true, passedTests: 4, totalTests: 4, message: 'Passed', compileDiagnostics: [], cases: [], stdout: '', stderr: '', durationMs: 1, createdAt: 2 }))
    const repository = new SqliteExerciseRepository(database)
    const privateExercise = (id: string, position: number) => ({ id, setId: 'selective-set', workspaceId, topicId: 'topic', position, kind: 'PROGRAMMING_PROBLEM' as const, difficulty: 'introductory' as const, title: 'Generated', statement: 'Run', inputDescription: '', outputDescription: '', language: 'python' as const, starterCode: 'print(9)', predictionPrompt: null, codeToObserve: null, requiredForTopicCompletion: true, publicTests: [{ id: 'public-1', input: '', expectedOutput: '9' }], hiddenTests: hidden.map((test) => ({ ...test, expectedOutput: '9' })), referenceSolution: 'print(9)', expectedPrediction: null, hint: 'Hint' })

    repository.saveGenerated({ setId: 'selective-set', workspaceId, topicId: 'topic', providerId: 'provider', modelId: 'model', exercises: [privateExercise('discarded-generated-id', 1), privateExercise('unused-generated-id', 2)], now: 3 })

    expect(database.sqlite.prepare("SELECT id,title FROM exercises WHERE set_id='selective-set' ORDER BY position").all()).toEqual([{ id: 'preserved-id', title: 'Valid' }, { id: 'repaired-id', title: 'Generated' }])
    expect(database.sqlite.prepare("SELECT status,current_code AS currentCode,attempts FROM exercise_progress WHERE exercise_id='preserved-id'").get()).toEqual({ status: 'passed', currentCode: 'print(learned)', attempts: 4 })
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM exercise_attempts WHERE exercise_id='preserved-id'").get()).toEqual({ count: 1 })
    database.close()
  })

  it('repairs divergent exercise tables without losing existing data', () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder })
    database.sqlite.prepare("INSERT INTO workspaces (id, name, objective, status, created_at, updated_at) VALUES ('exercise-repair-workspace', 'Python', '', 'active', 1, 1)").run()
    database.sqlite.exec(`
      INSERT INTO exercise_sets (id, workspace_id, roadmap_id, module_id, topic_id, lesson_id, status, created_at, updated_at)
        VALUES ('repair-set', 'exercise-repair-workspace', 'roadmap', 'module', 'topic', 'lesson', 'ready', 1, 1);
      INSERT INTO exercises (id, set_id, position, kind, difficulty, title, statement, input_description, output_description, language, starter_code, public_tests_json, private_tests_json, reference_solution, hint, created_at)
        VALUES ('repair-exercise', 'repair-set', 1, 'PROGRAMMING_PROBLEM', 'introductory', 'Preserved', 'Statement', '', '', 'python', 'print(1)', '[]', '[]', 'print(1)', 'Hint', 1);
      INSERT INTO exercise_progress (workspace_id, exercise_id, status, current_code, attempts, updated_at)
        VALUES ('exercise-repair-workspace', 'repair-exercise', 'in_progress', 'print(2)', 3, 2);
      ALTER TABLE exercise_attempts DROP COLUMN prediction;
      ALTER TABLE exercises DROP COLUMN expected_prediction;
      ALTER TABLE exercises DROP COLUMN code_to_observe;
      ALTER TABLE exercises DROP COLUMN prediction_prompt;
    `)

    repairExerciseSchema(database.sqlite)

    expect(database.sqlite.prepare("SELECT title, reference_solution AS referenceSolution FROM exercises WHERE id = 'repair-exercise'").get()).toEqual({ title: 'Preserved', referenceSolution: 'print(1)' })
    expect(database.sqlite.prepare("SELECT current_code AS currentCode, attempts FROM exercise_progress WHERE exercise_id = 'repair-exercise'").get()).toEqual({ currentCode: 'print(2)', attempts: 3 })
    expect((database.sqlite.pragma('table_info(exercises)') as Array<{ name: string }>).map(({ name }) => name)).toEqual(expect.arrayContaining(['prediction_prompt', 'code_to_observe', 'expected_prediction']))
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([])
    validateCoachDatabaseSchema(database.sqlite, currentJournalMigrationCount)
    database.close()

    const reopened = openCoachDatabase({ databasePath: database.path, migrationsFolder })
    expect(reopened.sqlite.prepare("SELECT current_code AS currentCode, attempts FROM exercise_progress WHERE exercise_id = 'repair-exercise'").get()).toEqual({ currentCode: 'print(2)', attempts: 3 })
    expect(reopened.sqlite.pragma('foreign_key_check')).toEqual([])
    reopened.close()
  })

  it('creates missing and partial exercise tables idempotently', () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder })
    database.sqlite.exec('DROP TABLE exercise_attempts; DROP TABLE exercise_progress; DROP TABLE exercises; DROP TABLE exercise_sets; CREATE TABLE exercise_sets (id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, topic_id text NOT NULL, status text NOT NULL);')
    database.sqlite.prepare("INSERT INTO workspaces (id, name, objective, status, created_at, updated_at) VALUES ('partial-workspace', 'C', '', 'active', 1, 1)").run()
    database.sqlite.prepare("INSERT INTO exercise_sets (id, workspace_id, topic_id, status) VALUES ('partial-set', 'partial-workspace', 'topic', 'ready')").run()
    database.sqlite.pragma('foreign_keys = OFF')
    database.sqlite.prepare("INSERT INTO exercise_sets (id, workspace_id, topic_id, status) VALUES ('orphan-set', 'missing-workspace', 'orphan-topic', 'ready')").run()
    database.sqlite.pragma('foreign_keys = ON')

    repairExerciseSchema(database.sqlite)
    repairExerciseSchema(database.sqlite)

    expect(database.sqlite.prepare("SELECT id, workspace_id AS workspaceId, topic_id AS topicId FROM exercise_sets WHERE id = 'partial-set'").get()).toEqual({ id: 'partial-set', workspaceId: 'partial-workspace', topicId: 'topic' })
    expect(database.sqlite.prepare("SELECT id FROM exercise_sets WHERE id = 'orphan-set'").get()).toBeUndefined()
    expect(database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'exercise%' ORDER BY name").all()).toEqual([{ name: 'exercise_attempts' }, { name: 'exercise_progress' }, { name: 'exercise_sets' }, { name: 'exercises' }])
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([])
    validateCoachDatabaseSchema(database.sqlite, currentJournalMigrationCount)
    database.close()
  })

  it('applies curricular roadmap preview lifecycle to new and existing databases', () => { const databasePath = createDatabasePath(); const first = openCoachDatabase({ databasePath, migrationsFolder }); expect(first.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'roadmap_rebuild_previews'").get()).toEqual({ name: 'roadmap_rebuild_previews' }); expect((first.sqlite.pragma('table_info(roadmap_rebuild_previews)') as Array<{ name: string }>).map((column) => column.name)).toEqual(expect.arrayContaining(['status', 'applied_roadmap_id', 'resolved_at'])); first.close(); const reopened = openCoachDatabase({ databasePath, migrationsFolder }); expect(reopened.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]); reopened.close() })
  it('repairs a divergent interactive code table idempotently without losing rows', () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder })
    database.sqlite.exec('ALTER TABLE study_interactive_code_states DROP COLUMN evidence_granted_at')
    database.sqlite.prepare("INSERT INTO workspaces (id, name, objective, status, created_at, updated_at) VALUES ('drift-workspace', 'Python', 'Executar', 'active', 1, 1)").run()
    database.sqlite.prepare("INSERT INTO study_lessons (id, generation_kind, workspace_id, roadmap_id, module_id, topic_id, content_json, provider_id, model_id, created_at, updated_at) VALUES ('drift-lesson', 'provisional_fallback', 'drift-workspace', 'roadmap', 'module', 'topic', '{}', NULL, NULL, 1, 1)").run()
    database.sqlite.prepare("INSERT INTO study_interactive_code_states (workspace_id, lesson_id, block_id, current_code, prediction, current_source_revision, attempts, updated_at) VALUES ('drift-workspace', 'drift-lesson', 'block', 'print(1)', NULL, 'revision-preserved', 2, 1)").run()
    repairInteractiveCodeStateSchema(database.sqlite)
    repairInteractiveCodeStateSchema(database.sqlite)
    expect(database.sqlite.pragma('table_info(study_interactive_code_states)')).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'evidence_granted_at' })]))
    expect(database.sqlite.prepare("SELECT current_code AS currentCode, attempts FROM study_interactive_code_states WHERE block_id = 'block'").get()).toEqual({ currentCode: 'print(1)', attempts: 2 })
    validateCoachDatabaseSchema(database.sqlite, currentJournalMigrationCount)
    database.close()
  })

  it('leaves the current interactive code schema unchanged across repeated opens', () => {
    const databasePath = createDatabasePath()
    openCoachDatabase({ databasePath, migrationsFolder }).close()
    const reopened = openCoachDatabase({ databasePath, migrationsFolder })
    const columns = reopened.sqlite.pragma('table_info(study_interactive_code_states)') as Array<{ name: string }>
    expect(columns.filter((column) => column.name === 'evidence_granted_at')).toHaveLength(1)
    reopened.close()
  })
  it('persists academic declarations separately from observed evidence', () => { const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder }); const service = new AcademicSubjectContextService(new SqliteAcademicSubjectContextRepository(database), () => 10); service.recordMessage('Sei bastante Python e já uso bibliotecas'); expect(service.get('python')).toMatchObject({ subject: 'Python', declaredLevel: 'advanced', declaredKnowledge: ['Sei bastante Python e já uso bibliotecas'] }); expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM topic_learning_states').get()).toEqual({ count: 0 }); database.close() })
  it('persists interactive source revisions across database restart', () => {
    const databasePath = createDatabasePath()
    const workspaceId = crypto.randomUUID()
    const first = openCoachDatabase({ databasePath, migrationsFolder })
    first.sqlite.prepare("INSERT INTO workspaces (id, name, objective, status, created_at, updated_at) VALUES (?, 'Java', 'Executar', 'active', 1, 1)").run(workspaceId)
    first.sqlite.prepare("INSERT INTO study_lessons (id, generation_kind, workspace_id, roadmap_id, module_id, topic_id, content_json, provider_id, model_id, created_at, updated_at) VALUES ('lesson-revision', 'provisional_fallback', ?, 'roadmap', 'module', 'topic', ?, NULL, NULL, 1, 1)").run(workspaceId, JSON.stringify({ title: 'Aula', level: 'iniciante', objective: 'Executar', blocks: [], usedSourceIds: [] }))
    first.sqlite.prepare("INSERT INTO study_interactive_code_states (workspace_id, lesson_id, block_id, current_code, prediction, current_source_revision, attempts, updated_at) VALUES (?, 'lesson-revision', 'block', 'class Main {}', NULL, 'revision-persisted', 0, 1)").run(workspaceId)
    first.close()
    const reopened = openCoachDatabase({ databasePath, migrationsFolder })
    expect(reopened.sqlite.prepare("SELECT current_source_revision AS currentSourceRevision FROM study_interactive_code_states WHERE block_id = 'block'").get()).toEqual({ currentSourceRevision: 'revision-persisted' })
    reopened.close()
  })
  it('keeps knowledge and goals separated across subjects in one HOME message', () => { const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder }); const service = new AcademicSubjectContextService(new SqliteAcademicSubjectContextRepository(database), () => 10); service.recordMessage('Sei Python, mas quero aprender Java.'); expect(service.get('Python')?.declaredKnowledge).toEqual(['Sei Python']); expect(service.get('Python')?.goals).toEqual([]); expect(service.get('Java')?.goals).toEqual(['quero aprender Java']); expect(service.get('Java')?.declaredKnowledge).toEqual([]); database.close() })
  it('separates coordinated knowledge and goal declarations by subject', () => { const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder }); const service = new AcademicSubjectContextService(new SqliteAcademicSubjectContextRepository(database), () => 10); service.recordMessage('Sei Python e quero Java'); expect(service.get('Python')?.declaredKnowledge).toEqual(['Sei Python']); expect(service.get('Java')?.goals).toEqual(['quero Java']); database.close() })
  it('upgrades a populated 0028 database through the registered adaptive-page migration', () => {
    const databasePath = createDatabasePath()
    const oldMigrations = migrationsThrough0028()
    let database = openCoachDatabase({ databasePath, migrationsFolder: oldMigrations })
    database.sqlite.prepare("INSERT INTO workspaces (id, name, objective, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").run('00000000-0000-4000-8000-000000000029', 'Sentinela 0028', 'Preservar no upgrade', 1, 1)
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: 29 })
    database.close()

    database = openCoachDatabase({ databasePath, migrationsFolder })
    expect(database.sqlite.prepare("SELECT name, objective FROM workspaces WHERE id = '00000000-0000-4000-8000-000000000029'").get()).toEqual({ name: 'Sentinela 0028', objective: 'Preservar no upgrade' })
    expect(database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('study_lesson_adaptations', 'workspace_study_preferences') ORDER BY name").all()).toEqual([{ name: 'study_lesson_adaptations' }, { name: 'workspace_study_preferences' }])
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: currentJournalMigrationCount })
    validateCoachDatabaseSchema(database.sqlite, currentJournalMigrationCount)
    database.close()
  })

  it('repairs the unpublished draft adaptive schema without deleting existing data', () => {
    const databasePath = createDatabasePath()
    let database = openCoachDatabase({ databasePath, migrationsFolder })
    database.sqlite.exec('DROP INDEX study_lesson_adaptations_one_active; DROP INDEX study_lesson_adaptations_revision_unique; DROP INDEX study_lesson_adaptations_lesson_block_idx; DROP TABLE study_lesson_adaptations; CREATE TABLE study_lesson_adaptations (id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, lesson_id text NOT NULL, block_id text NOT NULL, instruction text NOT NULL, original_block_json text NOT NULL, adapted_block_json text NOT NULL, provider_id text, model_id text, created_at integer NOT NULL, restored_at integer);')
    database.close()

    database = openCoachDatabase({ databasePath, migrationsFolder })
    expect((database.sqlite.pragma('table_info(study_lesson_adaptations)') as Array<{ name: string }>).map((column) => column.name)).toEqual(['id', 'workspace_id', 'lesson_id', 'source_block_id', 'revision', 'reason', 'mode', 'adapted_block_json', 'is_active', 'provider_id', 'model_id', 'created_at'])
    validateCoachDatabaseSchema(database.sqlite, currentJournalMigrationCount)
    database.close()
  })

  it('creates the current domain schema and migration history', () => {
    const databasePath = createDatabasePath()
    const database = openCoachDatabase({ databasePath, migrationsFolder })
    const sqlite = database.sqlite

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>

    expect(tables).toEqual([
      { name: '__drizzle_migrations' },
      { name: 'academic_availability' },
      { name: 'academic_events' },
      { name: 'academic_life_items' },
      { name: 'academic_subject_contexts' },
      { name: 'checkpoint_reasoning_evidence' },
      { name: 'content_job_dependencies' },
      { name: 'content_jobs' },
      { name: 'content_revision_required_units' },
      { name: 'conversation_messages' },
      { name: 'conversation_threads' },
      { name: 'daily_planning_budgets' },
      { name: 'exercise_attempts' },
      { name: 'exercise_progress' },
      { name: 'exercise_sets' },
      { name: 'exercises' },
      { name: 'learning_events' },
      { name: 'material_chunks' },
      { name: 'materials' },
      { name: 'plan_item_completion_history' },
      { name: 'planner_actions' },
      { name: 'project_builds' },
      { name: 'project_files' },
      { name: 'project_ui_states' },
      { name: 'provider_configurations' },
      { name: 'roadmap_adaptations' },
      { name: 'roadmap_modules' },
      { name: 'roadmap_rebuild_previews' },
      { name: 'roadmaps' },
      { name: 'routine_notes' },
      { name: 'saved_for_later' },
      { name: 'session_memories' },
      { name: 'session_topics' },
      { name: 'student_memory' },
      { name: 'study_deadlines' },
      { name: 'study_interactive_code_states' },
      { name: 'study_lesson_adaptations' },
      { name: 'study_lessons' },
      { name: 'study_plan_items' },
      { name: 'study_progress' },
      { name: 'study_progress_events' },
      { name: 'study_sessions' },
      { name: 'topic_learning_states' },
      { name: 'weekly_plan_items' },
      { name: 'weekly_plans' },
      { name: 'workspace_academic_contexts' },
      { name: 'workspace_content_revisions' },
      { name: 'workspace_learning_overrides' },
      { name: 'workspace_learning_path_state' },
      { name: 'workspace_memories' },
      { name: 'workspace_projects' },
      { name: 'workspace_provisioning' },
      { name: 'workspace_study_preferences' },
      { name: 'workspace_study_states' },
      { name: 'workspaces' },
    ])
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: currentJournalMigrationCount })
    expect(() => validateCoachDatabaseSchema(sqlite, currentJournalMigrationCount)).not.toThrow()
    database.close()
  })

  it('persists explicit daily budget and reversible completion history across reload', () => {
    const databasePath = createDatabasePath(); let database = openCoachDatabase({ databasePath, migrationsFolder })
    const workspaceId = crypto.randomUUID(); const planId = crypto.randomUUID(); const itemId = crypto.randomUUID(); const now = Date.parse('2026-09-10T12:00:00Z')
    database.sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)").run(workspaceId, 'C', 'Aprender C', now, now)
    database.sqlite.prepare('INSERT INTO weekly_plans (id,week_start,timezone,revision,generated_at,updated_at) VALUES (?,?,?,?,?,?)').run(planId, '2026-09-07', 'UTC', 1, now, now)
    database.sqlite.prepare("INSERT INTO weekly_plan_items (id,plan_id,workspace_id,source_key,date_key,title,duration_minutes,position,status,module_id,topic_id,activity_type,scheduled_start_minutes,reason,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(itemId, planId, workspaceId, 'source', '2026-09-10', 'Ponteiros', 60, 1, 'pending', null, null, 'exercise', 1080, 'Teste', now, now)
    const repository = new DrizzlePlanningRepository(database); database.sqlite.prepare("INSERT INTO academic_life_items (id,kind,title,details,workspace_id,starts_at,ends_at,expires_at,timezone,weekday,minutes,status,share_with_ai,provenance_source,provenance_reference,replaces_id,replaced_by_id,fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'active',1,'legacy_migration',NULL,NULL,NULL,?,?,?)").run(crypto.randomUUID(), 'availability', 'Antiga', '', null, null, null, null, 'UTC', 4, 120, 'legacy-availability-4', now - 10, now - 10); repository.setAvailability(4, 240, now); expect(repository.listWeeklyAvailability(now)).toContainEqual({ weekday: 4, minutes: 240 }); repository.setTodayBudget('2026-09-10', 'UTC', 240, now); expect(repository.setWeeklyPlanItemCompletion(workspaceId, itemId, true, now + 1)).toBe(true); expect(repository.setWeeklyPlanItemCompletion(workspaceId, itemId, false, now + 2)).toBe(true); database.close()
    database = openCoachDatabase({ databasePath, migrationsFolder }); const reopened = database.sqlite.prepare('SELECT status FROM weekly_plan_items WHERE id=?').get(itemId) as { status: string }; expect(reopened.status).toBe('pending'); expect(database.sqlite.prepare('SELECT completed,duration_minutes AS duration FROM plan_item_completion_history WHERE item_id=? ORDER BY created_at').all(itemId)).toEqual([{ completed: 1, duration: 60 }, { completed: 0, duration: 60 }]); expect(database.sqlite.prepare('SELECT minutes FROM daily_planning_budgets WHERE date_key=? AND timezone=?').get('2026-09-10', 'UTC')).toEqual({ minutes: 240 }); database.close()
  })

  it('persists one weekly plan across restart without duplicate work', () => {
    const databasePath = createDatabasePath(); const workspaceId = crypto.randomUUID(); let database = openCoachDatabase({ databasePath, migrationsFolder })
    database.sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES (?,'C','Ponteiros','active',1,1)").run(workspaceId)
    database.sqlite.prepare("INSERT INTO roadmaps (id,workspace_id,title,status,generation_kind,version,created_at,updated_at) VALUES ('roadmap',?,'C','accepted','ai_generated',1,1,1)").run(workspaceId)
    database.sqlite.prepare("INSERT INTO roadmap_modules (id,roadmap_id,title,objective,estimated_minutes,position,status,topics_json,outcomes_json,practice,completion_criteria_json,resources_json) VALUES ('module','roadmap','Base','Aprender',120,1,'active','[\"Ponteiros\"]','[]','','[]','[]')").run()
    const at = Date.parse('2026-09-09T14:00:00Z'); const service = new PlanningService(new DrizzlePlanningRepository(database), () => at); const first = service.replanWeek('UTC'); expect(first.days.flatMap((day) => day.items).length).toBeGreaterThan(0); database.close()
    database = openCoachDatabase({ databasePath, migrationsFolder }); const restored = new PlanningService(new DrizzlePlanningRepository(database), () => at).getWeeklyPlan('UTC'); expect(restored.id).toBe(first.id); expect(new Set(restored.days.flatMap((day) => day.items).map((item) => item.id)).size).toBe(restored.days.flatMap((day) => day.items).length); database.close()
  })
  it('keeps the first persisted planning timezone authoritative after the system timezone changes', () => { const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder }); const at = Date.parse('2026-09-09T02:00:00Z'); const repository = new DrizzlePlanningRepository(database); const service = new PlanningService(repository, () => at); const first = service.replanWeek('America/Sao_Paulo'); const second = service.replanWeek('UTC'); expect(second.timezone).toBe(first.timezone); expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM weekly_plans').get()).toEqual({ count: 1 }); database.close() })

  it('persists public exercise metadata and reloadable progress without private results', () => {
    const databasePath = createDatabasePath()
    let database = openCoachDatabase({ databasePath, migrationsFolder })
    const workspaceId = crypto.randomUUID()
    database.sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES (?,'Python','Laços','active',1,1)").run(workspaceId)
    database.sqlite.prepare("INSERT INTO exercise_sets (id,workspace_id,roadmap_id,module_id,topic_id,lesson_id,status,generation_attempts,created_at,updated_at) VALUES ('set',?,'roadmap','module','module:loops','lesson','ready',1,1,1)").run(workspaceId)
    database.sqlite.prepare("INSERT INTO exercises (id,set_id,position,kind,difficulty,title,statement,input_description,output_description,language,starter_code,prediction_prompt,code_to_observe,required_for_topic_completion,public_tests_json,private_tests_json,reference_solution,expected_prediction,hint,created_at) VALUES ('exercise','set',1,'COMPLETE_CODE','introductory','Somar','Some','Dois inteiros','Soma','python','print(0) # TODO',NULL,NULL,1,?,?,?,NULL,'Pense na operação',1)").run(JSON.stringify([{ id: 'public-1', input: '1 2', expectedOutput: '3' }]), JSON.stringify(Array.from({ length: 3 }, (_, index) => ({ id: `hidden-secret-${index}`, input: '99 1', expectedOutput: '100' }))), 'secret solution')
    const lastSubmission = { status: 'failed', passedTests: 1, totalTests: 4, message: '1 de 4 testes passaram.', compileDiagnostics: [] }
    database.sqlite.prepare("INSERT INTO exercise_progress (workspace_id,exercise_id,status,current_code,attempts,last_submission_json,passed_tests,total_tests,help_used,first_try_success,help_count,passed_at,updated_at) VALUES (?,'exercise','in_progress','print(3)',2,?,1,4,1,0,1,NULL,10)").run(workspaceId, JSON.stringify(lastSubmission))

    const restored = new SqliteExerciseRepository(database).findSet(workspaceId, 'module:loops')!
    expect(restored.exercises[0]).toMatchObject({ kind: 'COMPLETE_CODE', difficulty: 'introductory' })
    expect(restored.progress[0]).toMatchObject({ currentCode: 'print(3)', attempts: 2, passedTests: 1, totalTests: 4, helpUsed: true, firstTrySuccess: false, lastSubmission })
    expect(JSON.stringify(restored)).not.toMatch(/hidden-secret|99 1|secret solution/)
    let exerciseRepository = new SqliteExerciseRepository(database)
    exerciseRepository.saveDraft(workspaceId, 'exercise', 'print(typed_before_run)', 15)
    database.close()
    database = openCoachDatabase({ databasePath, migrationsFolder })
    exerciseRepository = new SqliteExerciseRepository(database)
    expect(exerciseRepository.findSet(workspaceId, 'module:loops')!.progress[0]).toMatchObject({ currentCode: 'print(typed_before_run)', status: 'in_progress', attempts: 2, lastRun: null, lastSubmission })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM exercise_attempts WHERE workspace_id=?').get(workspaceId)).toEqual({ count: 0 })
    const context = exerciseRepository.findPublicContext(workspaceId, 'exercise')
    expect(context).toEqual({ exerciseId: 'exercise', roadmapId: 'roadmap', moduleId: 'module', topicId: 'module:loops', kind: 'COMPLETE_CODE', title: 'Somar', statement: 'Some', language: 'python', currentCode: 'print(typed_before_run)', lastRun: null, lastSubmission: { status: 'failed', passedTests: 1, totalTests: 4, message: '1 de 4 testes passaram.' }, passedTests: 1, totalTests: 4, attemptCount: 2, helpUsed: true, progressStatus: 'in_progress' })
    expect(JSON.stringify(context)).not.toMatch(/hidden-secret|99 1|secret solution|Pense na operação/)
    expect(exerciseRepository.findPublicContext(crypto.randomUUID(), 'exercise')).toBeNull()
    database.sqlite.prepare('UPDATE exercise_progress SET help_used=0,help_count=0 WHERE workspace_id=? AND exercise_id=?').run(workspaceId, 'exercise')
    expect(exerciseRepository.requestHelp(workspaceId, 'exercise', 20)).toMatchObject({ helpCount: 1 })
    expect(exerciseRepository.requestHelp(workspaceId, 'exercise', 21)).toMatchObject({ helpCount: 1 })
    expect(database.sqlite.prepare('SELECT help_used AS helpUsed,help_count AS helpCount,status,current_code AS currentCode,attempts,passed_tests AS passedTests,total_tests AS totalTests FROM exercise_progress WHERE workspace_id=? AND exercise_id=?').get(workspaceId, 'exercise')).toEqual({ helpUsed: 1, helpCount: 1, status: 'in_progress', currentCode: 'print(typed_before_run)', attempts: 2, passedTests: 1, totalTests: 4 })
    expect(database.sqlite.prepare('SELECT evidence_count AS evidenceCount,hints_used AS hintsUsed FROM topic_learning_states WHERE workspace_id=? AND topic_id=?').get(workspaceId, 'module:loops')).toEqual({ evidenceCount: 1, hintsUsed: 1 })
    database.close()
  })

  it('preserves workspace data when the database is reopened and migrated again', () => {
    const databasePath = createDatabasePath()
    const createdAt = Date.now()
    let database = openCoachDatabase({ databasePath, migrationsFolder })
    let sqlite = database.sqlite
    sqlite
      .prepare('INSERT INTO workspaces (id, name, objective, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('workspace-1', 'Estrutura de Dados', 'Preparar a próxima prova', createdAt, createdAt)
    database.close()

    expect(existsSync(databasePath)).toBe(true)
    database = openCoachDatabase({ databasePath, migrationsFolder })
    sqlite = database.sqlite

    const workspace = sqlite.prepare('SELECT id, name, objective, status FROM workspaces WHERE id = ?').get('workspace-1')
    expect(workspace).toEqual({
      id: 'workspace-1',
      name: 'Estrutura de Dados',
      objective: 'Preparar a próxima prova',
      status: 'active',
    })
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(sqlite.pragma('busy_timeout', { simple: true })).toBe(5000)
    database.close()
    expect(database.sqlite.open).toBe(false)
  })

  it('rejects invalid names and inconsistent archive state', () => {
    const databasePath = createDatabasePath()
    const database = openCoachDatabase({ databasePath, migrationsFolder })
    const sqlite = database.sqlite
    const insert = sqlite.prepare(
      'INSERT INTO workspaces (id, name, objective, status, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )

    expect(() => insert.run('empty', '   ', '', 'active', 1, 1, null)).toThrow()
    expect(() => insert.run('invalid-archive', 'C', '', 'archived', 1, 1, null)).toThrow()
    database.close()
  })

  it('persists workspace repository operations and excludes archived records', async () => {
    const databasePath = createDatabasePath()
    const database = openCoachDatabase({ databasePath, migrationsFolder })
    const repository = new DrizzleWorkspaceRepository(database)

    const created = await repository.create({
      id: '00000000-0000-4000-8000-000000000004',
      name: 'Estrutura de Dados',
      objective: 'Próxima prova',
      createdAt: 10,
      updatedAt: 10,
    })
    expect((await repository.listActive()).map((item) => item.id)).toEqual([created.id])
    expect((await repository.markOpened(created.id, 20))?.lastOpenedAt).toBe(20)
    expect(await repository.archive(created.id, 30)).toBe(true)
    expect(await repository.listActive()).toEqual([])
    database.close()
  })

  it('persists a planner turn atomically with stable sequence ordering', async () => {
    const databasePath = createDatabasePath()
    const database = openCoachDatabase({ databasePath, migrationsFolder })
    const repository = new DrizzleConversationRepository(database)
    const threadId = '00000000-0000-4000-8000-000000000000'
    await repository.ensureHomeThread(threadId, 10)

    await repository.addTurn({
      threadId,
      user: { id: 'message-user', threadId, role: 'user', content: 'Prova dia 16', createdAt: 11, providerId: null, modelId: null },
      assistant: { id: 'message-assistant', threadId, role: 'assistant', content: 'Qual matéria?', createdAt: 12, providerId: 'coach-local', modelId: 'planner-rules-v1' },
    })

    expect((await repository.listMessages(threadId, 100)).map((message) => [message.sequence, message.role])).toEqual([[1, 'user'], [2, 'assistant']])
    database.close()
  })

  it('creates an isolated conversation thread for a workspace', async () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder })
    const workspaces = new DrizzleWorkspaceRepository(database)
    const conversations = new DrizzleConversationRepository(database)
    const workspace = await workspaces.create({ id: '00000000-0000-4000-8000-000000000111', name: 'Cálculo', objective: 'Derivadas', createdAt: 1, updatedAt: 1 })
    const threadId = '00000000-0000-4000-8000-000000000222'

    await conversations.ensureWorkspaceThread(threadId, workspace.id, workspace.name, 2)
    const row = database.sqlite.prepare('SELECT scope, workspace_id AS workspaceId, title FROM conversation_threads WHERE id = ?').get(threadId)

    expect(row).toEqual({ scope: 'workspace', workspaceId: workspace.id, title: workspace.name })
    database.close()
  })

  it('persists the complete study workspace state', async () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder })
    const workspaces = new DrizzleWorkspaceRepository(database)
    const repository = new DrizzleStudyWorkspaceRepository(database)
    const workspace = await workspaces.create({ id: '00000000-0000-4000-8000-000000000311', name: 'Algoritmos', objective: 'Listas', createdAt: 1, updatedAt: 1 })
    const state = { workspaceId: workspace.id, sessionId: '00000000-0000-4000-8000-000000000312', sessionStartedAt: 2, fileName: 'main.py', language: 'python', editorContent: 'print(1)', notes: 'Nota', shareContextWithAi: true, timerDurationSeconds: 1500, timerRemainingSeconds: 1400, timerStatus: 'paused' as const, timerStartedAt: null, plan: [{ id: '00000000-0000-4000-8000-000000000313', title: 'Praticar', durationMinutes: 20, position: 1, status: 'active' as const }], updatedAt: 3, documentRevision: 1, notesRevision: 1, accumulatedFocusSeconds: 0 }
    await repository.createState(state)
    database.close()

    const reopened = openCoachDatabase({ databasePath: database.path, migrationsFolder })
    expect(await new DrizzleStudyWorkspaceRepository(reopened).findState(workspace.id, 4)).toMatchObject({ editorContent: 'print(1)', notes: 'Nota', plan: [{ title: 'Praticar' }] })
    reopened.close()
  })
  it('persists a study workspace with an empty plan', async () => { const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder }); const workspaces = new DrizzleWorkspaceRepository(database); const repository = new DrizzleStudyWorkspaceRepository(database); const workspace = await workspaces.create({ id: crypto.randomUUID(), name: 'C', objective: 'Estudar C', createdAt: 1, updatedAt: 1 }); const state = { workspaceId: workspace.id, sessionId: crypto.randomUUID(), sessionStartedAt: 2, fileName: 'main.c', language: 'c', editorContent: '', notes: '', shareContextWithAi: false, timerDurationSeconds: 1500, timerRemainingSeconds: 1500, timerStatus: 'idle' as const, timerStartedAt: null, plan: [], updatedAt: 3, documentRevision: 0, notesRevision: 0, accumulatedFocusSeconds: 0 }; await repository.createState(state); expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM study_plan_items WHERE session_id = ?').get(state.sessionId)).toEqual({ count: 0 }); expect(await repository.findState(workspace.id, 4)).toMatchObject({ sessionId: state.sessionId, plan: [] }); database.close() })
  it('rolls back weekly callback, session plan, and timer when compound replanning fails', async () => { const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder }); const workspaces = new DrizzleWorkspaceRepository(database); const repository = new DrizzleStudyWorkspaceRepository(database); const workspace = await workspaces.create({ id: crypto.randomUUID(), name: 'Atomic', objective: 'Teste', createdAt: 1, updatedAt: 1 }); const state = { workspaceId: workspace.id, sessionId: crypto.randomUUID(), sessionStartedAt: 2, fileName: 'x', language: 'text', editorContent: '', notes: '', shareContextWithAi: false, timerDurationSeconds: 1500, timerRemainingSeconds: 1500, timerStatus: 'idle' as const, timerStartedAt: null, plan: [], updatedAt: 3, documentRevision: 0, notesRevision: 0, accumulatedFocusSeconds: 0 }; await repository.createState(state); await expect(repository.recalculatePlanAtomically(workspace.id, state.sessionId, () => { database.sqlite.prepare("INSERT INTO routine_notes (id,content,created_at) VALUES ('atomic','marker',1)").run(); throw new Error('fail') }, 4)).rejects.toThrow('fail'); expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM routine_notes WHERE id='atomic'").get()).toEqual({ count: 0 }); expect(await repository.findState(workspace.id, 5)).toMatchObject({ timerDurationSeconds: 1500, plan: [] }); database.close() })
  it('persists contextual planner actions and resolves them atomically', () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder })
    const repository = new DrizzlePlannerActionRepository(database)
    const action = repository.create({ id: crypto.randomUUID(), originMessageId: crypto.randomUUID(), label: 'Criar Workspace de C', contextVersion: 10, type: 'workspace.create', status: 'proposed', payload: { name: 'C', objective: 'Estudar C' }, result: null, createdAt: 10, resolvedAt: null }, 'action-key')
    expect(repository.listPending()[0]).toMatchObject({ id: action.id, label: 'Criar Workspace de C', contextVersion: 10 })
    expect(repository.claim(action.id, 11).status).toBe('applying')
    expect(() => repository.claim(action.id, 12)).toThrow('no longer pending')
    expect(repository.complete(action.id, 'applied', { id: 'c' }, 13)).toMatchObject({ status: 'applied', result: { id: 'c' } })
    database.close()
  })
  it('invalidates sibling decisions from the same message', () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder }); const repository = new DrizzlePlannerActionRepository(database); const messageId = crypto.randomUUID()
    const create = (label: string, key: string) => repository.create({ id: crypto.randomUUID(), originMessageId: messageId, label, contextVersion: 10, type: 'routine.add', status: 'proposed', payload: { content: label }, result: null, createdAt: 10, resolvedAt: null }, key)
    const first = create('Usar C', 'first'); const second = create('Usar ED', 'second'); repository.claim(first.id, 11); repository.complete(first.id, 'applied', { ok: true }, 12); repository.invalidateSiblings(messageId, first.id, 12)
    expect(repository.find(second.id)?.status).toBe('obsolete'); database.close()
  })
  it('stores unknown mastery as null', () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder })
    database.sqlite.prepare('INSERT INTO workspaces (id, name, objective, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('c', 'C', 'Estudar C', 1, 1)
    database.sqlite.prepare('INSERT INTO study_deadlines (id, workspace_id, title, due_at, estimated_minutes, mastery_percent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('d', 'c', 'Prova C', 2, 120, null, 1)
    expect(database.sqlite.prepare('SELECT mastery_percent AS masteryPercent FROM study_deadlines WHERE id = ?').get('d')).toEqual({ masteryPercent: null })
    database.close()
  })
  it('preserves learning path lifecycle and active roadmap after reopening SQLite', async () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder }); const workspaces = new DrizzleWorkspaceRepository(database); const workspace = await workspaces.create({ id: crypto.randomUUID(), name: 'C', objective: 'Aprender C', createdAt: 1, updatedAt: 1 }); const repository = new DrizzleRoadmapRepository(database); repository.setLearningPathState({ workspaceId: workspace.id, status: 'waiting_for_provider', activeRoadmapId: null, lastAttemptAt: 2, retryAfter: 302000, lastErrorCode: 'PROVIDER_UNAVAILABLE', updatedAt: 2 }); const path = { id: crypto.randomUUID(), workspaceId: workspace.id, title: 'Trilha C', status: 'accepted' as const, generationKind: 'ai_generated' as const, version: 1, providerId: 'test', modelId: 'test', createdAt: 3, updatedAt: 3, modules: [{ id: crypto.randomUUID(), title: 'Tipos e compilação', objective: 'Compilar', estimatedMinutes: 60, position: 1, status: 'active' as const, topics: ['gcc', 'tipos'], outcomes: ['Compilar'], practice: 'Programa C', completionCriteria: ['Sem erros'], resources: [] }, { id: crypto.randomUUID(), title: 'Ponteiros', objective: 'Usar endereços', estimatedMinutes: 90, position: 2, status: 'locked' as const, topics: ['endereços', 'arrays'], outcomes: ['Explicar ponteiros'], practice: 'Vetor', completionCriteria: ['Sem acesso inválido'], resources: [] }] }; repository.activate(path); const databasePath = database.path; database.close(); const reopened = openCoachDatabase({ databasePath, migrationsFolder }); const restored = new DrizzleRoadmapRepository(reopened); expect(restored.getLearningPathState(workspace.id)).toMatchObject({ status: 'ready', activeRoadmapId: path.id, retryAfter: null }); expect(restored.findCurrent(workspace.id)?.id).toBe(path.id); reopened.close()
  })
  it('runs Workspace C through a persisted roadmap, real topic selection, and JIT lesson content', async () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder })
    const workspaceRepository = new DrizzleWorkspaceRepository(database)
    const roadmapRepository = new DrizzleRoadmapRepository(database)
    const lessonRepository = new SqliteStudyLessonRepository(database)
    const providers = new AIProviderManager()
    const calls: string[] = []
    const sendMessage: AIProvider['sendMessage'] = async (request) => {
      calls.push(request.messages[0]?.content ?? '')
      if (calls.length === 1) return { content: JSON.stringify({ title: 'Programação em C', modules: [{ title: 'Tipos, expressões e controle', objective: 'Escrever programas C determinísticos', estimatedMinutes: 120, topics: ['tipos inteiros e conversões', 'if, switch e laços'], outcomes: ['Compilar programas com fluxo correto'], practice: 'Construir um conversor de unidades com validação', completionCriteria: ['Compilar sem warnings'], sourceIds: [] }, { title: 'Funções, arrays e memória', objective: 'Modelar dados e memória explicitamente', estimatedMinutes: 180, topics: ['funções e passagem de parâmetros', 'arrays e aritmética de ponteiros', 'malloc, realloc e free', 'structs e composição de dados'], outcomes: ['Gerenciar memória sem vazamentos'], practice: 'Implementar um vetor dinâmico de structs', completionCriteria: ['Liberar toda memória alocada'], sourceIds: [] }] }), providerId: 'openai-compatible', modelId: 'codex/gpt-5.6-sol' }
      const topicId = JSON.parse(request.messages[1]!.content).topicId as string
      const topic = 'tipos inteiros e conversões'
      const blocks: StudyLessonBlock[] = [
        { id: `${topicId}:model`, type: 'explanation', title: 'Representação de tipos inteiros', content: 'Tipos inteiros em C definem largura, sinal e intervalo representável; conversões seguem regras explícitas.' },
        { id: `${topicId}:promotion`, type: 'explanation', title: 'Promoções inteiras', content: 'Antes de muitas operações, char e short sofrem promoção para int, afetando tipos inteiros e conversões.' },
        { id: `${topicId}:analogy`, type: 'analogy', title: 'Intervalos como recipientes', content: 'Cada tipo inteiro é um recipiente com limite; uma conversão pode descartar bits que não cabem.' },
        { id: `${topicId}:code`, type: 'codeExample', title: 'Conversão observável em C', language: 'c', code: '#include <stdio.h>\nint main(void) { unsigned int u = 300u; unsigned char c = (unsigned char)u; printf("%u\\n", (unsigned)c); return 0; }', expectedOutput: '44', walkthrough: ['300 não cabe em oito bits.', 'A conversão conserva o resto no intervalo de unsigned char.', 'O cast para unsigned torna a impressão compatível.'] },
        { id: `${topicId}:interactive`, type: 'interactiveCode', title: 'Execute a conversão', interactionType: 'EDIT_AND_RUN', language: 'c', instruction: 'Altere o valor e execute.', initialCode: '#include <stdio.h>\nint main(void) { printf("44\\n"); return 0; }', predictionPrompt: null, evidenceMode: 'observation', requiredForTopicCompletion: false, expectedOutput: null },
        { id: `${topicId}:warning`, type: 'warning', title: 'Conversão com sinal', content: 'Misturar signed e unsigned pode converter um valor negativo para um inteiro positivo grande.' },
        { id: `${topicId}:compare`, type: 'comparison', title: 'Conversão implícita e cast', content: 'A conversão implícita segue o contexto; o cast documenta a intenção, mas não impede perda de informação.' },
        { id: `${topicId}:check-range`, type: 'checkpoint', questionType: 'multiple_choice', title: 'Verifique o intervalo', question: `Qual cuidado é central em ${topic}?`, options: [{ id: 'option-0', text: 'Verificar se o valor cabe no tipo de destino', rationale: 'Esta é a alternativa correta porque corresponde ao comportamento descrito.' }, { id: 'option-1', text: 'Ignorar largura e sinal', rationale: 'intervalos de tipos inteiros', misconceptionTag: 'distractor-1' }, { id: 'option-2', text: 'O comportamento seria sempre indefinido', rationale: 'Esta alternativa não corresponde ao comportamento avaliado.', misconceptionTag: 'distractor-2' }, { id: 'option-3', text: 'Uma condição diferente seria necessária', rationale: 'Esta alternativa não corresponde ao comportamento avaliado.', misconceptionTag: 'distractor-3' }, { id: 'option-4', text: 'Nenhuma mudança seria observada', rationale: 'Esta alternativa não corresponde ao comportamento avaliado.', misconceptionTag: 'distractor-4' }], correctOptionId: 'option-0', requiresJustification: true, hint: 'Compare origem e destino.', reinforcement: 'Revise os intervalos antes da conversão.' },
        { id: `${topicId}:check-signed`, type: 'checkpoint', questionType: 'multiple_choice', title: 'Mistura de sinais', question: `O que pode ocorrer em ${topic} ao comparar -1 com unsigned?`, options: [{ id: 'option-0', text: 'O negativo pode ser convertido para unsigned', rationale: 'Esta é a alternativa correta porque corresponde ao comportamento descrito.' }, { id: 'option-1', text: 'O compilador sempre rejeita', rationale: 'conversão usual aritmética', misconceptionTag: 'distractor-1' }, { id: 'option-2', text: 'O comportamento seria sempre indefinido', rationale: 'Esta alternativa não corresponde ao comportamento avaliado.', misconceptionTag: 'distractor-2' }, { id: 'option-3', text: 'Uma condição diferente seria necessária', rationale: 'Esta alternativa não corresponde ao comportamento avaliado.', misconceptionTag: 'distractor-3' }, { id: 'option-4', text: 'Nenhuma mudança seria observada', rationale: 'Esta alternativa não corresponde ao comportamento avaliado.', misconceptionTag: 'distractor-4' }], correctOptionId: 'option-0', requiresJustification: true, hint: 'Observe o tipo comum da comparação.', reinforcement: 'A conversão para unsigned pode produzir valor positivo grande.' },
        { id: `${topicId}:exercise`, type: 'miniExercise', title: 'Teste limites', instruction: `Escreva um programa de ${topic} que teste valores nos limites de unsigned char.`, nextAction: 'PRACTICE' },
      ]
      return { content: JSON.stringify({ title: `Aula de ${topic}`, level: 'basic', objective: `Aplicar ${topic} sem perda inesperada.`, blocks, usedSourceIds: [] }), providerId: 'openai-compatible', modelId: 'codex/gpt-5.6-sol' }
    }
    providers.register({ id: 'omniroute-mock', name: 'OmniRoute compatible', testConnection: async () => {}, getCapabilities: () => ({ streaming: false, usageInformation: false, supportedInput: ['text'] }), sendMessage })
    providers.select('omniroute-mock')
    providers.setRoute('roadmap', 'omniroute-mock')
    providers.setRoute('lesson', 'omniroute-mock')
    const roadmapService = new RoadmapService(roadmapRepository, providers, (id) => workspaceRepository.findById(id), undefined, new CurriculumSourceService({ retrieve: async (source) => source }))
    const workspaceService = new WorkspaceService({ repository: workspaceRepository, createId: () => crypto.randomUUID() })
    workspaceService.setLearningPathEnsurer((id) => roadmapService.ensureLearningPath(id))
    const workspace = await workspaceService.create({ name: 'C', objective: 'Aprender programação em C' })
    const state = await roadmapService.ensureLearningPath(workspace.id)
    const roadmap = await roadmapService.get(workspace.id)
    expect(state).toMatchObject({ status: 'ready', activeRoadmapId: roadmap?.id })
    expect(roadmap?.modules.every((module) => module.topics.length > 0)).toBe(true)
    const module = roadmap!.modules[0]!
    const topicId = `${module.id}:${module.topics[0]}`
    const lessonResult = await new StudyLessonService(lessonRepository, providers, (id) => workspaceRepository.findById(id), (id) => roadmapRepository.findCurrent(id)).getOrCreate({ workspaceId: workspace.id, roadmapId: roadmap!.id, moduleId: module.id, topicId })
    expect(lessonResult.status).toBe('ready')
    if (lessonResult.status !== 'ready') throw new Error('Lesson did not become ready')
    expect(lessonResult.lesson.topicId).toBe(topicId)
    expect(lessonResult.lesson.generationKind).toBe('ai_generated')
    expect(lessonResult.lesson.blocks.some((block) => block.type === 'codeExample' && block.language === 'c')).toBe(true)
    expect(lessonResult.lesson.blocks.some((block) => JSON.stringify(block).includes('tipos inteiros'))).toBe(true)
    const now = Date.now()
    database.sqlite.prepare('INSERT INTO study_progress (workspace_id, roadmap_id, current_module_id, current_topic_id, current_lesson_id, current_checkpoint_id, topic_statuses_json, lesson_positions_json, checkpoint_states_json, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)').run(workspace.id, roadmap!.id, module.id, topicId, lessonResult.lesson.id, JSON.stringify({ [topicId]: 'IN_PROGRESS' }), '{}', '{}', now)
    expect(database.sqlite.prepare('SELECT roadmap_id AS roadmapId, current_module_id AS moduleId, current_topic_id AS topicId, current_lesson_id AS lessonId FROM study_progress WHERE workspace_id = ?').get(workspace.id)).toEqual({ roadmapId: roadmap!.id, moduleId: module.id, topicId, lessonId: lessonResult.lesson.id })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM study_lessons WHERE workspace_id = ?').get(workspace.id)).toEqual({ count: 1 })
    expect(calls).toHaveLength(2)
    database.close()
  })
  it('rejects activation of a roadmap without usable modules and topics', async () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder })
    const workspaces = new DrizzleWorkspaceRepository(database)
    const workspace = await workspaces.create({ id: crypto.randomUUID(), name: 'C', objective: 'Aprender C', createdAt: 1, updatedAt: 1 })
    const repository = new DrizzleRoadmapRepository(database)
    expect(() => repository.activate({ id: crypto.randomUUID(), workspaceId: workspace.id, title: 'Inválida', status: 'accepted', generationKind: 'ai_generated', version: 1, providerId: 'test', modelId: 'test', modules: [], createdAt: 2, updatedAt: 2 })).toThrow('modules with topics')
    expect(repository.getLearningPathState(workspace.id)).toBeNull()
    database.close()
  })
  it('keeps a schema-compatible legacy lesson available', async () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder })
    const workspace = await new DrizzleWorkspaceRepository(database).create({ id: crypto.randomUUID(), name: 'Python', objective: 'Aprender Python', createdAt: 1, updatedAt: 1 })
    const roadmapId = crypto.randomUUID()
    database.sqlite.prepare('INSERT INTO study_lessons (id, workspace_id, roadmap_id, module_id, topic_id, generation_kind, content_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('legacy-invalid', workspace.id, roadmapId, crypto.randomUUID(), 'topic', 'ai_generated', JSON.stringify({ title: 'Legacy', level: 'basic', objective: 'Legacy', blocks: [{ id: 'checkpoint', type: 'checkpoint', questionType: 'multiple_choice', title: 'Check', question: 'Qual?', options: [{ id: 'option-0', text: 'A', rationale: 'x', misconceptionTag: 'distractor-0' }, { id: 'option-1', text: 'B', rationale: 'Esta alternativa não corresponde ao comportamento avaliado.', misconceptionTag: 'distractor-1' }, { id: 'option-2', text: 'O comportamento seria sempre indefinido', rationale: 'Esta é a alternativa correta porque corresponde ao comportamento descrito.' }, { id: 'option-3', text: 'Uma condição diferente seria necessária', rationale: 'Esta alternativa não corresponde ao comportamento avaliado.', misconceptionTag: 'distractor-3' }, { id: 'option-4', text: 'Nenhuma mudança seria observada', rationale: 'Esta alternativa não corresponde ao comportamento avaliado.', misconceptionTag: 'distractor-4' }], correctOptionId: 'option-2', requiresJustification: true, hint: 'h', reinforcement: 'r' }, { id: 'a', type: 'explanation', title: 'A', content: 'A' }, { id: 'b', type: 'explanation', title: 'B', content: 'B' }, { id: 'c', type: 'explanation', title: 'C', content: 'C' }], sources: [] }), 1, 1)
    expect(new SqliteStudyLessonRepository(database).find(roadmapId, 'topic')).toMatchObject({ id: 'legacy-invalid', sources: [] })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM study_lessons WHERE id = ?').get('legacy-invalid')).toEqual({ count: 1 })
    database.close()
  })

  it('defaults legacy lesson sources and persists adaptations and preferences', async () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder }); const workspaces = new DrizzleWorkspaceRepository(database); const workspace = await workspaces.create({ id: crypto.randomUUID(), name: 'C', objective: 'Ponteiros', createdAt: 1, updatedAt: 1 }); const repository = new SqliteStudyLessonRepository(database); const roadmapId = crypto.randomUUID(); const moduleId = crypto.randomUUID(); const content = { title: 'Ponteiros', level: 'basic' as const, objective: 'Compreender endereços', blocks: Array.from({ length: 4 }, (_, index) => ({ id: `b${index}`, type: 'explanation' as const, title: `Bloco ${index}`, content: 'Conteúdo' })) }; database.sqlite.prepare('INSERT INTO study_lessons (id, workspace_id, roadmap_id, module_id, topic_id, generation_kind, content_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('lesson', workspace.id, roadmapId, moduleId, 'topic', 'ai_generated', JSON.stringify(content), 1, 1)
    const lesson = repository.find(roadmapId, 'topic')!; expect(lesson.sources).toEqual([]); const readBaseJson = () => (database.sqlite.prepare('SELECT content_json AS contentJson FROM study_lessons WHERE id = ?').get(lesson.id) as { contentJson: string }).contentJson; const baseJson = readBaseJson(); const baseBlock = lesson.blocks[0]!; if (!('content' in baseBlock)) throw new Error('Expected text block'); const adapted = { ...baseBlock, content: 'Mais simples' }; const first = repository.createAdaptation({ id: 'adaptation-1', workspaceId: workspace.id, lessonId: lesson.id, blockId: adapted.id, reason: 'Simplifique', mode: 'SIMPLIFY', adaptedBlock: adapted, providerId: 'test', modelId: 'model', createdAt: 2 }); const second = repository.createAdaptation({ id: 'adaptation-2', workspaceId: workspace.id, lessonId: lesson.id, blockId: adapted.id, reason: 'Seja direto', mode: 'MORE_CONCISE', adaptedBlock: { ...adapted, content: 'Direto' }, providerId: 'test', modelId: 'model', createdAt: 3 }); expect(readBaseJson()).toBe(baseJson); expect(repository.find(roadmapId, 'topic')!.blocks[0]).toMatchObject({ content: 'Direto' }); expect(repository.listAdaptations(lesson.id, adapted.id)).toMatchObject([{ revision: 2, reason: 'Seja direto', isActive: true }, { revision: 1, reason: 'Simplifique', isActive: false }]); expect(repository.restoreOriginal(lesson.id, adapted.id).blocks[0]).toEqual(lesson.blocks[0]); expect(repository.listAdaptations(lesson.id, adapted.id)).toHaveLength(2); expect(repository.activateAdaptation(lesson.id, adapted.id, first.id).blocks[0]).toEqual(adapted); expect(repository.listAdaptations(lesson.id, adapted.id).filter((item) => item.isActive)).toHaveLength(1); expect(() => database.sqlite.prepare('UPDATE study_lesson_adaptations SET is_active = 1 WHERE id = ?').run(second.id)).toThrow(); expect(readBaseJson()).toBe(baseJson); expect(second.revision).toBe(2); expect(repository.getPreferences(workspace.id)).toEqual(studyPresentationPreferencesSchema.parse({})); const preference = studyPresentationPreferencesSchema.parse({ detail: 'concise', explanation: 'simple', examples: 'practical', evidence: [{ intent: 'ANALOGY', source: 'situational', topicId: 'topic', blockId: adapted.id }] }); expect(repository.setPreferences(workspace.id, preference, 4)).toEqual(preference); expect(repository.getPreferences(workspace.id)).toEqual(preference); expect(studyLessonContentSchema.parse(content).sources).toEqual([]); database.close()
  })
  it('reorders presentation locally while preserving assessment and executable contracts across reload', async () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder }); const workspace = await new DrizzleWorkspaceRepository(database).create({ id: crypto.randomUUID(), name: 'Python', objective: 'Decorators', createdAt: 1, updatedAt: 1 }); const repository = new SqliteStudyLessonRepository(database); const roadmapId = crypto.randomUUID(); const moduleId = crypto.randomUUID(); const checkpoint = { id: 'check', type: 'checkpoint' as const, questionType: 'multiple_choice' as const, title: 'Check', question: 'Qual?', options: Array.from({ length: 5 }, (_, index) => ({ id: `o${index}`, text: `Opção ${index}`, rationale: `Razão ${index}` })), correctOptionId: 'o2', requiresJustification: true, hint: 'Pense', reinforcement: 'Revise' }; const interactive = { id: 'run', type: 'interactiveCode' as const, title: 'Execute', interactionType: 'EDIT_AND_RUN' as const, language: 'python' as const, instruction: 'Execute', initialCode: 'print(1)', predictionPrompt: null, evidenceMode: 'validated' as const, requiredForTopicCompletion: true, expectedOutput: '1' }; const exercise = { id: 'exercise', type: 'miniExercise' as const, title: 'Pratique', instruction: 'Implemente', nextAction: 'PRACTICE' as const }; const intro = { id: 'intro', type: 'explanation' as const, title: 'Introdução', content: 'Original' }; const blocks = [intro, { id: 'code', type: 'codeExample' as const, title: 'Código', code: 'print(1)', language: 'python', expectedOutput: '1', walkthrough: ['Execute'] }, checkpoint, interactive, exercise]; repository.create({ id: 'lesson-composition', workspaceId: workspace.id, roadmapId, moduleId, topicId: 'topic', generationKind: 'ai_generated', title: 'Aula', level: 'basic', objective: 'Aprender', blocks, sources: [], providerId: null, modelId: null, createdAt: 1 }); const beforeEvidence = database.sqlite.prepare('SELECT COUNT(*) AS count FROM learning_events WHERE workspace_id = ?').get(workspace.id); repository.createAdaptation({ id: 'code-first', workspaceId: workspace.id, lessonId: 'lesson-composition', blockId: 'intro', reason: 'Código primeiro', mode: 'CODE_FIRST', adaptedBlock: { ...intro, content: 'Apresentação adaptada' }, providerId: 'test', modelId: 'model', createdAt: 2 }); const reloaded = new SqliteStudyLessonRepository(database).find(roadmapId, 'topic')!; expect(reloaded.blocks.map((block) => block.id)).toEqual(['code', 'intro', 'check', 'run', 'exercise']); expect(reloaded.blocks.find((block) => block.id === 'check')).toEqual(checkpoint); expect(reloaded.blocks.find((block) => block.id === 'run')).toEqual(interactive); expect(reloaded.blocks.find((block) => block.id === 'exercise')).toEqual(exercise); expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM learning_events WHERE workspace_id = ?').get(workspace.id)).toEqual(beforeEvidence); expect(repository.restoreOriginal('lesson-composition', 'intro').blocks.map((block) => block.id)).toEqual(blocks.map((block) => block.id)); database.close()
  })
})
