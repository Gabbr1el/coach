import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openCoachDatabase } from '../../src/main/database/connection'
import { DrizzleReportRepository } from '../../src/main/repositories/drizzle-report-repository'
import { DrizzleStudyWorkspaceRepository } from '../../src/main/repositories/drizzle-study-workspace-repository'

const directories: string[] = []
const migrationsFolder = resolve('drizzle/migrations')

function createDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'coach-report-test-'))
  directories.push(directory)
  return openCoachDatabase({ databasePath: join(directory, 'coach.sqlite'), migrationsFolder })
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('DrizzleReportRepository', () => {
  it('keeps a workspace without evidence unevaluated', () => {
    const database = createDatabase()
    database.sqlite.prepare('INSERT INTO workspaces (id, name, objective, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('workspace-empty', 'Workspace novo', 'Começar', 1, 1)

    const report = new DrizzleReportRepository(database, () => 10_000).getGlobalOverview()

    expect(report.averageSuccessRate).toBeNull()
    expect(report.totalFocusSeconds).toBe(0)
    expect(report.workspaces).toEqual([
      expect.objectContaining({
        workspaceId: 'workspace-empty',
        successRate: null,
        activity: expect.objectContaining({ focusSeconds: 0, currentSessionFocusSeconds: 0 }),
        performance: expect.objectContaining({ checkpointsAnswered: 0, assessedSuccessRate: null }),
        domain: expect.objectContaining({ assessedTopics: 0, averageMastery: null, confidence: 'not_assessed' }),
        retention: { status: 'not_evaluated', score: null, evidenceCount: 0, lastEvidenceAt: null },
        evidence: expect.objectContaining({ lastLearningEvidenceAt: null }),
        recommendations: [],
      }),
    ])
    expect(new DrizzleStudyWorkspaceRepository(database).listSessionHistory('workspace-empty', 100)).toEqual([])
    database.close()
  })

  it('derives learning metrics and recommendations only from recorded evidence', () => {
    const database = createDatabase()
    const sqlite = database.sqlite
    sqlite.prepare('INSERT INTO workspaces (id, name, objective, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('workspace-evidence', 'Algoritmos', 'Aprender listas', 1, 1)
    sqlite.prepare("INSERT INTO study_sessions (id, workspace_id, status, started_at, ended_at, focus_seconds) VALUES (?, ?, 'completed', ?, ?, ?)").run('session-completed', 'workspace-evidence', 10_000, 11_000, 600)
    sqlite.prepare("INSERT INTO study_sessions (id, workspace_id, status, started_at, focus_seconds) VALUES (?, ?, 'active', ?, 0)").run('session-active', 'workspace-evidence', 90_000)
    sqlite.prepare("INSERT INTO workspace_study_states (workspace_id, active_session_id, file_name, language, editor_content, notes, share_context_with_ai, timer_duration_seconds, timer_remaining_seconds, timer_status, timer_started_at, updated_at, document_revision, notes_revision, accumulated_focus_seconds) VALUES (?, ?, 'main.py', 'python', '', '', 0, 1500, 100, 'running', 95000, 95000, 0, 0, 30)").run('workspace-evidence', 'session-active')
    sqlite.prepare("INSERT INTO learning_events (id, workspace_id, session_id, type, payload_json, created_at) VALUES (?, ?, ?, 'code_executed', ?, ?)").run('execution-ok', 'workspace-evidence', 'session-completed', JSON.stringify({ exitCode: 0 }), 10_100)
    for (let index = 0; index < 3; index++) sqlite.prepare("INSERT INTO learning_events (id, workspace_id, session_id, type, payload_json, created_at) VALUES (?, ?, ?, 'window_blurred', '{}', ?)").run(`blur-${index}`, 'workspace-evidence', 'session-completed', 10_200 + index)
    sqlite.prepare("INSERT INTO study_plan_items (id, workspace_id, session_id, title, duration_minutes, position, status, topic_id, activity_type, created_at, updated_at) VALUES (?, ?, ?, ?, 20, 1, 'active', ?, 'exercise', ?, ?)").run('plan-active', 'workspace-evidence', 'session-active', 'Praticar listas', 'topic-lists', 90_000, 90_000)
    sqlite.prepare("INSERT INTO study_progress (workspace_id, roadmap_id, current_module_id, current_topic_id, current_lesson_id, current_checkpoint_id, topic_statuses_json, lesson_positions_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)").run('workspace-evidence', 'roadmap-1', 'module-1', 'topic-lists', 'lesson-1', 'checkpoint-1', JSON.stringify({ 'lesson-1': { attempt: 4 } }), 96_000)
    sqlite.prepare("INSERT INTO topic_learning_states (workspace_id, topic_id, evidence_count, assessments, correct_first_try, correct_after_help, incorrect, hints_used, reinforcement_events, exercises_completed, lessons_completed, difficulty_level, mastery_estimate, confidence, needs_review, last_practiced_at, last_assessed_at, reasons_json, updated_at) VALUES (?, ?, 6, 3, 1, 1, 1, 1, 1, 1, 1, 'medium', 72, 'medium', 0, 94000, 96000, '[]', 96000)").run('workspace-evidence', 'topic-lists')
    sqlite.prepare("INSERT INTO conversation_threads (id, scope, workspace_id, title, created_at, updated_at) VALUES (?, 'workspace', ?, 'Algoritmos', ?, ?)").run('thread-1', 'workspace-evidence', 90_000, 90_000)
    sqlite.prepare("INSERT INTO conversation_messages (id, thread_id, role, content, created_at, sequence) VALUES (?, ?, 'user', 'Preciso de uma dica', ?, 1)").run('message-help', 'thread-1', 96_000)

    const report = new DrizzleReportRepository(database, () => 100_000).getGlobalOverview()
    const workspace = report.workspaces[0]

    expect(workspace).toBeDefined()
    expect(report.averageSuccessRate).toBe(67)
    expect(report.totalFocusSeconds).toBe(635)
    expect(workspace).toMatchObject({
      executions: 1,
      errors: 0,
      successRate: 67,
      activity: { focusSeconds: 635, sessionCount: 1, activeDays: 1, focusExits: 3, completedPlanItems: 0, currentSessionFocusSeconds: 35, currentSessionStartedAt: 90_000 },
      performance: { checkpointsAnswered: 3, correctFirstTry: 1, correctAfterHelp: 1, incorrect: 1, attempts: 4, hintsUsed: 1, reinforcementEvents: 1, assessedSuccessRate: 67 },
      domain: { assessedTopics: 1, masteredTopics: 1, needsReviewTopics: 0, averageMastery: 72, confidence: 'medium', lessonsCompleted: 1, exercisesCompleted: 1 },
      retention: { status: 'not_evaluated', score: null, evidenceCount: 0, lastEvidenceAt: null },
      evidence: { learningEvidenceCount: 6, lastLearningEvidenceAt: 96_000, coachHelpEvents: 1, planItemsPending: 0, planItemsActive: 1, activeTopicId: 'topic-lists' },
    })
    expect(workspace?.recommendations).toEqual([
      'Refaça os checkpoints com ajuda sem consultar a pista e compare as novas tentativas.',
      'Use um bloco de foco mais curto no próximo item do plano para reduzir interrupções.',
      'Continue o item ativo do plano enquanto a sessão de foco está em andamento.',
    ])
    expect(workspace?.domain.averageMastery).not.toBe(workspace?.executions)
    const daily = new DrizzleStudyWorkspaceRepository(database).listSessionHistory('workspace-evidence', 100)
    expect(daily[0]).toMatchObject({ successRate: 100, focusRetentionPercent: null, recommendation: 'Faça o próximo sprint em 15 minutos e elimine uma distração.' })
    database.close()
  })
})
