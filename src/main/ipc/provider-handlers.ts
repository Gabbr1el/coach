import { ipcMain } from 'electron'
import type { ProviderConfigurationService } from '../../application/ai/provider-configuration-service'
import { PROVIDER_CHANNELS } from '../../shared/contracts/provider-channels'
import { configureOpenAIInputSchema, providerIdSchema } from '../../shared/contracts/provider-contract'
import { assertTrustedSender } from './trusted-sender'

export function registerProviderHandlers(service: ProviderConfigurationService): void {
  ipcMain.handle(PROVIDER_CHANNELS.getStatus, (event) => {
    assertTrustedSender(event)
    return service.getStatus()
  })

  ipcMain.handle(PROVIDER_CHANNELS.configureOpenAI, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const input = configureOpenAIInputSchema.parse(payload)
    return service.configureOpenAI(input.apiKey, input.model)
  })

  ipcMain.handle(PROVIDER_CHANNELS.disconnect, (event, payload: unknown) => {
    assertTrustedSender(event)
    providerIdSchema.parse(payload)
    return service.disconnect()
  })
}
