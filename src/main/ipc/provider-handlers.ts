import { ipcMain } from 'electron'
import type { ProviderConfigurationService } from '../../application/ai/provider-configuration-service'
import { OpenAICompatibleProviderError } from '../providers/openai-compatible-provider'
import { PROVIDER_CHANNELS } from '../../shared/contracts/provider-channels'
import { configureCompatibleInputSchema, configureOpenAIInputSchema, providerAccountIdSchema } from '../../shared/contracts/provider-contract'
import { assertTrustedSender } from './trusted-sender'
import { OpenAIProviderError } from '../providers/openai-provider'

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
    try {
      assertTrustedSender(event)
      const input = configureOpenAIInputSchema.parse(payload)
      const status = await service.configureOpenAI(input.label, input.apiKey, input.model, input.persistence)
      return { ok: true, status } as const
    } catch (error) {
      if (error instanceof OpenAIProviderError) return { ok: false, code: error.code } as const
      if (error instanceof Error && error.message.includes('Secure operating-system')) return { ok: false, code: 'SECURE_STORAGE_UNAVAILABLE' } as const
      if (error instanceof Error && error.name === 'ZodError') return { ok: false, code: 'INVALID_CONFIGURATION' } as const
      return { ok: false, code: 'UNKNOWN' } as const
    }
  })

  ipcMain.handle(PROVIDER_CHANNELS.configureCompatible, async (event, payload: unknown) => {
    try {
      assertTrustedSender(event)
      const input = configureCompatibleInputSchema.parse(payload)
      return { ok: true, status: await service.configureCompatible(input.label, input.baseUrl, input.apiKey, input.model, input.persistence) } as const
    } catch (error) {
      if (error instanceof OpenAICompatibleProviderError) return { ok: false, code: error.code } as const
      if (error instanceof Error && error.name === 'ZodError') return { ok: false, code: 'INVALID_CONFIGURATION' } as const
      if (error instanceof Error && error.message.includes('Secure operating-system')) return { ok: false, code: 'SECURE_STORAGE_UNAVAILABLE' } as const
      if (error instanceof Error && error.message.includes('not listed')) return { ok: false, code: 'MODEL_UNAVAILABLE' } as const
      if (error instanceof Error && (error.message.includes('HTTPS') || error.message.includes('URL'))) return { ok: false, code: 'INVALID_CONFIGURATION' } as const
      return { ok: false, code: 'NETWORK_UNAVAILABLE' } as const
    }
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
