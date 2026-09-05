import { contextBridge, ipcRenderer } from 'electron'
import {
  APPLICATION_GET_INFO_CHANNEL,
  type CoachDesktopApi,
} from '../shared/contracts/application-contract'

const api: CoachDesktopApi = {
  application: {
    getInfo: () => ipcRenderer.invoke(APPLICATION_GET_INFO_CHANNEL),
  },
}

contextBridge.exposeInMainWorld('coach', Object.freeze(api))
