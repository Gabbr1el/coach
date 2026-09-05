import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'

export function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const senderFrame = event.senderFrame
  if (!senderFrame || !BrowserWindow.fromWebContents(event.sender) || senderFrame !== event.sender.mainFrame) {
    throw new Error('IPC sender is not a main Coach window frame')
  }

  const developmentUrl = process.env['ELECTRON_RENDERER_URL']
  if (developmentUrl) {
    if (new URL(senderFrame.url).origin === new URL(developmentUrl).origin) return
    throw new Error('Untrusted development IPC sender')
  }

  const trustedRendererUrl = pathToFileURL(join(__dirname, '../../dist/index.html')).href
  if (senderFrame.url !== trustedRendererUrl) {
    throw new Error('Untrusted IPC sender')
  }
}
