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
  },
  provider: {
    getStatus: () => ipcRenderer.invoke(PROVIDER_CHANNELS.getStatus),
    listAccounts: () => ipcRenderer.invoke(PROVIDER_CHANNELS.listAccounts),
    configureOpenAI: (input) => ipcRenderer.invoke(PROVIDER_CHANNELS.configureOpenAI, input),
    selectAccount: (accountId) => ipcRenderer.invoke(PROVIDER_CHANNELS.selectAccount, accountId),
    removeAccount: (accountId) => ipcRenderer.invoke(PROVIDER_CHANNELS.removeAccount, accountId),
  },
}

contextBridge.exposeInMainWorld('coach', Object.freeze(api))
