import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerApplicationHandlers } from './ipc/application-handlers'
import { createMainWindow } from './windows/create-main-window'
import { openCoachDatabase, type CoachDatabase } from './database/connection'
import { WorkspaceService } from '../application/workspaces/workspace-service'
import { DrizzleWorkspaceRepository } from './repositories/drizzle-workspace-repository'
import { registerWorkspaceHandlers } from './ipc/workspace-handlers'
import { HomePlannerService } from '../application/conversations/home-planner-service'
import { HomeOrganizerService } from '../application/conversations/home-organizer-service'
import { DrizzleConversationRepository } from './repositories/drizzle-conversation-repository'
import { registerConversationHandlers } from './ipc/conversation-handlers'
import { AIProviderManager } from '../application/ai/ai-provider-manager'
import { ProviderConfigurationService } from '../application/ai/provider-configuration-service'
import { DrizzleProviderConfigurationRepository } from './repositories/drizzle-provider-configuration-repository'
import { ElectronCredentialVault } from './security/electron-credential-vault'
import { OpenAIProvider } from './providers/openai-provider'
import { OpenAICompatibleProvider } from './providers/openai-compatible-provider'
import { registerProviderHandlers } from './ipc/provider-handlers'
import { WorkspaceCoachService } from '../application/conversations/workspace-coach-service'
import { StudyWorkspaceService } from '../application/study-workspaces/study-workspace-service'
import { DrizzleStudyWorkspaceRepository } from './repositories/drizzle-study-workspace-repository'
import { registerStudyWorkspaceHandlers } from './ipc/study-workspace-handlers'
import { registerCodeExecutionHandlers } from './ipc/code-execution-handlers'
import { ObserverService } from '../application/observer/observer-service'
import { DrizzleObserverRepository } from './repositories/drizzle-observer-repository'
import { registerObserverHandlers } from './ipc/observer-handlers'
import { PlanningService } from '../application/planning/planning-service'
import { DrizzlePlanningRepository } from './repositories/drizzle-planning-repository'
import { registerPlanningHandlers } from './ipc/planning-handlers'
import { PdfMaterialService } from './materials/pdf-material-service'
import { registerMaterialHandlers } from './ipc/material-handlers'
import { registerSessionNavigationHandlers } from './ipc/session-navigation-handlers'
import { registerBackupHandlers } from './ipc/backup-handlers'
import { finishPendingRestore, recoverPendingRestore, rollbackPendingRestore, validateCoachDatabaseSchema } from './database/restore-recovery'
import { CurrentWorkspaceContextService } from '../application/workspaces/current-workspace-context'
import { WorkspaceEventBus } from '../application/events/workspace-event-bus'
import { ProjectService } from '../application/projects/project-service'
import { DrizzleProjectRepository } from './repositories/drizzle-project-repository'
import { registerProjectHandlers } from './ipc/project-handlers'
import { RoadmapService } from '../application/roadmaps/roadmap-service'
import { CurriculumSourceService } from '../application/roadmaps/curriculum-source-service'
import { HttpsCurriculumSourceGateway } from './gateways/https-curriculum-source-gateway'
import { DrizzleRoadmapRepository } from './repositories/drizzle-roadmap-repository'
import { registerRoadmapHandlers } from './ipc/roadmap-handlers'
import { PlannerActionService } from '../application/planning/planner-action-service'
import { DrizzlePlannerActionRepository } from './repositories/drizzle-planner-action-repository'
import { registerPlannerActionHandlers } from './ipc/planner-action-handlers'
import { ReportService } from '../application/reports/report-service'
import { DrizzleReportRepository } from './repositories/drizzle-report-repository'
import { registerReportHandlers } from './ipc/report-handlers'
import { WorkspaceOnboardingService } from '../application/workspaces/workspace-onboarding-service'
import { registerWorkspaceOnboardingHandlers } from './ipc/workspace-onboarding-handlers'
import { registerStudyProgressHandlers } from './ipc/study-progress-handlers'
import { mapStudyProgressState } from './ipc/study-progress-handlers'
import { registerStudyLessonHandlers } from './ipc/study-lesson-handlers'
import { StudyLessonService } from '../application/study-lessons/study-lesson-service'
import { academicDayKey, academicEventPhase } from '../application/planning/academic-time'
import { SqliteStudyLessonRepository } from './repositories/sqlite-study-lesson-repository'

let database: CoachDatabase | null = null
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
}

if (process.env['COACH_DISABLE_HARDWARE_ACCELERATION']) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
}

void app.whenReady().then(async () => {
  try {
    const databasePath = join(app.getPath('userData'), 'coach.sqlite')
    const migrationsFolder = join(app.getAppPath(), 'drizzle/migrations')
    recoverPendingRestore(databasePath)
    try {
      database = openCoachDatabase({ databasePath, migrationsFolder })
      validateCoachDatabaseSchema(database.sqlite)
    } catch (error) {
      console.error('Coach database startup failed before restore recovery retry:', error)
      database?.close()
      database = null
      rollbackPendingRestore(databasePath)
      database = openCoachDatabase({ databasePath, migrationsFolder })
      validateCoachDatabaseSchema(database.sqlite)
    }
    const workspaceRepository = new DrizzleWorkspaceRepository(database)
    const workspaceService = new WorkspaceService({ repository: workspaceRepository })
    const providerManager = new AIProviderManager()
    const providerConfigurationService = new ProviderConfigurationService(
      new DrizzleProviderConfigurationRepository(database),
      new ElectronCredentialVault(),
      providerManager,
      (apiKey, model) => new OpenAIProvider(apiKey, model),
      (label, baseUrl, apiKey, model) => new OpenAICompatibleProvider(label, baseUrl, apiKey, model),
    )
    await providerConfigurationService.initialize()
    const homePlannerService = new HomePlannerService({
      repository: new DrizzleConversationRepository(database),
      providerManager,
    })
    const workspaceEventBus = new WorkspaceEventBus()
    const roadmapRepository = new DrizzleRoadmapRepository(database)
    const studyWorkspaceService = new StudyWorkspaceService({ repository: new DrizzleStudyWorkspaceRepository(database), getWorkspace: (id) => workspaceRepository.findById(id), eventBus: workspaceEventBus, getRoadmap: (id) => roadmapRepository.findCurrent(id), getStudyProgress: (id) => { const row = database!.sqlite.prepare('SELECT workspace_id AS workspaceId, roadmap_id AS roadmapId, current_module_id AS currentModuleId, current_topic_id AS currentTopicId, current_lesson_id AS currentLessonId, current_checkpoint_id AS currentCheckpointId, topic_statuses_json AS topicStatusesJson, lesson_positions_json AS lessonPositionsJson, checkpoint_states_json AS checkpointStatesJson, updated_at AS updatedAt FROM study_progress WHERE workspace_id = ?').get(id) as Parameters<typeof mapStudyProgressState>[0] | undefined; return row ? mapStudyProgressState(row) : null }, getPlanContext: (id) => { const minutes = (database!.sqlite.prepare('SELECT minutes FROM academic_availability WHERE weekday = ?').get(new Date().getDay()) as { minutes: number } | undefined)?.minutes ?? 120; const deadline = database!.sqlite.prepare('SELECT due_at AS dueAt FROM study_deadlines WHERE workspace_id = ? AND completed = 0 AND due_at >= ? ORDER BY due_at LIMIT 1').get(id, Date.now()) as { dueAt: number } | undefined; const now = Date.now(); const phase = deadline ? academicEventPhase(deadline.dueAt, now) : null; const lastPlannedDayKey = (database!.sqlite.prepare('SELECT last_planned_day_key AS value FROM workspace_study_states WHERE workspace_id = ?').get(id) as { value: string | null } | undefined)?.value ?? null; const learningRows = database!.sqlite.prepare('SELECT workspace_id AS workspaceId, topic_id AS topicId, evidence_count AS evidenceCount, assessments, correct_first_try AS correctFirstTry, correct_after_help AS correctAfterHelp, incorrect, hints_used AS hintsUsed, reinforcement_events AS reinforcementEvents, exercises_completed AS exercisesCompleted, lessons_completed AS lessonsCompleted, difficulty_level AS difficultyLevel, mastery_estimate AS masteryEstimate, confidence, needs_review AS needsReview, last_practiced_at AS lastPracticedAt, last_assessed_at AS lastAssessedAt, reasons_json AS reasonsJson, updated_at AS updatedAt FROM topic_learning_states WHERE workspace_id = ?').all(id) as Array<any>; const learningStates = new Map(learningRows.map(({ reasonsJson, ...row }) => [row.topicId, { ...row, needsReview: Boolean(row.needsReview), reasons: JSON.parse(reasonsJson) }])); return { availableMinutes: minutes, phase, learningStates, startMinutes: 18 * 60, dayKey: academicDayKey(now), lastPlannedDayKey } } })
    const observerService = new ObserverService(new DrizzleObserverRepository(database))
    const getWorkspaceMemory = (id: string) => (database!.sqlite.prepare('SELECT summary FROM workspace_memories WHERE workspace_id = ?').get(id) as { summary: string } | undefined)?.summary ?? null
    const currentWorkspaceContext = new CurrentWorkspaceContextService({ getWorkspace: (id) => workspaceRepository.findById(id), getStudyState: (id) => studyWorkspaceService.getState(id), getObserverState: (id) => observerService.getState(id), getWorkspaceMemory })
    const materialService = new PdfMaterialService(database)
    const curriculumSourceService = new CurriculumSourceService(new HttpsCurriculumSourceGateway())
    const getTopicLearningState = (workspaceId: string, topicId: string) => {
      const row = database!.sqlite.prepare('SELECT difficulty_level AS difficulty, needs_review AS needsReview, mastery_estimate AS mastery, confidence, assessments, correct_first_try AS correctFirstTry, correct_after_help AS correctAfterHelp, incorrect FROM topic_learning_states WHERE workspace_id = ? AND topic_id = ?').get(workspaceId, topicId) as { difficulty: 'low' | 'medium' | 'high'; needsReview: number; mastery: number | null; confidence: 'low' | 'medium' | 'high'; assessments: number; correctFirstTry: number; correctAfterHelp: number; incorrect: number } | undefined
      return row ? { ...row, needsReview: Boolean(row.needsReview) } : null
    }
    const studyLessonService = new StudyLessonService(new SqliteStudyLessonRepository(database), providerManager, (id) => workspaceRepository.findById(id), (id) => roadmapRepository.findCurrent(id), Date.now, curriculumSourceService, { getTopicLearningState, getWorkspaceMemory, searchMaterials: (id, query) => materialService.search(id, query), canShareContext: (id) => Boolean((database!.sqlite.prepare('SELECT share_context_with_ai AS enabled FROM workspace_study_states WHERE workspace_id = ?').get(id) as { enabled: number } | undefined)?.enabled) })
    const workspaceCoachService = new WorkspaceCoachService({ repository: new DrizzleConversationRepository(database), providerManager, getWorkspace: (id) => workspaceRepository.findById(id), getObserverState: (id) => observerService.getState(id), getWorkspaceMemory, getCurrentContext: (id) => currentWorkspaceContext.get(id), searchMaterials: (id, query) => materialService.search(id, query), studyLessonService })
    registerApplicationHandlers()
    registerStudyProgressHandlers(database)
    registerStudyLessonHandlers(studyLessonService)
    registerWorkspaceHandlers(workspaceService)
    registerStudyWorkspaceHandlers(studyWorkspaceService)
    const projectRepository = new DrizzleProjectRepository(database)
    registerCodeExecutionHandlers(async (id) => Boolean(await workspaceRepository.findById(id)), observerService, projectRepository, database)
    registerObserverHandlers(observerService)
    const planningService = new PlanningService(new DrizzlePlanningRepository(database))
    registerPlanningHandlers(planningService)
    registerMaterialHandlers(materialService, async (id) => Boolean(await workspaceRepository.findById(id)))
    registerSessionNavigationHandlers(database)
    registerBackupHandlers(database)
    registerProjectHandlers(new ProjectService(projectRepository, async (id) => Boolean(await workspaceRepository.findById(id))))
    const roadmapService = new RoadmapService(roadmapRepository, providerManager, (id) => workspaceRepository.findById(id), (id) => { const difficulties = (database!.sqlite.prepare("SELECT topic_id AS topicId FROM topic_learning_states WHERE workspace_id = ? AND (difficulty_level IN ('medium','high') OR needs_review = 1) ORDER BY difficulty_level DESC").all(id) as Array<{ topicId: string }>).map((item) => item.topicId.split(':').at(-1) ?? item.topicId); const deadline = (database!.sqlite.prepare('SELECT due_at AS dueAt FROM academic_events WHERE workspace_id = ? AND due_at >= ? ORDER BY due_at LIMIT 1').get(id, Date.now()) as { dueAt: number } | undefined)?.dueAt ?? null; const availability = database!.sqlite.prepare('SELECT weekday, minutes FROM academic_availability ORDER BY weekday').all() as Array<{ weekday: number; minutes: number }>; const knownContext: string[] = []; return { difficulties, deadline, availability, knownContext } }, curriculumSourceService)
    registerRoadmapHandlers(roadmapService)
    workspaceService.setLearningPathEnsurer((workspaceId) => roadmapService.ensureLearningPath(workspaceId))
    providerManager.onAvailable(() => { roadmapService.retryWaitingForProvider() })
    for (const workspace of await workspaceRepository.listActive()) void roadmapService.ensureLearningPath(workspace.id).catch(() => {})
    const plannerActionService = new PlannerActionService({ repository: new DrizzlePlannerActionRepository(database), createWorkspace: (input) => workspaceService.create(input), createProject: (workspaceId, name, language) => new ProjectService(projectRepository, async (id) => Boolean(await workspaceRepository.findById(id))).create(workspaceId, name, language), createDeadline: (input) => planningService.createDeadline(input), addRoutine: (content) => planningService.addRoutineNote(content) })
    registerPlannerActionHandlers(plannerActionService)
    registerConversationHandlers(homePlannerService, workspaceCoachService, new HomeOrganizerService(homePlannerService, planningService, plannerActionService, () => workspaceRepository.listActive(), (id) => studyWorkspaceService.recalculatePlan(id)))
    registerReportHandlers(new ReportService(new DrizzleReportRepository(database)))
    registerWorkspaceOnboardingHandlers(new WorkspaceOnboardingService({ repository: new DrizzleConversationRepository(database), providerManager }))
    registerProviderHandlers(providerConfigurationService)
    finishPendingRestore(databasePath)
    createMainWindow()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown startup error'
    console.error('Coach startup failed:', message)
    app.exit(1)
    return
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown Electron initialization error'
  console.error('Electron initialization failed:', message)
  app.exit(1)
})

app.on('will-quit', () => {
  database?.close()
  database = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
