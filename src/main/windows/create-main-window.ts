import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
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
    window.focus()
  })
  window.on('show', () => { window.webContents.focus() })
  if (process.env['COACH_STARTUP_PROBE'] === '1') {
    window.webContents.on('console-message', (_event, _level, message) => console.info(`[renderer-console] ${message}`))
    window.webContents.once('did-finish-load', () => {
      setTimeout(() => { void window.webContents.executeJavaScript(`JSON.stringify({ href: location.href, readyState: document.readyState, coachType: typeof window.coach, rootLength: document.getElementById('root')?.innerHTML.length ?? 0 })`).then((result) => { console.info(`[startup-probe] ${result}`); if (process.env['COACH_STARTUP_PROBE_FILE']) writeFileSync(process.env['COACH_STARTUP_PROBE_FILE'], result) }) }, 1_000)
    })
  }

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
