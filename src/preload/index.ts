import { contextBridge, ipcRenderer } from 'electron'
import {
  APPLICATION_GET_INFO_CHANNEL,
  type CoachDesktopApi,
} from '../shared/contracts/application-contract'
import { WORKSPACE_CHANNELS } from '../shared/contracts/workspace-channels'
import { CONVERSATION_CHANNELS } from '../shared/contracts/conversation-channels'
import { PROVIDER_CHANNELS } from '../shared/contracts/provider-channels'

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
        if (streamEvent.requestId !== input.requestId) return
        onEvent(streamEvent)
        if (streamEvent.type === 'completed' || streamEvent.type === 'cancelled' || streamEvent.type === 'error') dispose()
      }
      ipcRenderer.on(CONVERSATION_CHANNELS.homeStreamEvent, listener)
      void ipcRenderer.invoke(CONVERSATION_CHANNELS.streamHomeMessage, input).catch(() => {
        onEvent({ requestId: input.requestId, type: 'error', code: 'REQUEST_FAILED' })
        dispose()
      })
      return {
        cancel: () => {
          if (!disposed) void ipcRenderer.invoke(CONVERSATION_CHANNELS.cancelHomeStream, { requestId: input.requestId })
        },
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
}

contextBridge.exposeInMainWorld('coach', Object.freeze(api))
