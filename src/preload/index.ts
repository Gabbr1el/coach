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

const api: CoachDesktopApi = {
  application: {
    getInfo: () => ipcRenderer.invoke(APPLICATION_GET_INFO_CHANNEL),
  },
  workspace: {
    list: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.list),
    create: (input) => ipcRenderer.invoke(WORKSPACE_CHANNELS.create, input),
    open: (id) => ipcRenderer.invoke(WORKSPACE_CHANNELS.open, id),
    archive: (id) => ipcRenderer.invoke(WORKSPACE_CHANNELS.archive, id),
  },
  conversation: {
    listHomeMessages: () => ipcRenderer.invoke(CONVERSATION_CHANNELS.listHomeMessages),
    sendHomeMessage: (input) => ipcRenderer.invoke(CONVERSATION_CHANNELS.sendHomeMessage, input),
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
    streamWorkspaceMessage: (input, onEvent) => {
      let disposed = false
      const dispose = () => {
        if (disposed) return
        disposed = true
        ipcRenderer.removeListener(CONVERSATION_CHANNELS.workspaceStreamEvent, listener)
      }
      const listener = (_event: Electron.IpcRendererEvent, streamEvent: Parameters<typeof onEvent>[0]) => {
        if (disposed || streamEvent.requestId !== input.requestId) return
        const terminal = streamEvent.type === 'completed' || streamEvent.type === 'cancelled' || streamEvent.type === 'error'
        if (terminal) dispose()
        onEvent(streamEvent)
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
    updateTimer: (input) => ipcRenderer.invoke(STUDY_WORKSPACE_CHANNELS.updateTimer, input),
    flushDrafts: (input) => ipcRenderer.sendSync(STUDY_WORKSPACE_CHANNELS.flushDrafts, input) === true,
  },
  codeExecution: {
    execute: (input) => ipcRenderer.invoke(CODE_EXECUTION_CHANNELS.execute, input),
  },
}

contextBridge.exposeInMainWorld('coach', Object.freeze(api))
