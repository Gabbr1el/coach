import { app, BrowserWindow } from 'electron'
import { registerApplicationHandlers } from './ipc/application-handlers'
import { createMainWindow } from './windows/create-main-window'
import { openCoachDatabase, type CoachDatabase } from './database/connection'
import { WorkspaceService } from '../application/workspaces/workspace-service'
import { DrizzleWorkspaceRepository } from './repositories/drizzle-workspace-repository'
import { registerWorkspaceHandlers } from './ipc/workspace-handlers'
import { HomePlannerService } from '../application/conversations/home-planner-service'
import { DrizzleConversationRepository } from './repositories/drizzle-conversation-repository'
import { registerConversationHandlers } from './ipc/conversation-handlers'
import { AIProviderManager } from '../application/ai/ai-provider-manager'
import { ProviderConfigurationService } from '../application/ai/provider-configuration-service'
import { DrizzleProviderConfigurationRepository } from './repositories/drizzle-provider-configuration-repository'
import { ElectronCredentialVault } from './security/electron-credential-vault'
import { OpenAIProvider } from './providers/openai-provider'
import { OpenAICompatibleProvider } from './providers/openai-compatible-provider'
import { registerProviderHandlers } from './ipc/provider-handlers'
import { WorkspaceCoachService } from '../application/conversations/workspace-coach-service'

let database: CoachDatabase | null = null
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
}

if (process.env['COACH_DISABLE_HARDWARE_ACCELERATION']) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
}

void app.whenReady().then(async () => {
  try {
    database = openCoachDatabase()
    const workspaceRepository = new DrizzleWorkspaceRepository(database)
    const workspaceService = new WorkspaceService({ repository: workspaceRepository })
    const providerManager = new AIProviderManager()
    const providerConfigurationService = new ProviderConfigurationService(
      new DrizzleProviderConfigurationRepository(database),
      new ElectronCredentialVault(),
      providerManager,
      (apiKey, model) => new OpenAIProvider(apiKey, model),
      (label, baseUrl, apiKey, model) => new OpenAICompatibleProvider(label, baseUrl, apiKey, model),
    )
    await providerConfigurationService.initialize()
    const homePlannerService = new HomePlannerService({
      repository: new DrizzleConversationRepository(database),
      providerManager,
    })
    const workspaceCoachService = new WorkspaceCoachService({
      repository: new DrizzleConversationRepository(database),
      providerManager,
      getWorkspace: (id) => workspaceRepository.findById(id),
    })
    registerApplicationHandlers()
    registerWorkspaceHandlers(workspaceService)
    registerConversationHandlers(homePlannerService, workspaceCoachService)
    registerProviderHandlers(providerConfigurationService)
    createMainWindow()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown startup error'
    console.error('Coach startup failed:', message)
    app.exit(1)
    return
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown Electron initialization error'
  console.error('Electron initialization failed:', message)
  app.exit(1)
})

app.on('before-quit', () => {
  database?.close()
  database = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
