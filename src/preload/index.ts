import { contextBridge, ipcRenderer } from 'electron'
import {
  APPLICATION_GET_INFO_CHANNEL,
  type CoachDesktopApi,
} from '../shared/contracts/application-contract'
import { WORKSPACE_CHANNELS } from '../shared/contracts/workspace-channels'
import { CONVERSATION_CHANNELS } from '../shared/contracts/conversation-channels'
import { PROVIDER_CHANNELS } from '../shared/contracts/provider-channels'
import { STUDY_WORKSPACE_CHANNELS } from '../shared/contracts/study-workspace-channels'
import { CODE_EXECUTION_CHANNELS } from '../shared/contracts/code-execution-channels'
import { OBSERVER_CHANNELS } from '../shared/contracts/observer-channels'
import { PLANNING_CHANNELS } from '../shared/contracts/planning-channels'
import { MATERIAL_CHANNELS } from '../shared/contracts/material-channels'
import { SESSION_NAVIGATION_CHANNELS } from '../shared/contracts/session-navigation-channels'
import { BACKUP_CHANNELS } from '../shared/contracts/backup-channels'
import { PROJECT_CHANNELS } from '../shared/contracts/project-channels'
import { ROADMAP_CHANNELS } from '../shared/contracts/roadmap-channels'
import { PLANNER_ACTION_CHANNELS } from '../shared/contracts/planner-action-channels'
import { REPORT_CHANNELS } from '../shared/contracts/report-channels'
import { WORKSPACE_ONBOARDING_CHANNELS } from '../shared/contracts/workspace-onboarding-channels'
import { STUDY_PROGRESS_CHANNELS } from '../shared/contracts/study-progress-channels'
import { STUDY_LESSON_CHANNELS } from '../shared/contracts/study-lesson-channels'
import { EXERCISE_CHANNELS } from '../shared/contracts/exercise-channels'
import { ACADEMIC_LIFE_CHANNELS } from '../shared/contracts/academic-life-channels'
import { REVIEW_CHANNELS } from '../shared/contracts/review-channels'

const api: CoachDesktopApi = {
  application: {
    getInfo: () => ipcRenderer.invoke(APPLICATION_GET_INFO_CHANNEL),
  },
  studyProgress: {
    get: (workspaceId) => ipcRenderer.invoke(STUDY_PROGRESS_CHANNELS.get, { workspaceId }),
    select: (input) => ipcRenderer.invoke(STUDY_PROGRESS_CHANNELS.select, input),
    updatePosition: (input) => ipcRenderer.invoke(STUDY_PROGRESS_CHANNELS.updatePosition, input),
    answerCheckpoint: (input) => ipcRenderer.invoke(STUDY_PROGRESS_CHANNELS.answerCheckpoint, input),
    retryCheckpointReasoning: (input) => ipcRenderer.invoke(STUDY_PROGRESS_CHANNELS.retryCheckpointReasoning, input),
    completeTopic: (input) => ipcRenderer.invoke(STUDY_PROGRESS_CHANNELS.completeTopic, input),
    record: (input) => ipcRenderer.invoke(STUDY_PROGRESS_CHANNELS.record, input),
  },
  studyLesson: {
    getOrCreate: (input) => ipcRenderer.invoke(STUDY_LESSON_CHANNELS.getOrCreate, input),
    evaluate: (input) => ipcRenderer.invoke(STUDY_LESSON_CHANNELS.evaluate, input),
    adaptSection: (input) => ipcRenderer.invoke(STUDY_LESSON_CHANNELS.adaptSection, input),
    listAdaptations: (input) => ipcRenderer.invoke(STUDY_LESSON_CHANNELS.listAdaptations, input),
    restoreOriginal: (input) => ipcRenderer.invoke(STUDY_LESSON_CHANNELS.restoreOriginal, input),
    activateAdaptation: (input) => ipcRenderer.invoke(STUDY_LESSON_CHANNELS.activateAdaptation, input),
    getPreferences: (workspaceId) => ipcRenderer.invoke(STUDY_LESSON_CHANNELS.getPreferences, { workspaceId }),
    updatePreferences: (input) => ipcRenderer.invoke(STUDY_LESSON_CHANNELS.updatePreferences, input),
  },
  exercise: {
    ensureSet: (input) => ipcRenderer.invoke(EXERCISE_CHANNELS.ensureSet, input),
    getSet: (input) => ipcRenderer.invoke(EXERCISE_CHANNELS.getSet, input),
    saveDraft: (input) => ipcRenderer.invoke(EXERCISE_CHANNELS.saveDraft, input),
    run: (input) => ipcRenderer.invoke(EXERCISE_CHANNELS.run, input),
    submit: (input) => ipcRenderer.invoke(EXERCISE_CHANNELS.submit, input),
    requestHelp: (input) => ipcRenderer.invoke(EXERCISE_CHANNELS.requestHelp, input),
  },
  academicLife: {
    getProjection: () => ipcRenderer.invoke(ACADEMIC_LIFE_CHANNELS.getProjection),
    save: (input) => ipcRenderer.invoke(ACADEMIC_LIFE_CHANNELS.save, input),
    transition: (input) => ipcRenderer.invoke(ACADEMIC_LIFE_CHANNELS.transition, input),
  },
  review: {
    getActive: (workspaceId) => ipcRenderer.invoke(REVIEW_CHANNELS.getActive, { workspaceId }),
    start: (input) => ipcRenderer.invoke(REVIEW_CHANNELS.start, input),
    submit: (input) => ipcRenderer.invoke(REVIEW_CHANNELS.submit, input),
    requestHelp: (input) => ipcRenderer.invoke(REVIEW_CHANNELS.requestHelp, input),
  },
  workspace: {
    list: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.list),
    create: (input) => ipcRenderer.invoke(WORKSPACE_CHANNELS.create, input),
    prepareDraft: (input) => ipcRenderer.invoke(WORKSPACE_CHANNELS.prepareDraft, input),
    discardDraft: (id) => ipcRenderer.invoke(WORKSPACE_CHANNELS.discardDraft, id),
    getProvisioning: (id) => ipcRenderer.invoke(WORKSPACE_CHANNELS.getProvisioning, id),
    retryProvisioning: (id) => ipcRenderer.invoke(WORKSPACE_CHANNELS.retryProvisioning, id),
    open: (id) => ipcRenderer.invoke(WORKSPACE_CHANNELS.open, id),
    archive: (id) => ipcRenderer.invoke(WORKSPACE_CHANNELS.archive, id),
  },
  conversation: {
    listHomeMessages: () => ipcRenderer.invoke(CONVERSATION_CHANNELS.listHomeMessages),
    sendHomeMessage: (input) => ipcRenderer.invoke(CONVERSATION_CHANNELS.sendHomeMessage, input),
    organizeHomeMessage: (input) => ipcRenderer.invoke(CONVERSATION_CHANNELS.organizeHomeMessage, input),
    saveHomeActionResult: (content) => ipcRenderer.invoke(CONVERSATION_CHANNELS.saveHomeActionResult, content),
    streamHomeMessage: (input, onEvent) => {
      let disposed = false
      const dispose = () => {
        if (disposed) return
        disposed = true
        ipcRenderer.removeListener(CONVERSATION_CHANNELS.homeStreamEvent, listener)
      }
      const listener = (_event: Electron.IpcRendererEvent, streamEvent: Parameters<typeof onEvent>[0]) => {
        if (disposed || streamEvent.requestId !== input.requestId) return
        const terminal = streamEvent.type === 'completed' || streamEvent.type === 'cancelled' || streamEvent.type === 'error'
        if (terminal) dispose()
        onEvent(streamEvent)
      }
      ipcRenderer.on(CONVERSATION_CHANNELS.homeStreamEvent, listener)
      void ipcRenderer.invoke(CONVERSATION_CHANNELS.streamHomeMessage, input).catch(() => {
        if (disposed) return
        dispose()
        onEvent({ requestId: input.requestId, type: 'error', code: 'REQUEST_FAILED' })
      })
      return {
        cancel: () => {
          if (!disposed) void ipcRenderer.invoke(CONVERSATION_CHANNELS.cancelHomeStream, { requestId: input.requestId })
        },
        dispose,
      }
    },
    listWorkspaceMessages: (workspaceId) => ipcRenderer.invoke(CONVERSATION_CHANNELS.listWorkspaceMessages, { workspaceId }),
    executeWorkspaceAction: (input) => ipcRenderer.invoke(CONVERSATION_CHANNELS.executeWorkspaceAction, input),
    streamWorkspaceMessage: (input, onEvent) => {
      let disposed = false
      const dispose = () => {
        if (disposed) return
        disposed = true
        ipcRenderer.removeListener(CONVERSATION_CHANNELS.workspaceStreamEvent, listener)
      }
      let firstTokenReported = false
      const listener = (_event: Electron.IpcRendererEvent, streamEvent: Parameters<typeof onEvent>[0]) => {
        if (disposed || streamEvent.requestId !== input.requestId) return
        const terminal = streamEvent.type === 'completed' || streamEvent.type === 'cancelled' || streamEvent.type === 'error'
        if (terminal) dispose()
        onEvent(streamEvent)
        if (streamEvent.type === 'text-delta' && streamEvent.content && !firstTokenReported) {
          firstTokenReported = true
          setTimeout(() => void ipcRenderer.invoke(CONVERSATION_CHANNELS.rendererFirstToken, { requestId: input.requestId }), 0)
        }
      }
      ipcRenderer.on(CONVERSATION_CHANNELS.workspaceStreamEvent, listener)
      void ipcRenderer.invoke(CONVERSATION_CHANNELS.streamWorkspaceMessage, input).catch(() => {
        if (disposed) return
        dispose()
        onEvent({ requestId: input.requestId, type: 'error', code: 'REQUEST_FAILED' })
      })
      return {
        cancel: () => { if (!disposed) void ipcRenderer.invoke(CONVERSATION_CHANNELS.cancelWorkspaceStream, { requestId: input.requestId }) },
        dispose,
      }
    },
  },
  provider: {
    getStatus: () => ipcRenderer.invoke(PROVIDER_CHANNELS.getStatus),
    listAccounts: () => ipcRenderer.invoke(PROVIDER_CHANNELS.listAccounts),
    configureOpenAI: (input) => ipcRenderer.invoke(PROVIDER_CHANNELS.configureOpenAI, input),
    configureCompatible: (input) => ipcRenderer.invoke(PROVIDER_CHANNELS.configureCompatible, input),
    selectAccount: (accountId) => ipcRenderer.invoke(PROVIDER_CHANNELS.selectAccount, accountId),
    removeAccount: (accountId) => ipcRenderer.invoke(PROVIDER_CHANNELS.removeAccount, accountId),
  },
  studyWorkspace: {
    getState: (workspaceId) => ipcRenderer.invoke(STUDY_WORKSPACE_CHANNELS.getState, { workspaceId }),
    saveDocument: (input) => ipcRenderer.invoke(STUDY_WORKSPACE_CHANNELS.saveDocument, input),
    saveNotes: (input) => ipcRenderer.invoke(STUDY_WORKSPACE_CHANNELS.saveNotes, input),
    updateContextSharing: (input) => ipcRenderer.invoke(STUDY_WORKSPACE_CHANNELS.updateContextSharing, input),
    togglePlanItem: (input) => ipcRenderer.invoke(STUDY_WORKSPACE_CHANNELS.togglePlanItem, input),
    completePlanItem: (input) => ipcRenderer.invoke(STUDY_WORKSPACE_CHANNELS.completePlanItem, input),
    setPlanItemCompletion: (input) => ipcRenderer.invoke(STUDY_WORKSPACE_CHANNELS.setPlanItemCompletion, input),
    recalculatePlan: (input) => ipcRenderer.invoke(STUDY_WORKSPACE_CHANNELS.recalculatePlan, input),
    refreshLivePlan: (input) => ipcRenderer.invoke(STUDY_WORKSPACE_CHANNELS.refreshLivePlan, input),
    activatePlanItem: (input) => ipcRenderer.invoke(STUDY_WORKSPACE_CHANNELS.activatePlanItem, input),
    updateTimer: (input) => ipcRenderer.invoke(STUDY_WORKSPACE_CHANNELS.updateTimer, input),
    setTimerDuration: (input) => ipcRenderer.invoke(STUDY_WORKSPACE_CHANNELS.setTimerDuration, input),
    flushDrafts: (input) => ipcRenderer.sendSync(STUDY_WORKSPACE_CHANNELS.flushDrafts, input) === true,
    completeSession: (workspaceId) => ipcRenderer.invoke(STUDY_WORKSPACE_CHANNELS.completeSession, { workspaceId }),
    listSessionHistory: (workspaceId) => ipcRenderer.invoke(STUDY_WORKSPACE_CHANNELS.listSessionHistory, { workspaceId }),
  },
  codeExecution: {
    execute: (input) => ipcRenderer.invoke(CODE_EXECUTION_CHANNELS.execute, input),
    executeProject: (input) => ipcRenderer.invoke(CODE_EXECUTION_CHANNELS.executeProject, input),
    executeInteractive: (input) => ipcRenderer.invoke(CODE_EXECUTION_CHANNELS.executeInteractive, input),
    saveInteractiveState: (input) => ipcRenderer.invoke(CODE_EXECUTION_CHANNELS.saveInteractiveState, input),
    listInteractiveStates: (input) => ipcRenderer.invoke(CODE_EXECUTION_CHANNELS.listInteractiveStates, input),
    getToolchains: () => ipcRenderer.invoke(CODE_EXECUTION_CHANNELS.getToolchains),
  },
  observer: {
    getState: (workspaceId) => ipcRenderer.invoke(OBSERVER_CHANNELS.getState, { workspaceId }),
    recordFocus: (input) => ipcRenderer.invoke(OBSERVER_CHANNELS.recordFocus, input),
  },
  planning: {
    listPriorities: () => ipcRenderer.invoke(PLANNING_CHANNELS.listPriorities),
    createDeadline: (input) => ipcRenderer.invoke(PLANNING_CHANNELS.createDeadline, input),
    addRoutineNote: (content) => ipcRenderer.invoke(PLANNING_CHANNELS.addRoutineNote, { content }),
    listRoutineNotes: () => ipcRenderer.invoke(PLANNING_CHANNELS.listRoutineNotes),
    getSchedule: () => ipcRenderer.invoke(PLANNING_CHANNELS.getSchedule),
    getWeeklyPlan: () => ipcRenderer.invoke(PLANNING_CHANNELS.getWeeklyPlan),
    replanWeek: () => ipcRenderer.invoke(PLANNING_CHANNELS.replanWeek),
    applyAcademicMessage: (content) => ipcRenderer.invoke(PLANNING_CHANNELS.applyAcademicMessage, { content }),
    getAcademicOverview: () => ipcRenderer.invoke(PLANNING_CHANNELS.getAcademicOverview),
  },
  material: {
    importPdf: (workspaceId) => ipcRenderer.invoke(MATERIAL_CHANNELS.importPdf, { workspaceId }),
    importFile: (workspaceId) => ipcRenderer.invoke(MATERIAL_CHANNELS.importFile, { workspaceId }),
    list: (workspaceId) => ipcRenderer.invoke(MATERIAL_CHANNELS.list, { workspaceId }),
    search: (input) => ipcRenderer.invoke(MATERIAL_CHANNELS.search, input),
    read: (input) => ipcRenderer.invoke(MATERIAL_CHANNELS.read, input),
    readPage: (input) => ipcRenderer.invoke(MATERIAL_CHANNELS.readPage, input),
    overview: (input) => ipcRenderer.invoke(MATERIAL_CHANNELS.overview, input),
    updateRelevance: (input) => ipcRenderer.invoke(MATERIAL_CHANNELS.updateRelevance, input),
    decide: (input) => ipcRenderer.invoke(MATERIAL_CHANNELS.decide, input),
  },
  sessionNavigation: {
    addSavedForLater: (input) => ipcRenderer.invoke(SESSION_NAVIGATION_CHANNELS.addSavedForLater, input),
    listSavedForLater: (workspaceId) => ipcRenderer.invoke(SESSION_NAVIGATION_CHANNELS.listSavedForLater, { workspaceId }),
    listOutline: (workspaceId) => ipcRenderer.invoke(SESSION_NAVIGATION_CHANNELS.listOutline, { workspaceId }),
  },
  backup: {
    exportBackup: () => ipcRenderer.invoke(BACKUP_CHANNELS.exportBackup),
    restoreBackup: () => ipcRenderer.invoke(BACKUP_CHANNELS.restoreBackup),
  },
  project: {
    get: (workspaceId) => ipcRenderer.invoke(PROJECT_CHANNELS.get, { workspaceId }),
    create: (input) => ipcRenderer.invoke(PROJECT_CHANNELS.create, input),
    createFile: (input) => ipcRenderer.invoke(PROJECT_CHANNELS.createFile, input),
    saveFile: (input) => ipcRenderer.invoke(PROJECT_CHANNELS.saveFile, input),
    renameFile: (input) => ipcRenderer.invoke(PROJECT_CHANNELS.renameFile, input),
    deleteFile: (input) => ipcRenderer.invoke(PROJECT_CHANNELS.deleteFile, input),
    openFile: (input) => ipcRenderer.invoke(PROJECT_CHANNELS.openFile, input),
  },
  roadmap: {
    get: (workspaceId) => ipcRenderer.invoke(ROADMAP_CHANNELS.get, { workspaceId }),
    getLearningPathState: (workspaceId) => ipcRenderer.invoke(ROADMAP_CHANNELS.getLearningPathState, { workspaceId }),
    generate: (workspaceId, instruction) => ipcRenderer.invoke(ROADMAP_CHANNELS.generate, { workspaceId, instruction }),
    getRebuildPreview: (input) => ipcRenderer.invoke(ROADMAP_CHANNELS.getRebuildPreview, input),
    previewRebuild: (input) => ipcRenderer.invoke(ROADMAP_CHANNELS.previewRebuild, input),
    applyRebuild: (input) => ipcRenderer.invoke(ROADMAP_CHANNELS.applyRebuild, input),
    accept: (input) => ipcRenderer.invoke(ROADMAP_CHANNELS.accept, input),
  },
  plannerAction: {
    listPending: () => ipcRenderer.invoke(PLANNER_ACTION_CHANNELS.listPending),
    resolve: (input) => ipcRenderer.invoke(PLANNER_ACTION_CHANNELS.resolve, input),
  },
  report: { getGlobalOverview: () => ipcRenderer.invoke(REPORT_CHANNELS.getGlobalOverview) },
  workspaceOnboarding: { analyze: (input) => ipcRenderer.invoke(WORKSPACE_ONBOARDING_CHANNELS.analyze, input), replaceAcademicContext: (input) => ipcRenderer.invoke('workspace-onboarding:replace-academic-context', input) },
}

contextBridge.exposeInMainWorld('coach', Object.freeze(api))
