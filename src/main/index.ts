import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerApplicationHandlers } from './ipc/application-handlers'
import { createMainWindow } from './windows/create-main-window'
import { openCoachDatabase, type CoachDatabase } from './database/connection'
import { WorkspaceService } from '../application/workspaces/workspace-service'
import { DrizzleWorkspaceRepository } from './repositories/drizzle-workspace-repository'
import { registerWorkspaceHandlers } from './ipc/workspace-handlers'
import { HomePlannerService } from '../application/conversations/home-planner-service'
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
    recoverPendingRestore(databasePath)
    try {
      database = openCoachDatabase()
      validateCoachDatabaseSchema(database.sqlite)
    } catch (error) {
      database?.close()
      database = null
      rollbackPendingRestore(databasePath)
      database = openCoachDatabase()
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
    const studyWorkspaceService = new StudyWorkspaceService({ repository: new DrizzleStudyWorkspaceRepository(database), getWorkspace: (id) => workspaceRepository.findById(id), eventBus: workspaceEventBus, getRoadmap: (id) => roadmapRepository.findCurrent(id), getStudyProgress: (id) => { const row = database!.sqlite.prepare('SELECT workspace_id AS workspaceId, roadmap_id AS roadmapId, current_module_id AS currentModuleId, current_topic_id AS currentTopicId, current_lesson_id AS currentLessonId, current_checkpoint_id AS currentCheckpointId, topic_statuses_json AS topicStatusesJson, lesson_positions_json AS lessonPositionsJson, updated_at AS updatedAt FROM study_progress WHERE workspace_id = ?').get(id) as Parameters<typeof mapStudyProgressState>[0] | undefined; return row ? mapStudyProgressState(row) : null }, getPlanContext: (id) => { const minutes = (database!.sqlite.prepare('SELECT minutes FROM academic_availability WHERE weekday = ?').get(new Date().getDay()) as { minutes: number } | undefined)?.minutes ?? 120; const deadline = database!.sqlite.prepare('SELECT due_at AS dueAt FROM study_deadlines WHERE workspace_id = ? AND completed = 0 ORDER BY due_at LIMIT 1').get(id) as { dueAt: number } | undefined; const days = deadline ? (deadline.dueAt - Date.now()) / 86_400_000 : 30; const difficultyTopicIds = new Set((database!.sqlite.prepare("SELECT DISTINCT topic_id AS topicId FROM study_progress_events WHERE workspace_id = ? AND type = 'CHECKPOINT_ANSWERED' AND correct = 0").all(id) as Array<{ topicId: string }>).map((item) => item.topicId)); return { availableMinutes: minutes, urgency: days <= 2 ? 'urgent' : days <= 7 ? 'attention' : 'stable', difficultyTopicIds, startMinutes: 18 * 60 } } })
    const observerService = new ObserverService(new DrizzleObserverRepository(database))
    const getWorkspaceMemory = (id: string) => (database!.sqlite.prepare('SELECT summary FROM workspace_memories WHERE workspace_id = ?').get(id) as { summary: string } | undefined)?.summary ?? null
    const currentWorkspaceContext = new CurrentWorkspaceContextService({ getWorkspace: (id) => workspaceRepository.findById(id), getStudyState: (id) => studyWorkspaceService.getState(id), getObserverState: (id) => observerService.getState(id), getWorkspaceMemory })
    const materialService = new PdfMaterialService(database)
    const workspaceCoachService = new WorkspaceCoachService({ repository: new DrizzleConversationRepository(database), providerManager, getWorkspace: (id) => workspaceRepository.findById(id), getObserverState: (id) => observerService.getState(id), getWorkspaceMemory, getCurrentContext: (id) => currentWorkspaceContext.get(id), searchMaterials: (id, query) => materialService.search(id, query) })
    registerApplicationHandlers()
    registerStudyProgressHandlers(database)
    registerStudyLessonHandlers(new StudyLessonService(new SqliteStudyLessonRepository(database), providerManager, (id) => workspaceRepository.findById(id), (id) => roadmapRepository.findCurrent(id)))
    registerWorkspaceHandlers(workspaceService)
    registerConversationHandlers(homePlannerService, workspaceCoachService)
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
    registerRoadmapHandlers(new RoadmapService(new DrizzleRoadmapRepository(database), providerManager, (id) => workspaceRepository.findById(id)))
    registerPlannerActionHandlers(new PlannerActionService({ repository: new DrizzlePlannerActionRepository(database), createWorkspace: (input) => workspaceService.create(input), createProject: (workspaceId, name, language) => new ProjectService(projectRepository, async (id) => Boolean(await workspaceRepository.findById(id))).create(workspaceId, name, language), createDeadline: (input) => planningService.createDeadline(input), addRoutine: (content) => planningService.addRoutineNote(content) }))
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
