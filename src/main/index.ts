import { app, BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { registerApplicationHandlers } from './ipc/application-handlers'
import { createMainWindow } from './windows/create-main-window'
import { openCoachDatabase, type CoachDatabase } from './database/connection'
import { WorkspaceService } from '../application/workspaces/workspace-service'
import type { Workspace } from '../shared/contracts/workspace-contract'
import { DrizzleWorkspaceRepository } from './repositories/drizzle-workspace-repository'
import { registerWorkspaceHandlers } from './ipc/workspace-handlers'
import { HomePlannerService } from '../application/conversations/home-planner-service'
import { HomeOrganizerService } from '../application/conversations/home-organizer-service'
import { ProviderOrganizerIntentInterpreter } from '../application/conversations/organizer-intent-interpreter'
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
import { extractJsonDocument } from '../application/ai/structured-json'
import { materialSemanticAnalysisSchema } from '../shared/contracts/material-contract'
import { registerMaterialHandlers } from './ipc/material-handlers'
import { registerSessionNavigationHandlers } from './ipc/session-navigation-handlers'
import { registerBackupHandlers } from './ipc/backup-handlers'
import { finishPendingRestore, recoverPendingRestore, rollbackPendingRestore, validateCoachDatabaseSchema } from './database/restore-recovery'
import { CurrentWorkspaceContextService } from '../application/workspaces/current-workspace-context'
import { WorkspaceContextHub } from '../application/workspaces/workspace-context-hub'
import { WorkspaceActionService } from '../application/workspaces/workspace-action-service'
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
import { AcademicSubjectContextService } from '../application/workspaces/academic-subject-context'
import { SqliteAcademicSubjectContextRepository } from './repositories/sqlite-academic-subject-context-repository'
import { registerWorkspaceOnboardingHandlers } from './ipc/workspace-onboarding-handlers'
import { registerStudyProgressHandlers } from './ipc/study-progress-handlers'
import { SqliteLearningEvidenceService } from '../application/learning-evidence/learning-evidence-service'
import { ToolchainManager } from './code-execution/toolchain-manager'
import { mapStudyProgressState } from './ipc/study-progress-handlers'
import { registerStudyLessonHandlers } from './ipc/study-lesson-handlers'
import { StudyLessonService } from '../application/study-lessons/study-lesson-service'
import { academicDayKey, academicEventPhase } from '../application/planning/academic-time'
import { SqliteStudyLessonRepository } from './repositories/sqlite-study-lesson-repository'
import { ExerciseService } from '../application/exercises/exercise-service'
import { SqliteExerciseRepository } from './repositories/sqlite-exercise-repository'
import { registerExerciseHandlers } from './ipc/exercise-handlers'
import { HeavyGenerationQueue } from '../application/ai/heavy-generation-queue'
import { WorkspaceProvisioningService } from '../application/workspaces/workspace-provisioning-service'
import { SqliteWorkspaceProvisioningRepository } from './repositories/sqlite-workspace-provisioning-repository'
import { semanticSubjectKey } from '../application/workspaces/subject-normalizer'
import { AcademicLifeService } from '../application/academic-life/academic-life-service'
import { SqliteAcademicLifeRepository } from './repositories/sqlite-academic-life-repository'
import { registerAcademicLifeHandlers } from './ipc/academic-life-handlers'
import { SqliteWorkspaceContentRepository } from './repositories/sqlite-workspace-content-repository'
import { ContentGenerationWorker } from '../application/workspaces/content-generation-worker'
import { createContentJobHandlers } from './content/content-job-handlers'
import { PedagogicalPrefetchScheduler } from '../application/workspaces/pedagogical-prefetch-scheduler'
import { InitialProvisioningCoordinator } from './content/initial-provisioning-coordinator'
import { PerformanceTimelineStore } from './telemetry/performance-timeline'
import { ReviewService } from '../application/review/review-service'
import { registerReviewHandlers } from './ipc/review-handlers'
import { SubjectWorkspaceResolver } from '../application/workspaces/subject-workspace-resolver'
import { EventWorkspaceLinkService } from '../application/academic-life/event-workspace-link-service'
import { SqliteEventWorkspaceLinkRepository } from './repositories/sqlite-event-workspace-link-repository'
import { z } from 'zod'

let database: CoachDatabase | null = null
let contentWorker: ContentGenerationWorker | null = null
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
    const academicLife = new AcademicLifeService(new SqliteAcademicLifeRepository(database))
    const academicSubjectContext = new AcademicSubjectContextService(new SqliteAcademicSubjectContextRepository(database))
    const heavyGenerationQueue = new HeavyGenerationQueue()
    const performanceTimelines = new PerformanceTimelineStore(database)
    let workspaceProvisioning: WorkspaceProvisioningService | undefined
    let validateWorkspaceAnalysis: (token: string, revision: number, subject: string, focus?: string, context?: string) => boolean = () => false
    const workspaceService = new WorkspaceService({ repository: workspaceRepository, academicContext: academicSubjectContext, validateAnalysis: (...input) => validateWorkspaceAnalysis(...input), findSemanticDuplicate: (key, excludedId) => { const rows = database!.sqlite.prepare("SELECT w.id,w.name,w.objective,w.status,w.created_at AS createdAt,w.updated_at AS updatedAt,w.last_opened_at AS lastOpenedAt,w.archived_at AS archivedAt,o.canonical_focus AS canonicalFocus,o.canonical_context AS canonicalContext FROM workspaces w JOIN workspace_learning_overrides o ON o.workspace_id=w.id WHERE w.status='active' AND w.id != COALESCE(?, '')").all(excludedId ?? null) as Array<Workspace & { canonicalFocus: string; canonicalContext: string }>; return rows.find((item) => semanticSubjectKey(item.name, item.canonicalFocus, item.canonicalContext) === key) ?? null }, provisioning: { createDraft: (id) => workspaceProvisioning!.createDraft(id), start: (id) => workspaceProvisioning!.start(id), get: (id) => workspaceProvisioning!.get(id), retry: (id) => workspaceProvisioning!.retry(id), discardDraft: (id) => workspaceProvisioning!.discardDraft(id) }, saveLearningOverrides: (workspaceId, subject, input, now) => { database!.sqlite.prepare('INSERT INTO workspace_learning_overrides (workspace_id,subject,canonical_focus,canonical_context,declared_level,declared_knowledge_json,declared_difficulties_json,goals_json,onboarding_analysis_revision,onboarding_analysis_fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET subject=excluded.subject,canonical_focus=excluded.canonical_focus,canonical_context=excluded.canonical_context,declared_level=excluded.declared_level,declared_knowledge_json=excluded.declared_knowledge_json,declared_difficulties_json=excluded.declared_difficulties_json,goals_json=excluded.goals_json,onboarding_analysis_revision=COALESCE(workspace_learning_overrides.onboarding_analysis_revision,excluded.onboarding_analysis_revision),onboarding_analysis_fingerprint=COALESCE(workspace_learning_overrides.onboarding_analysis_fingerprint,excluded.onboarding_analysis_fingerprint),updated_at=excluded.updated_at').run(workspaceId, subject, input.canonicalFocus ?? subject, input.canonicalContext ?? '', input.declaredLevel ?? null, JSON.stringify(input.localKnowledgeProjection ? [input.localKnowledgeProjection] : input.declaredKnowledge ?? []), JSON.stringify(input.declaredDifficulties ?? []), JSON.stringify(input.goals ?? []), input.analysisRevision ?? null, createHash('sha256').update(JSON.stringify({ subject, focus: input.canonicalFocus ?? subject, context: input.canonicalContext ?? '', revision: input.analysisRevision ?? null })).digest('hex'), now, now) }, createWithAcademicContexts: (workspace, _academic, related) => database!.sqlite.transaction(() => {
      const created = database!.sqlite.prepare('INSERT INTO workspaces (id, name, objective, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING id, name, objective, status, created_at AS createdAt, updated_at AS updatedAt, last_opened_at AS lastOpenedAt, archived_at AS archivedAt').get(workspace.id, workspace.name, workspace.objective, workspace.createdAt, workspace.updatedAt) as Workspace
      for (const item of [{ subject: workspace.name, relation: 'primary' as const }, ...related]) { if (!academicSubjectContext.get(item.subject)) academicSubjectContext.record({ subject: item.subject, declaredLevel: null, declaredKnowledge: [], declaredDifficulties: [], goals: [], sourceEvidence: [] }); database!.sqlite.prepare('INSERT INTO workspace_academic_contexts (workspace_id, subject, relation) VALUES (?, ?, ?)').run(workspace.id, academicSubjectContext.get(item.subject)!.subject, item.relation) }
      return created
    })() })
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
    let provisioningCoordinator: InitialProvisioningCoordinator
    const roadmapRepository = new DrizzleRoadmapRepository(database, (roadmap) => provisioningCoordinator.adoptApprovedRoadmap(roadmap))
    const planningService = new PlanningService(new DrizzlePlanningRepository(database))
    const studyWorkspaceService = new StudyWorkspaceService({ repository: new DrizzleStudyWorkspaceRepository(database), getTodayPlan: (id) => planningService.getTodayPlan(id), replanWeek: () => { planningService.replanWeek() }, getWorkspace: (id) => workspaceRepository.findById(id), eventBus: workspaceEventBus, getRoadmap: (id) => roadmapRepository.findCurrent(id), getStudyProgress: (id) => { const row = database!.sqlite.prepare('SELECT workspace_id AS workspaceId, roadmap_id AS roadmapId, current_module_id AS currentModuleId, current_topic_id AS currentTopicId, current_lesson_id AS currentLessonId, current_checkpoint_id AS currentCheckpointId, topic_statuses_json AS topicStatusesJson, lesson_positions_json AS lessonPositionsJson, checkpoint_states_json AS checkpointStatesJson, updated_at AS updatedAt FROM study_progress WHERE workspace_id = ?').get(id) as Parameters<typeof mapStudyProgressState>[0] | undefined; return row ? mapStudyProgressState(row) : null }, getPlanContext: (id) => { const currentTime = Date.now(); const weekday = new Date(currentTime).getDay(); const minutes = (database!.sqlite.prepare("SELECT minutes FROM academic_life_items WHERE kind='availability' AND status='active' AND replaced_by_id IS NULL AND weekday=? AND (workspace_id IS NULL OR workspace_id=?) AND (expires_at IS NULL OR expires_at>?) ORDER BY CASE WHEN workspace_id=? THEN 0 ELSE 1 END,updated_at DESC LIMIT 1").get(weekday, id, currentTime, id) as { minutes: number } | undefined)?.minutes ?? (database!.sqlite.prepare('SELECT minutes FROM academic_availability WHERE weekday = ?').get(weekday) as { minutes: number } | undefined)?.minutes ?? 120; const deadline = database!.sqlite.prepare('SELECT due_at AS dueAt FROM study_deadlines WHERE workspace_id = ? AND completed = 0 AND due_at >= ? ORDER BY due_at LIMIT 1').get(id, Date.now()) as { dueAt: number } | undefined; const now = Date.now(); const phase = deadline ? academicEventPhase(deadline.dueAt, now) : null; const lastPlannedDayKey = (database!.sqlite.prepare('SELECT last_planned_day_key AS value FROM workspace_study_states WHERE workspace_id = ?').get(id) as { value: string | null } | undefined)?.value ?? null; const learningRows = database!.sqlite.prepare('SELECT workspace_id AS workspaceId, topic_id AS topicId, evidence_count AS evidenceCount, assessments, correct_first_try AS correctFirstTry, correct_after_help AS correctAfterHelp, incorrect, hints_used AS hintsUsed, reinforcement_events AS reinforcementEvents, exercises_completed AS exercisesCompleted, lessons_completed AS lessonsCompleted, difficulty_level AS difficultyLevel, mastery_estimate AS masteryEstimate, confidence, needs_review AS needsReview, last_practiced_at AS lastPracticedAt, last_assessed_at AS lastAssessedAt, reasons_json AS reasonsJson, updated_at AS updatedAt FROM topic_learning_states WHERE workspace_id = ?').all(id) as Array<any>; const learningStates = new Map(learningRows.map(({ reasonsJson, ...row }) => [row.topicId, { ...row, needsReview: Boolean(row.needsReview), reasons: JSON.parse(reasonsJson) }])); return { availableMinutes: minutes, phase, learningStates, startMinutes: 18 * 60, dayKey: academicDayKey(now), lastPlannedDayKey } } })
    const observerService = new ObserverService(new DrizzleObserverRepository(database))
    const getWorkspaceMemory = (id: string) => (database!.sqlite.prepare('SELECT summary FROM workspace_memories WHERE workspace_id = ?').get(id) as { summary: string } | undefined)?.summary ?? null
    const currentWorkspaceContext = new CurrentWorkspaceContextService({ getWorkspace: (id) => workspaceRepository.findById(id), getStudyState: (id) => studyWorkspaceService.getState(id), getObserverState: (id) => observerService.getState(id), getWorkspaceMemory, getAcademicSubjectContext: (subject) => academicSubjectContext.get(subject), getPrimaryAcademicContext: (workspaceId) => { const row = database!.sqlite.prepare("SELECT subject FROM workspace_academic_contexts WHERE workspace_id = ? AND relation = 'primary'").get(workspaceId) as { subject: string } | undefined; return row ? academicSubjectContext.get(row.subject) : null }, getRelatedAcademicContexts: (workspaceId) => (database!.sqlite.prepare("SELECT subject, relation FROM workspace_academic_contexts WHERE workspace_id = ? AND relation != 'primary'").all(workspaceId) as Array<{ subject: string; relation: 'implementation_language' | 'prerequisite' | 'user_selected' }>).flatMap((item) => { const context = academicSubjectContext.get(item.subject); return context ? [{ ...context, relation: item.relation }] : [] }) })
    const workspaceContextHub = new WorkspaceContextHub({ getCurrent: (id) => currentWorkspaceContext.get(id), getWeeklyPlan: () => planningService.getWeeklyPlan(), getAcademicLifeContext: (id, limit) => academicLife.activeForContext(limit, id), read: async (workspaceId, resource, options) => { const state = await studyWorkspaceService.getState(workspaceId); if (resource === 'materials') { if (options?.id) return options.pageNumber ? materialService.readPage(workspaceId, options.id, options.pageNumber) : materialService.read(workspaceId, options.id, options.offset, options.limit); if (options?.query) return materialService.search(workspaceId, options.query); return materialService.list(workspaceId).filter((item) => item.status === 'ready') } if (resource === 'roadmap') return roadmapRepository.findCurrent(workspaceId); if (resource === 'lesson') return database!.sqlite.prepare('SELECT id, topic_id AS topicId, content_json AS content FROM study_lessons WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 1').get(workspaceId) ?? { status: 'not_found' }; if (resource === 'progress') return database!.sqlite.prepare('SELECT * FROM study_progress WHERE workspace_id = ?').get(workspaceId) ?? { status: 'not_started' }; if (resource === 'plan') return state.plan; if (resource === 'notes') return { notes: state.notes.slice(options?.offset ?? 0, (options?.offset ?? 0) + Math.min(6000, options?.limit ?? 4000)), revision: state.notesRevision }; if (resource === 'academic') { const current = await currentWorkspaceContext.get(workspaceId); return { primary: current.academicSubject ?? null, related: current.relatedAcademicSubjects ?? [], globalLife: academicLife.activeForContext(Math.min(options?.limit ?? 20, 30), workspaceId) } } if (resource === 'workspace') return workspaceRepository.findById(workspaceId); throw new Error(`Unsupported context resource: ${resource}`) } })
    let roadmapService: RoadmapService
    const workspaceActions = new WorkspaceActionService({ execute: async (input) => { const exists = await workspaceRepository.findById(input.workspaceId); if (!exists) throw new Error('Workspace not found'); if (input.type === 'plan.recalculate') return studyWorkspaceService.recalculatePlan(input.workspaceId); if (input.type === 'plan.complete') return studyWorkspaceService.completePlanItem(input.workspaceId, input.arguments.itemId); if (input.type === 'roadmap.preview-materials') return roadmapService.previewRebuild({ workspaceId: input.workspaceId, materialIds: input.arguments.materialIds, instruction: input.arguments.instruction }); if (input.type === 'notes.add') { const content = String(input.arguments.content ?? '').trim(); if (!content) throw new Error('Note content is required'); const state = await studyWorkspaceService.getState(input.workspaceId); const expected = `${state.notes}${state.notes ? '\n' : ''}${content}`; if (expected.length > 20_000) throw new Error('Note exceeds the 20000 character limit'); const saved = await studyWorkspaceService.saveNotes(input.workspaceId, expected, state.notesRevision + 1); if (saved.notes !== expected || saved.notesRevision <= state.notesRevision) throw new Error('Notes persistence conflict'); return saved } throw new Error('Action requires an explicit application handler') } })
    const materialService = new PdfMaterialService(database, { timelines: performanceTimelines, analyzeSemantic: async (request) => { const provider = providerManager.route('roadmap'); if (!provider) return { documentType: 'unknown', subject: '', summary: 'Análise indisponível.', topics: [], prerequisiteTopics: [], estimatedLevel: 'unknown', relationToObjective: '', relevance: 'low', confidence: 0 }; const response = await provider.sendMessage({ messages: [{ role: 'system', content: 'Analise semanticamente o material acadêmico. Retorne somente JSON com documentType, subject, summary, topics, prerequisiteTopics, estimatedLevel, relationToObjective, relevance e confidence. Não trate validade do arquivo como relevância. relevance: high|medium|low|unrelated.' }, { role: 'user', content: JSON.stringify(request) }], maxOutputTokens: 1200, signal: AbortSignal.timeout(120_000) }); return materialSemanticAnalysisSchema.parse(extractJsonDocument(response.content)) } })
    const curriculumSourceService = new CurriculumSourceService(new HttpsCurriculumSourceGateway())
    const getTopicLearningState = (workspaceId: string, topicId: string) => {
      const row = database!.sqlite.prepare('SELECT difficulty_level AS difficulty, needs_review AS needsReview, mastery_estimate AS mastery, confidence, assessments, correct_first_try AS correctFirstTry, correct_after_help AS correctAfterHelp, incorrect FROM topic_learning_states WHERE workspace_id = ? AND topic_id = ?').get(workspaceId, topicId) as { difficulty: 'low' | 'medium' | 'high'; needsReview: number; mastery: number | null; confidence: 'low' | 'medium' | 'high'; assessments: number; correctFirstTry: number; correctAfterHelp: number; incorrect: number } | undefined
      return row ? { ...row, needsReview: Boolean(row.needsReview) } : null
    }
    const getTopicConceptMemory = (workspaceId: string, topicId: string) => database!.sqlite.prepare("SELECT cm.performance,cm.retention,cm.confidence,cm.next_review_at AS nextReviewAt FROM topic_concepts tc JOIN concept_memories cm ON cm.workspace_id=tc.workspace_id AND cm.concept_id=tc.concept_id WHERE tc.workspace_id=? AND tc.topic_id=? AND tc.mapping_status='mapped' ORDER BY cm.updated_at DESC LIMIT 1").get(workspaceId, topicId) as { performance: 'unknown' | 'struggling' | 'developing' | 'secure'; retention: 'unknown' | 'fragile' | 'developing' | 'durable'; confidence: 'low' | 'medium' | 'high'; nextReviewAt: number | null } | undefined ?? null
    const studyLessonService = new StudyLessonService(new SqliteStudyLessonRepository(database), providerManager, (id) => workspaceRepository.findById(id), (id) => roadmapRepository.findCurrent(id), Date.now, curriculumSourceService, { getTopicLearningState, getTopicConceptMemory, getWorkspaceMemory, searchMaterials: (id, query) => materialService.search(id, query) }, heavyGenerationQueue)
    const toolchainManager = new ToolchainManager()
    let prefetch: PedagogicalPrefetchScheduler
    const learningEvidence = new SqliteLearningEvidenceService(database)
    const reviewService = new ReviewService(database, learningEvidence)
    const exerciseService = new ExerciseService(new SqliteExerciseRepository(database, Date.now, learningEvidence), providerManager, toolchainManager, (id) => workspaceRepository.findById(id), (id) => roadmapRepository.findCurrent(id), Date.now, () => crypto.randomUUID(), heavyGenerationQueue, (workspaceId, topicId) => { prefetch?.schedule({ type: 'required_exercise_near_completion', workspaceId, topicId }) })
    const workspaceCoachService = new WorkspaceCoachService({ repository: new DrizzleConversationRepository(database), providerManager, getWorkspace: (id) => workspaceRepository.findById(id), getObserverState: (id) => observerService.getState(id), getWorkspaceMemory, getCurrentContext: (id) => currentWorkspaceContext.get(id), contextHub: workspaceContextHub, workspaceActions, searchMaterials: (id, query) => materialService.search(id, query), studyLessonService, exerciseService, admission: heavyGenerationQueue })
    registerApplicationHandlers()
    registerExerciseHandlers(exerciseService)
    registerReviewHandlers(reviewService)
    const contentRepository = new SqliteWorkspaceContentRepository(database)
    prefetch = new PedagogicalPrefetchScheduler({ repository: contentRepository, getRoadmap: (id) => roadmapRepository.findCurrent(id), onJobsChanged: () => contentWorker?.wake() })
    registerStudyProgressHandlers(database, () => toolchainManager.getStatuses(), providerManager, prefetch, learningEvidence)
    registerStudyLessonHandlers(studyLessonService)
    registerWorkspaceHandlers(workspaceService)
    registerStudyWorkspaceHandlers(studyWorkspaceService)
    const projectRepository = new DrizzleProjectRepository(database)
    registerCodeExecutionHandlers(async (id) => Boolean(await workspaceRepository.findById(id)), observerService, projectRepository, database, toolchainManager, learningEvidence)
    registerObserverHandlers(observerService)
    registerPlanningHandlers(planningService)
    registerMaterialHandlers(materialService, async (id) => Boolean(await workspaceRepository.findById(id)))
    registerSessionNavigationHandlers(database)
    registerBackupHandlers(database)
    registerProjectHandlers(new ProjectService(projectRepository, async (id) => Boolean(await workspaceRepository.findById(id))))
    roadmapService = new RoadmapService(roadmapRepository, providerManager, (id) => workspaceRepository.findById(id), (id) => { const difficulties = (database!.sqlite.prepare("SELECT topic_id AS topicId FROM topic_learning_states WHERE workspace_id = ? AND (difficulty_level IN ('medium','high') OR needs_review = 1) ORDER BY difficulty_level DESC").all(id) as Array<{ topicId: string }>).map((item) => item.topicId.split(':').at(-1) ?? item.topicId); const deadline = (database!.sqlite.prepare('SELECT due_at AS dueAt FROM academic_events WHERE workspace_id = ? AND due_at >= ? ORDER BY due_at LIMIT 1').get(id, Date.now()) as { dueAt: number } | undefined)?.dueAt ?? null; const availability = database!.sqlite.prepare('SELECT weekday, minutes FROM academic_availability ORDER BY weekday').all() as Array<{ weekday: number; minutes: number }>; const workspace = database!.sqlite.prepare('SELECT name FROM workspaces WHERE id = ?').get(id) as { name: string } | undefined; const override = database!.sqlite.prepare('SELECT subject, declared_level AS declaredLevel, declared_knowledge_json AS knowledge, declared_difficulties_json AS difficulties, goals_json AS goals FROM workspace_learning_overrides WHERE workspace_id = ?').get(id) as { subject: string; declaredLevel: string | null; knowledge: string; difficulties: string; goals: string } | undefined; const academic = workspace ? academicSubjectContext.get(workspace.name) : null; const related = (database!.sqlite.prepare("SELECT subject, relation FROM workspace_academic_contexts WHERE workspace_id = ? AND relation != 'primary'").all(id) as Array<{ subject: string; relation: string }>).flatMap((item) => { const context = academicSubjectContext.get(item.subject); return context ? [{ ...context, relation: item.relation }] : [] }); const knownContext = [...(override ? [`Contexto local: ${override.subject}`, `Nível local declarado: ${override.declaredLevel ?? 'não informado'}`, ...(JSON.parse(override.knowledge) as string[]), ...(JSON.parse(override.difficulties) as string[]).map((item) => `Dificuldade local: ${item}`), ...(JSON.parse(override.goals) as string[]).map((item) => `Objetivo local: ${item}`)] : []), ...(academic ? [`Contexto principal: ${academic.subject}`, `Nível declarado: ${academic.declaredLevel ?? 'não informado'}`, ...academic.declaredKnowledge, ...academic.declaredDifficulties.map((item) => `Dificuldade declarada: ${item}`), ...academic.goals.map((item) => `Objetivo: ${item}`)] : []), ...related.flatMap((context) => [`Contexto relacionado (${context.relation}): ${context.subject}`, ...context.declaredKnowledge.map((item) => `${context.subject}: ${item}`), ...context.declaredDifficulties.map((item) => `Dificuldade declarada em ${context.subject}: ${item}`), ...context.goals.map((item) => `Objetivo em ${context.subject}: ${item}`)])]; return { difficulties, deadline, availability, knownContext } }, curriculumSourceService, Date.now, () => crypto.randomUUID(), materialService, heavyGenerationQueue)
    provisioningCoordinator = new InitialProvisioningCoordinator(database, contentRepository, () => contentWorker?.wake(), Date.now, performanceTimelines)
    contentWorker = new ContentGenerationWorker({ repository: contentRepository, admission: heavyGenerationQueue, handlers: createContentJobHandlers({ database, roadmap: roadmapService, lessons: studyLessonService, exercises: exerciseService, planning: planningService }), onPublished: (job) => provisioningCoordinator.onPublished(job) })
    contentWorker.start()
    roadmapService.setRoadmapChangedHandler((roadmap, atomicallyAdopted) => {
      contentWorker?.cancelWorkspace(roadmap.workspaceId)
      if (atomicallyAdopted) provisioningCoordinator.resumeApprovedRoadmap(roadmap.workspaceId)
      else provisioningCoordinator.adoptAndResumeApprovedRoadmap(roadmap)
      contentWorker?.wake()
    })
    workspaceProvisioning = new WorkspaceProvisioningService({ repository: new SqliteWorkspaceProvisioningRepository(database), ensureRoadmap: (id, materialIds) => roadmapService.ensureLearningPathWithMaterials(id, materialIds), getRoadmap: (id) => roadmapService.get(id), ensureLesson: (input) => studyLessonService.getOrCreate(input), listReadyMaterialIds: (id) => materialService.list(id).filter((item) => item.status === 'ready').map((item) => item.id), initializeContent: (id) => provisioningCoordinator.initialize(id) })
    registerRoadmapHandlers(roadmapService)
    workspaceService.setLearningPathEnsurer((workspaceId) => roadmapService.ensureLearningPath(workspaceId))
    providerManager.onAvailable(() => { roadmapService.retryWaitingForProvider(); contentWorker?.retryProviderUnavailable(); workspaceProvisioning?.resumePending() })
    workspaceProvisioning.resumePending()
    for (const workspace of await workspaceRepository.listActive()) if (!workspace.provisioning) void roadmapService.ensureLearningPath(workspace.id).catch(() => {})
    const subjectWorkspaceResolver = new SubjectWorkspaceResolver({ listWorkspaces: async () => (await workspaceRepository.listActive()).flatMap((summary) => { const workspace = database!.sqlite.prepare('SELECT id,name,objective,status,created_at AS createdAt,updated_at AS updatedAt,last_opened_at AS lastOpenedAt,archived_at AS archivedAt FROM workspaces WHERE id=?').get(summary.id) as Workspace | undefined; return workspace ? [workspace] : [] }), listAcademicRelations: () => database!.sqlite.prepare('SELECT workspace_id AS workspaceId,subject,relation FROM workspace_academic_contexts').all() as Array<{ workspaceId: string; subject: string; relation: string }>, suggestSemantic: async (input) => { const provider = providerManager.route('planner'); if (!provider) return []; const candidates = input.workspaces.map((workspace, index) => ({ candidateId: `candidate-${index + 1}`, name: workspace.name, contextSubjects: workspace.contextSubjects })); const ids = new Map(candidates.map((candidate, index) => [candidate.candidateId, input.workspaces[index]!.id])); const response = await provider.sendMessage({ messages: [{ role: 'system', content: 'Suggest possible Workspace matches for one academic subject. Return only JSON {candidates:[{candidateId,confidence,reason}]}. A suggestion is never a definitive link. Include every plausible candidate; two plausible candidates must remain separate. Use only supplied ephemeral candidateId values and bounded subject/name context.' }, { role: 'user', content: JSON.stringify({ subject: input.subject, candidates }) }], maxOutputTokens: 500 }); const parsed = z.object({ candidates: z.array(z.object({ candidateId: z.string(), confidence: z.number().min(0).max(1), reason: z.string().trim().min(1).max(300) }).strict()).max(10) }).strict().parse(extractJsonDocument(response.content)); return parsed.candidates.flatMap(({ candidateId, ...candidate }) => { const workspaceId = ids.get(candidateId); return workspaceId ? [{ workspaceId, ...candidate }] : [] }) } })
    const eventWorkspaceLinks = new EventWorkspaceLinkService(new SqliteEventWorkspaceLinkRepository(database, academicLife, academicSubjectContext, (id) => workspaceRepository.findById(id)))
    let plannerActionService!: PlannerActionService
    const suggestEventLinks = async (item: import('../shared/contracts/academic-life-contract').AcademicLifeItem, includePrepare = true) => { let subject = ''; try { const metadata = JSON.parse(item.details) as { schema?: string; subject?: string }; if (metadata.schema === 'academic-event/v1') subject = metadata.subject ?? '' } catch {} if (!subject) return { status: 'none', actions: [] }; const shareableWorkspaceIds = item.shareWithAi ? (database!.sqlite.prepare('SELECT w.id FROM workspaces w JOIN workspace_study_states s ON s.workspace_id=w.id WHERE w.status=\'active\' AND s.share_context_with_ai=1').all() as Array<{ id: string }>).map((row) => row.id) : []; const resolution = await subjectWorkspaceResolver.resolve(subject, { allowSemantic: item.shareWithAi && shareableWorkspaceIds.length > 0, semanticWorkspaceIds: shareableWorkspaceIds }); const candidates = resolution.status === 'ambiguous' ? resolution.candidates : resolution.status === 'none' ? [] : [resolution.candidate]; if (!includePrepare && candidates.length === 0) return { resolution, actions: [] }; const originMessageId = `academic-event-options:${item.id}`; const contextVersion = item.updatedAt; const action = (input: Parameters<PlannerActionService['propose']>[0]) => plannerActionService.propose({ ...input, idempotencyScope: `academic-event-option:${item.id}:${input.type}:${JSON.stringify(input.payload)}` }); const actions = candidates.map((candidate) => action({ type: 'academic.event.linkWorkspace', payload: { eventId: item.id, workspaceId: candidate.workspaceId, subject }, label: `Vincular ${item.title} a ${candidate.workspaceName}`, originMessageId, contextVersion })); actions.push(action({ type: 'academic.event.keepUnlinked', payload: { eventId: item.id }, label: `Manter ${item.title} sem Workspace`, originMessageId, contextVersion })); if (includePrepare) actions.push(action({ type: 'workspace.prepare', payload: { name: subject, objective: `Preparação acadêmica para ${item.title}` }, label: `Preparar Workspace de ${subject}`, originMessageId, contextVersion })); return { resolution, actions } }
    plannerActionService = new PlannerActionService({ repository: new DrizzlePlannerActionRepository(database), createWorkspace: (input) => workspaceService.create({ ...input, declaredKnowledge: [], declaredDifficulties: [], goals: [] }), createProject: (workspaceId, name, language) => new ProjectService(projectRepository, async (id) => Boolean(await workspaceRepository.findById(id))).create(workspaceId, name, language), createDeadline: (input) => planningService.createDeadline(input), addRoutine: (content) => planningService.addRoutineNote(content), saveAcademicLife: (input) => academicLife.save(input), transitionAcademicLife: (id, status) => academicLife.transition(id, status), linkAcademicEventWorkspace: (eventId, workspaceId, subject) => eventWorkspaceLinks.link(eventId, workspaceId, subject), keepAcademicEventUnlinked: (eventId) => academicLife.requireActiveUnlinkedEvent(eventId), suggestAcademicEventWorkspaces: suggestEventLinks, setTodayBudget: (input) => planningService.setTodayBudget(input), setWeekdayAvailability: (input) => planningService.setWeekdayAvailability(input), recalculatePlan: (timezone) => planningService.replanWeek(timezone), setPlanItemCompletion: async (workspaceId, itemId, completed) => planningService.setPlanItemCompletion({ workspaceId, itemId, completed }) })
    workspaceService.setOrphanEventDiscovery(async () => { for (const item of academicLife.getProjection().current.filter((event) => event.workspaceId === null && ['event', 'commitment'].includes(event.kind))) await suggestEventLinks(item, false) })
    registerPlannerActionHandlers(plannerActionService)
    registerAcademicLifeHandlers(academicLife)
    registerConversationHandlers(homePlannerService, workspaceCoachService, new HomeOrganizerService(homePlannerService, planningService, plannerActionService, () => workspaceRepository.listActive(), Date.now, () => academicLife.getProjection(100).current, new ProviderOrganizerIntentInterpreter(providerManager)), workspaceActions, database, performanceTimelines)
    registerReportHandlers(new ReportService(new DrizzleReportRepository(database)))
    const workspaceOnboarding = new WorkspaceOnboardingService({ repository: new DrizzleConversationRepository(database), providerManager, academicContext: academicSubjectContext })
    validateWorkspaceAnalysis = (token, revision, subject, focus, context) => workspaceOnboarding.validate(token, revision, subject, focus, context)
    registerWorkspaceOnboardingHandlers(workspaceOnboarding, (input) => academicSubjectContext.replace(input))
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

app.on('will-quit', (event) => {
  if (contentWorker) {
    event.preventDefault()
    const worker = contentWorker
    contentWorker = null
    void worker.stop().finally(() => app.quit())
    return
  }
  database?.close()
  database = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
