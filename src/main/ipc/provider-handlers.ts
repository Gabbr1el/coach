import { ipcMain } from 'electron'
import type { ProviderConfigurationService } from '../../application/ai/provider-configuration-service'
import { PROVIDER_CHANNELS } from '../../shared/contracts/provider-channels'
import { configureOpenAIInputSchema, providerAccountIdSchema } from '../../shared/contracts/provider-contract'
import { assertTrustedSender } from './trusted-sender'

export function registerProviderHandlers(service: ProviderConfigurationService): void {
  ipcMain.handle(PROVIDER_CHANNELS.getStatus, (event) => {
    assertTrustedSender(event)
    return service.getStatus()
  })

  ipcMain.handle(PROVIDER_CHANNELS.listAccounts, (event) => {
    assertTrustedSender(event)
    return service.listAccounts()
  })

  ipcMain.handle(PROVIDER_CHANNELS.configureOpenAI, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const input = configureOpenAIInputSchema.parse(payload)
    return service.configureOpenAI(input.label, input.apiKey, input.model)
  })

  ipcMain.handle(PROVIDER_CHANNELS.selectAccount, (event, payload: unknown) => {
    assertTrustedSender(event)
    return service.selectAccount(providerAccountIdSchema.parse(payload))
  })

  ipcMain.handle(PROVIDER_CHANNELS.removeAccount, (event, payload: unknown) => {
    assertTrustedSender(event)
    return service.removeAccount(providerAccountIdSchema.parse(payload))
  })
}
