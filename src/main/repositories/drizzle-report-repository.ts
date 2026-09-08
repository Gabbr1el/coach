import type { ReportRepository } from '../../application/reports/report-service'
import type { GlobalReportOverview, ReportDomainMetrics, WorkspaceReportOverview } from '../../shared/contracts/report-contract'
import type { CoachDatabase } from '../database/connection'

type WorkspaceActivityRow = {
  workspaceId: string
  workspaceName: string
  focusSeconds: number
  sessionCount: number
  activeDays: number
  executions: number
  errors: number
  interventions: number
  focusExits: number
  completedPlanItems: number
}

type ActiveSessionRow = {
  workspaceId: string
  startedAt: number
  accumulatedFocusSeconds: number
  timerStatus: 'idle' | 'running' | 'paused'
  timerStartedAt: number | null
  timerRemainingSeconds: number
}

type LearningStateRow = {
  workspaceId: string
  evidenceCount: number
  assessments: number
  correctFirstTry: number
  correctAfterHelp: number
  incorrect: number
  hintsUsed: number
  reinforcementEvents: number
  exercisesCompleted: number
  lessonsCompleted: number
  masteryEstimate: number | null
  confidence: 'low' | 'medium' | 'high'
  needsReview: number
  lastPracticedAt: number | null
  lastAssessedAt: number | null
}

type PlanRow = {
  workspaceId: string
  pending: number
  active: number
}

type ProgressRow = {
  workspaceId: string
  activeTopicId: string | null
  lessonPositionsJson: string
}

const numeric = (value: number | null | undefined): number => value ?? 0

function currentFocusSeconds(row: ActiveSessionRow | undefined, now: number): number {
  if (!row) return 0
  if (row.timerStatus !== 'running' || row.timerStartedAt === null) return row.accumulatedFocusSeconds
  const elapsed = Math.max(0, Math.floor((now - row.timerStartedAt) / 1000))
  return row.accumulatedFocusSeconds + Math.min(row.timerRemainingSeconds, elapsed)
}

function confidenceFor(states: LearningStateRow[]): ReportDomainMetrics['confidence'] {
  const assessed = states.filter((state) => state.masteryEstimate !== null)
  if (assessed.length === 0) return 'not_assessed'
  if (assessed.some((state) => state.confidence === 'low')) return 'low'
  if (assessed.some((state) => state.confidence === 'medium')) return 'medium'
  return 'high'
}

function checkpointAttempts(progress: ProgressRow | undefined): number {
  if (!progress) return 0
  try {
    const positions = JSON.parse(progress.lessonPositionsJson) as Record<string, { attempt?: unknown }>
    return Object.values(positions).reduce((sum, position) => sum + (typeof position.attempt === 'number' && position.attempt > 0 ? position.attempt : 0), 0)
  } catch {
    return 0
  }
}

function recommendationsFor(input: {
  states: LearningStateRow[]
  incorrect: number
  hintsUsed: number
  reinforcementEvents: number
  focusExits: number
  currentFocusSeconds: number
  planPending: number
  planActive: number
}): string[] {
  const recommendations: string[] = []
  const reviewCount = input.states.filter((state) => Boolean(state.needsReview)).length
  if (reviewCount > 0) recommendations.push(`Revise ${reviewCount === 1 ? 'o tópico sinalizado' : `os ${reviewCount} tópicos sinalizados`} antes de avançar.`)
  if (input.incorrect > 0 && input.hintsUsed + input.reinforcementEvents > 0) recommendations.push('Refaça os checkpoints com ajuda sem consultar a pista e compare as novas tentativas.')
  else if (input.incorrect > 0) recommendations.push('Revise os conceitos dos checkpoints incorretos e faça uma nova tentativa.')
  if (input.focusExits >= 3) recommendations.push('Use um bloco de foco mais curto no próximo item do plano para reduzir interrupções.')
  if (input.currentFocusSeconds > 0 && input.planActive > 0) recommendations.push('Continue o item ativo do plano enquanto a sessão de foco está em andamento.')
  else if (input.planPending > 0 && input.states.some((state) => state.evidenceCount > 0)) recommendations.push('Retome o próximo item pendente do plano para coletar nova evidência de aprendizagem.')
  return recommendations
}

export class DrizzleReportRepository implements ReportRepository {
  constructor(private readonly database: CoachDatabase, private readonly now: () => number = Date.now) {}

  getGlobalOverview(): GlobalReportOverview {
    const activityRows = this.database.sqlite.prepare(`
      SELECT
        w.id AS workspaceId,
        w.name AS workspaceName,
        COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.focus_seconds ELSE 0 END), 0) AS focusSeconds,
        COALESCE(SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END), 0) AS sessionCount,
        COUNT(DISTINCT CASE WHEN s.status = 'completed' THEN date(s.started_at / 1000, 'unixepoch', 'localtime') END) AS activeDays,
        COALESCE(SUM((SELECT COUNT(*) FROM learning_events e WHERE e.session_id = s.id AND e.type IN ('code_executed','execution_error'))), 0) AS executions,
        COALESCE(SUM((SELECT COUNT(*) FROM learning_events e WHERE e.session_id = s.id AND e.type = 'execution_error')), 0) AS errors,
        COALESCE(SUM((SELECT COUNT(*) FROM learning_events e WHERE e.session_id = s.id AND e.type = 'possible_learning_loop')), 0) AS interventions,
        COALESCE(SUM((SELECT COUNT(*) FROM learning_events e WHERE e.session_id = s.id AND e.type = 'window_blurred')), 0) AS focusExits,
        COALESCE(SUM((SELECT COUNT(*) FROM study_plan_items p WHERE p.session_id = s.id AND p.status = 'completed')), 0) AS completedPlanItems
      FROM workspaces w
      LEFT JOIN study_sessions s ON s.workspace_id = w.id
      WHERE w.status = 'active'
      GROUP BY w.id
      ORDER BY focusSeconds DESC, w.name
    `).all() as WorkspaceActivityRow[]
    const activeSessions = this.database.sqlite.prepare(`
      SELECT s.workspace_id AS workspaceId, s.started_at AS startedAt,
        state.accumulated_focus_seconds AS accumulatedFocusSeconds,
        state.timer_status AS timerStatus, state.timer_started_at AS timerStartedAt,
        state.timer_remaining_seconds AS timerRemainingSeconds
      FROM study_sessions s
      JOIN workspace_study_states state ON state.active_session_id = s.id
      WHERE s.status = 'active'
    `).all() as ActiveSessionRow[]
    const learningStates = this.database.sqlite.prepare(`
      SELECT workspace_id AS workspaceId, evidence_count AS evidenceCount, assessments,
        correct_first_try AS correctFirstTry, correct_after_help AS correctAfterHelp,
        incorrect, hints_used AS hintsUsed, reinforcement_events AS reinforcementEvents,
        exercises_completed AS exercisesCompleted, lessons_completed AS lessonsCompleted,
        mastery_estimate AS masteryEstimate, confidence, needs_review AS needsReview,
        last_practiced_at AS lastPracticedAt, last_assessed_at AS lastAssessedAt
      FROM topic_learning_states
    `).all() as LearningStateRow[]
    const plans = this.database.sqlite.prepare(`
      SELECT workspace_id AS workspaceId,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
      FROM study_plan_items
      GROUP BY workspace_id
    `).all() as PlanRow[]
    const progress = this.database.sqlite.prepare(`
      SELECT workspace_id AS workspaceId, current_topic_id AS activeTopicId,
        lesson_positions_json AS lessonPositionsJson
      FROM study_progress
    `).all() as ProgressRow[]
    const coachHelp = this.database.sqlite.prepare(`
      SELECT t.workspace_id AS workspaceId, COUNT(*) AS count
      FROM conversation_messages m
      JOIN conversation_threads t ON t.id = m.thread_id
      WHERE t.scope = 'workspace' AND m.role = 'user'
        AND (lower(m.content) GLOB '*ajud*' OR lower(m.content) GLOB '*dica*' OR lower(m.content) GLOB '*não entendi*' OR lower(m.content) GLOB '*nao entendi*')
      GROUP BY t.workspace_id
    `).all() as Array<{ workspaceId: string; count: number }>
    const activeByWorkspace = new Map(activeSessions.map((row) => [row.workspaceId, row]))
    const statesByWorkspace = new Map<string, LearningStateRow[]>()
    for (const state of learningStates) statesByWorkspace.set(state.workspaceId, [...(statesByWorkspace.get(state.workspaceId) ?? []), state])
    const planByWorkspace = new Map(plans.map((row) => [row.workspaceId, row]))
    const progressByWorkspace = new Map(progress.map((row) => [row.workspaceId, row]))
    const helpByWorkspace = new Map(coachHelp.map((row) => [row.workspaceId, row.count]))
    const now = this.now()
    const workspaces: WorkspaceReportOverview[] = activityRows.map((row) => {
      const states = statesByWorkspace.get(row.workspaceId) ?? []
      const activeSession = activeByWorkspace.get(row.workspaceId)
      const activeFocusSeconds = currentFocusSeconds(activeSession, now)
      const plan = planByWorkspace.get(row.workspaceId)
      const workspaceProgress = progressByWorkspace.get(row.workspaceId)
      const checkpointsAnswered = states.reduce((sum, state) => sum + state.assessments, 0)
      const correctFirstTry = states.reduce((sum, state) => sum + state.correctFirstTry, 0)
      const correctAfterHelp = states.reduce((sum, state) => sum + state.correctAfterHelp, 0)
      const incorrect = states.reduce((sum, state) => sum + state.incorrect, 0)
      const assessedSuccessRate = checkpointsAnswered > 0 ? Math.round((correctFirstTry + correctAfterHelp) / checkpointsAnswered * 100) : null
      const masteryValues = states.flatMap((state) => state.masteryEstimate === null ? [] : [state.masteryEstimate])
      const averageMastery = masteryValues.length > 0 ? Math.round(masteryValues.reduce((sum, value) => sum + value, 0) / masteryValues.length) : null
      const lastEvidenceAt = states.reduce<number | null>((latest, state) => {
        const timestamp = Math.max(state.lastPracticedAt ?? 0, state.lastAssessedAt ?? 0)
        return timestamp > (latest ?? 0) ? timestamp : latest
      }, null)
      const hintsUsed = states.reduce((sum, state) => sum + state.hintsUsed, 0)
      const reinforcementEvents = states.reduce((sum, state) => sum + state.reinforcementEvents, 0)
      const recommendations = recommendationsFor({ states, incorrect, hintsUsed, reinforcementEvents, focusExits: row.focusExits, currentFocusSeconds: activeFocusSeconds, planPending: numeric(plan?.pending), planActive: numeric(plan?.active) })
      return {
        ...row,
        focusSeconds: row.focusSeconds + activeFocusSeconds,
        successRate: assessedSuccessRate,
        activity: { focusSeconds: row.focusSeconds + activeFocusSeconds, sessionCount: row.sessionCount, activeDays: row.activeDays, focusExits: row.focusExits, completedPlanItems: row.completedPlanItems, currentSessionFocusSeconds: activeFocusSeconds, currentSessionStartedAt: activeSession?.startedAt ?? null },
        performance: { checkpointsAnswered, correctFirstTry, correctAfterHelp, incorrect, attempts: Math.max(checkpointsAnswered, checkpointAttempts(workspaceProgress)), hintsUsed, reinforcementEvents, assessedSuccessRate },
        domain: { assessedTopics: masteryValues.length, masteredTopics: states.filter((state) => state.masteryEstimate !== null && state.masteryEstimate >= 70 && !state.needsReview).length, needsReviewTopics: states.filter((state) => Boolean(state.needsReview)).length, averageMastery, confidence: confidenceFor(states), lessonsCompleted: states.reduce((sum, state) => sum + state.lessonsCompleted, 0), exercisesCompleted: states.reduce((sum, state) => sum + state.exercisesCompleted, 0) },
        retention: { status: 'not_evaluated', score: null, evidenceCount: 0, lastEvidenceAt: null },
        evidence: { learningEvidenceCount: states.reduce((sum, state) => sum + state.evidenceCount, 0), lastLearningEvidenceAt: lastEvidenceAt, coachHelpEvents: helpByWorkspace.get(row.workspaceId) ?? 0, planItemsPending: numeric(plan?.pending), planItemsActive: numeric(plan?.active), activeTopicId: workspaceProgress?.activeTopicId ?? null },
        recommendations,
      }
    })
    const evaluatedRates = workspaces.flatMap((workspace) => workspace.successRate === null ? [] : [workspace.successRate])
    const completedDays = this.database.sqlite.prepare("SELECT DISTINCT date(started_at / 1000, 'unixepoch', 'localtime') AS day FROM study_sessions WHERE status = 'completed'").all() as Array<{ day: string }>
    return {
      totalFocusSeconds: workspaces.reduce((sum, workspace) => sum + workspace.focusSeconds, 0),
      totalSessions: workspaces.reduce((sum, workspace) => sum + workspace.sessionCount, 0),
      totalActiveDays: new Set(completedDays.map((row) => row.day)).size,
      averageSuccessRate: evaluatedRates.length > 0 ? Math.round(evaluatedRates.reduce((sum, rate) => sum + rate, 0) / evaluatedRates.length) : null,
      workspaces,
    }
  }
}
