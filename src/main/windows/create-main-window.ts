import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { configureWindowSecurity } from '../security/configure-window-security'

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#f1eee4',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged && !process.env['COACH_DISABLE_DEVTOOLS'],
    },
  })

  configureWindowSecurity(window)

  window.once('ready-to-show', () => {
    window.show()
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  const loadRenderer = rendererUrl
    ? window.loadURL(rendererUrl)
    : window.loadFile(join(__dirname, '../../dist/index.html'))

  void loadRenderer.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown renderer load error'
    void dialog.showMessageBox(window, {
      type: 'error',
      title: 'Coach could not start',
      message: 'The application interface failed to load.',
      detail: message,
    })
  })

  return window
}
