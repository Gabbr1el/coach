import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { openCoachDatabase } from '../../src/main/database/connection'
import { CURRENT_MIGRATION_COUNT, validateCoachDatabaseSchema } from '../../src/main/database/restore-recovery'
import { repairInteractiveCodeStateSchema } from '../../src/main/database/migrate'
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

const temporaryDirectories: string[] = []
const migrationsFolder = resolve('drizzle/migrations')

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
    validateCoachDatabaseSchema(database.sqlite)
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
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: CURRENT_MIGRATION_COUNT })
    validateCoachDatabaseSchema(database.sqlite)
    database.close()
  })

  it('repairs the unpublished draft adaptive schema without deleting existing data', () => {
    const databasePath = createDatabasePath()
    let database = openCoachDatabase({ databasePath, migrationsFolder })
    database.sqlite.exec('DROP INDEX study_lesson_adaptations_one_active; DROP INDEX study_lesson_adaptations_revision_unique; DROP INDEX study_lesson_adaptations_lesson_block_idx; DROP TABLE study_lesson_adaptations; CREATE TABLE study_lesson_adaptations (id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, lesson_id text NOT NULL, block_id text NOT NULL, instruction text NOT NULL, original_block_json text NOT NULL, adapted_block_json text NOT NULL, provider_id text, model_id text, created_at integer NOT NULL, restored_at integer);')
    database.close()

    database = openCoachDatabase({ databasePath, migrationsFolder })
    expect((database.sqlite.pragma('table_info(study_lesson_adaptations)') as Array<{ name: string }>).map((column) => column.name)).toEqual(['id', 'workspace_id', 'lesson_id', 'source_block_id', 'revision', 'reason', 'mode', 'adapted_block_json', 'is_active', 'provider_id', 'model_id', 'created_at'])
    validateCoachDatabaseSchema(database.sqlite)
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
      { name: 'academic_subject_contexts' },
      { name: 'conversation_messages' },
      { name: 'conversation_threads' },
      { name: 'exercise_attempts' },
      { name: 'exercise_progress' },
      { name: 'exercise_sets' },
      { name: 'exercises' },
      { name: 'learning_events' },
      { name: 'material_chunks' },
      { name: 'materials' },
      { name: 'planner_actions' },
      { name: 'project_builds' },
      { name: 'project_files' },
      { name: 'project_ui_states' },
      { name: 'provider_configurations' },
      { name: 'roadmap_adaptations' },
      { name: 'roadmap_modules' },
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
      { name: 'workspace_academic_contexts' },
      { name: 'workspace_learning_path_state' },
      { name: 'workspace_memories' },
      { name: 'workspace_projects' },
      { name: 'workspace_study_preferences' },
      { name: 'workspace_study_states' },
      { name: 'workspaces' },
    ])
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: CURRENT_MIGRATION_COUNT })
    expect(() => validateCoachDatabaseSchema(sqlite)).not.toThrow()
    database.close()
  })

  it('persists public exercise metadata and reloadable progress without private results', () => {
    const databasePath = createDatabasePath()
    let database = openCoachDatabase({ databasePath, migrationsFolder })
    const workspaceId = crypto.randomUUID()
    database.sqlite.prepare("INSERT INTO workspaces (id,name,objective,status,created_at,updated_at) VALUES (?,'Python','Laços','active',1,1)").run(workspaceId)
    database.sqlite.prepare("INSERT INTO exercise_sets (id,workspace_id,roadmap_id,module_id,topic_id,lesson_id,status,generation_attempts,created_at,updated_at) VALUES ('set',?,'roadmap','module','module:loops','lesson','ready',1,1,1)").run(workspaceId)
    database.sqlite.prepare("INSERT INTO exercises (id,set_id,position,kind,difficulty,title,statement,input_description,output_description,language,starter_code,prediction_prompt,code_to_observe,required_for_topic_completion,public_tests_json,private_tests_json,reference_solution,expected_prediction,hint,created_at) VALUES ('exercise','set',1,'COMPLETE_CODE','introductory','Somar','Some','Dois inteiros','Soma','python','print(0) # TODO',NULL,NULL,1,?,?,?,NULL,'Pense na operação',1)").run(JSON.stringify([{ id: 'public-1', input: '1 2', expectedOutput: '3' }]), JSON.stringify([{ id: 'hidden-secret', input: '99 1', expectedOutput: '100' }]), 'secret solution')
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
  it('quarantines an incompatible legacy lesson so it can be regenerated', async () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder })
    const workspace = await new DrizzleWorkspaceRepository(database).create({ id: crypto.randomUUID(), name: 'Python', objective: 'Aprender Python', createdAt: 1, updatedAt: 1 })
    const roadmapId = crypto.randomUUID()
    database.sqlite.prepare('INSERT INTO study_lessons (id, workspace_id, roadmap_id, module_id, topic_id, generation_kind, content_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('legacy-invalid', workspace.id, roadmapId, crypto.randomUUID(), 'topic', 'ai_generated', JSON.stringify({ title: 'Legacy', level: 'basic', objective: 'Legacy', blocks: [{ id: 'checkpoint', type: 'checkpoint', questionType: 'multiple_choice', title: 'Check', question: 'Qual?', options: [{ id: 'option-0', text: 'A', rationale: 'x', misconceptionTag: 'distractor-0' }, { id: 'option-1', text: 'B', rationale: 'Esta alternativa não corresponde ao comportamento avaliado.', misconceptionTag: 'distractor-1' }, { id: 'option-2', text: 'O comportamento seria sempre indefinido', rationale: 'Esta é a alternativa correta porque corresponde ao comportamento descrito.' }, { id: 'option-3', text: 'Uma condição diferente seria necessária', rationale: 'Esta alternativa não corresponde ao comportamento avaliado.', misconceptionTag: 'distractor-3' }, { id: 'option-4', text: 'Nenhuma mudança seria observada', rationale: 'Esta alternativa não corresponde ao comportamento avaliado.', misconceptionTag: 'distractor-4' }], correctOptionId: 'option-2', requiresJustification: true, hint: 'h', reinforcement: 'r' }, { id: 'a', type: 'explanation', title: 'A', content: 'A' }, { id: 'b', type: 'explanation', title: 'B', content: 'B' }, { id: 'c', type: 'explanation', title: 'C', content: 'C' }], sources: [] }), 1, 1)
    expect(new SqliteStudyLessonRepository(database).find(roadmapId, 'topic')).toBeNull()
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM study_lessons WHERE id = ?').get('legacy-invalid')).toEqual({ count: 0 })
    database.close()
  })

  it('defaults legacy lesson sources and persists adaptations and preferences', async () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder }); const workspaces = new DrizzleWorkspaceRepository(database); const workspace = await workspaces.create({ id: crypto.randomUUID(), name: 'C', objective: 'Ponteiros', createdAt: 1, updatedAt: 1 }); const repository = new SqliteStudyLessonRepository(database); const roadmapId = crypto.randomUUID(); const moduleId = crypto.randomUUID(); const content = { title: 'Ponteiros', level: 'basic' as const, objective: 'Compreender endereços', blocks: Array.from({ length: 4 }, (_, index) => ({ id: `b${index}`, type: 'explanation' as const, title: `Bloco ${index}`, content: 'Conteúdo' })) }; database.sqlite.prepare('INSERT INTO study_lessons (id, workspace_id, roadmap_id, module_id, topic_id, generation_kind, content_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('lesson', workspace.id, roadmapId, moduleId, 'topic', 'ai_generated', JSON.stringify(content), 1, 1)
    const lesson = repository.find(roadmapId, 'topic')!; expect(lesson.sources).toEqual([]); const readBaseJson = () => (database.sqlite.prepare('SELECT content_json AS contentJson FROM study_lessons WHERE id = ?').get(lesson.id) as { contentJson: string }).contentJson; const baseJson = readBaseJson(); const baseBlock = lesson.blocks[0]!; if (!('content' in baseBlock)) throw new Error('Expected text block'); const adapted = { ...baseBlock, content: 'Mais simples' }; const first = repository.createAdaptation({ id: 'adaptation-1', workspaceId: workspace.id, lessonId: lesson.id, blockId: adapted.id, reason: 'Simplifique', mode: 'SIMPLIFY', adaptedBlock: adapted, providerId: 'test', modelId: 'model', createdAt: 2 }); const second = repository.createAdaptation({ id: 'adaptation-2', workspaceId: workspace.id, lessonId: lesson.id, blockId: adapted.id, reason: 'Seja direto', mode: 'MORE_CONCISE', adaptedBlock: { ...adapted, content: 'Direto' }, providerId: 'test', modelId: 'model', createdAt: 3 }); expect(readBaseJson()).toBe(baseJson); expect(repository.find(roadmapId, 'topic')!.blocks[0]).toMatchObject({ content: 'Direto' }); expect(repository.listAdaptations(lesson.id, adapted.id)).toMatchObject([{ revision: 2, reason: 'Seja direto', isActive: true }, { revision: 1, reason: 'Simplifique', isActive: false }]); expect(repository.restoreOriginal(lesson.id, adapted.id).blocks[0]).toEqual(lesson.blocks[0]); expect(repository.listAdaptations(lesson.id, adapted.id)).toHaveLength(2); expect(repository.activateAdaptation(lesson.id, adapted.id, first.id).blocks[0]).toEqual(adapted); expect(repository.listAdaptations(lesson.id, adapted.id).filter((item) => item.isActive)).toHaveLength(1); expect(() => database.sqlite.prepare('UPDATE study_lesson_adaptations SET is_active = 1 WHERE id = ?').run(second.id)).toThrow(); expect(readBaseJson()).toBe(baseJson); expect(second.revision).toBe(2); expect(repository.getPreferences(workspace.id)).toEqual(studyPresentationPreferencesSchema.parse({})); const preference = studyPresentationPreferencesSchema.parse({ detail: 'concise', explanation: 'simple', examples: 'practical', evidence: [{ intent: 'ANALOGY', source: 'situational', topicId: 'topic', blockId: adapted.id }] }); expect(repository.setPreferences(workspace.id, preference, 4)).toEqual(preference); expect(repository.getPreferences(workspace.id)).toEqual(preference); expect(studyLessonContentSchema.parse(content).sources).toEqual([]); database.close()
  })
})
