import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  APPLICATION_API_VERSION,
  APPLICATION_GET_INFO_CHANNEL,
  type ApplicationInfo,
} from '../../shared/contracts/application-contract'

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const senderFrame = event.senderFrame
  if (!senderFrame) {
    throw new Error('Missing IPC sender frame')
  }

  const senderUrl = senderFrame.url
  const developmentUrl = process.env['ELECTRON_RENDERER_URL']

  if (!BrowserWindow.fromWebContents(event.sender) || senderFrame !== event.sender.mainFrame) {
    throw new Error('IPC sender is not a main Coach window frame')
  }

  if (developmentUrl) {
    try {
      if (new URL(senderUrl).origin === new URL(developmentUrl).origin) {
        return
      }
    } catch {
      throw new Error('Malformed development renderer URL')
    }
  }

  try {
    const trustedRendererUrl = pathToFileURL(join(__dirname, '../../dist/index.html')).href
    if (senderUrl === trustedRendererUrl) {
      return
    }
  } catch {
    throw new Error('Malformed IPC sender URL')
  }

  throw new Error('Untrusted IPC sender')
}

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
