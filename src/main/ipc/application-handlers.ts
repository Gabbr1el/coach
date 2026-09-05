import { app, ipcMain } from 'electron'
import {
  APPLICATION_API_VERSION,
  APPLICATION_GET_INFO_CHANNEL,
  type ApplicationInfo,
} from '../../shared/contracts/application-contract'
import { assertTrustedSender } from './trusted-sender'

export function registerApplicationHandlers(): void {
  ipcMain.handle(APPLICATION_GET_INFO_CHANNEL, (event): ApplicationInfo => {
    assertTrustedSender(event)

    return {
      apiVersion: APPLICATION_API_VERSION,
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
    }
  })
}
