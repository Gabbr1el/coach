import type { BrowserWindow, HandlerDetails } from 'electron'
import { app, shell } from 'electron'

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:'])

function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    return ALLOWED_EXTERNAL_PROTOCOLS.has(new URL(rawUrl).protocol)
  } catch {
    return false
  }
}

export function configureWindowSecurity(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler((details: HandlerDetails) => {
    if (isAllowedExternalUrl(details.url)) {
      void shell.openExternal(details.url)
    }

    return { action: 'deny' }
  })

  const preventUntrustedNavigation = (event: Electron.Event, targetUrl: string): void => {
    const developmentUrl = process.env['ELECTRON_RENDERER_URL']
    let isTrustedDevelopmentUrl = false

    try {
      isTrustedDevelopmentUrl = developmentUrl
        ? new URL(targetUrl).origin === new URL(developmentUrl).origin
        : false
    } catch {
      isTrustedDevelopmentUrl = false
    }

    let isTrustedFile = false
    try {
      const target = new URL(targetUrl)
      const applicationRoot = `${app.getAppPath().replace(/\/$/, '')}/`
      isTrustedFile = target.protocol === 'file:' && target.pathname.startsWith(applicationRoot)
    } catch {
      isTrustedFile = false
    }

    if (!isTrustedDevelopmentUrl && !isTrustedFile) {
      event.preventDefault()
    }
  }

  window.webContents.on('will-navigate', preventUntrustedNavigation)
  window.webContents.on('will-redirect', preventUntrustedNavigation)

  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  window.webContents.session.setPermissionCheckHandler(() => false)
}
