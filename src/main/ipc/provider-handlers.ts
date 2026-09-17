import {
  ipcMain,
} from 'electron'

import type {
  ProviderConfigurationService,
} from '../../application/ai/provider-configuration-service'

import {
  OpenAICompatibleProviderError,
} from '../providers/openai-compatible-provider'

import {
  OpenAIProviderError,
} from '../providers/openai-provider'

import {
  PROVIDER_CHANNELS,
} from '../../shared/contracts/provider-channels'

import {
  configureCompatibleInputSchema,
  configureOpenAIInputSchema,
  providerAccountIdSchema,
  setProviderAccountEnabledInputSchema,
  updateProviderAccountInputSchema,
} from '../../shared/contracts/provider-contract'

import {
  assertTrustedSender,
} from './trusted-sender'

function providerErrorCode(
  error: unknown,
) {
  if (
    error instanceof Error
    && error.name === 'ZodError'
  ) {
    return 'INVALID_CONFIGURATION' as const
  }

  if (
    error instanceof Error
    && error.message.includes(
      'Provider account not found',
    )
  ) {
    return 'ACCOUNT_NOT_FOUND' as const
  }

  if (
    error instanceof Error
    && error.message.includes(
      'Provider account is disabled',
    )
  ) {
    return 'ACCOUNT_DISABLED' as const
  }

  if (
    error instanceof Error
    && error.message.includes(
      'Provider account limit reached',
    )
  ) {
    return 'ACCOUNT_LIMIT_REACHED' as const
  }

  if (
    error instanceof Error
    && error.message.includes(
      'Secure operating-system',
    )
  ) {
    return 'SECURE_STORAGE_UNAVAILABLE' as const
  }

  return null
}

export function registerProviderHandlers(
  service:
    ProviderConfigurationService,
): void {
  ipcMain.handle(
    PROVIDER_CHANNELS.getStatus,
    (event) => {
      assertTrustedSender(event)

      return service.getStatus()
    },
  )

  ipcMain.handle(
    PROVIDER_CHANNELS.listAccounts,
    (event) => {
      assertTrustedSender(event)

      return service.listAccounts()
    },
  )

  ipcMain.handle(
    PROVIDER_CHANNELS.configureOpenAI,
    async (
      event,
      payload: unknown,
    ) => {
      try {
        assertTrustedSender(event)

        const input =
          configureOpenAIInputSchema
            .parse(payload)

        const status =
          await service.configureOpenAI(
            input.label,
            input.apiKey,
            input.model,
            input.persistence,
          )

        return {
          ok: true,
          status,
        } as const
      } catch (error) {
        if (
          error
          instanceof OpenAIProviderError
        ) {
          return {
            ok: false,
            code:
              error.code,
          } as const
        }

        const code =
          providerErrorCode(error)

        return {
          ok: false,
          code:
            code ?? 'UNKNOWN',
        } as const
      }
    },
  )

  ipcMain.handle(
    PROVIDER_CHANNELS.configureCompatible,
    async (
      event,
      payload: unknown,
    ) => {
      try {
        assertTrustedSender(event)

        const input =
          configureCompatibleInputSchema
            .parse(payload)

        return {
          ok: true,

          status:
            await service
              .configureCompatible(
                input.label,
                input.baseUrl,
                input.apiKey,
                input.model,
                input.persistence,
              ),
        } as const
      } catch (error) {
        if (
          error
          instanceof OpenAICompatibleProviderError
        ) {
          return {
            ok: false,
            code:
              error.code,
          } as const
        }

        const common =
          providerErrorCode(error)

        if (common) {
          return {
            ok: false,
            code:
              common,
          } as const
        }

        if (
          error instanceof Error
          && error.message.includes(
            'not listed',
          )
        ) {
          return {
            ok: false,
            code:
              'MODEL_UNAVAILABLE',
          } as const
        }

        if (
          error instanceof Error
          && (
            error.message.includes(
              'HTTPS',
            )
            || error.message.includes(
              'URL',
            )
          )
        ) {
          return {
            ok: false,
            code:
              'INVALID_CONFIGURATION',
          } as const
        }

        return {
          ok: false,
          code:
            'NETWORK_UNAVAILABLE',
        } as const
      }
    },
  )

  ipcMain.handle(
    PROVIDER_CHANNELS.selectAccount,
    (
      event,
      payload: unknown,
    ) => {
      assertTrustedSender(event)

      return service.selectAccount(
        providerAccountIdSchema
          .parse(payload),
      )
    },
  )

  ipcMain.handle(
    PROVIDER_CHANNELS.setAccountEnabled,
    (
      event,
      payload: unknown,
    ) => {
      assertTrustedSender(event)

      const input =
        setProviderAccountEnabledInputSchema
          .parse(payload)

      return service.setAccountEnabled(
        input.accountId,
        input.enabled,
      )
    },
  )

  ipcMain.handle(
    PROVIDER_CHANNELS.updateAccount,
    (
      event,
      payload: unknown,
    ) => {
      assertTrustedSender(event)

      const input =
        updateProviderAccountInputSchema
          .parse(payload)

      return service.updateAccount(
        input.accountId,
        input.label,
        input.identityLabel,
        input.model,
        input.reasoningEffort,
      )
    },
  )

  ipcMain.handle(
    PROVIDER_CHANNELS.removeAccount,
    (
      event,
      payload: unknown,
    ) => {
      assertTrustedSender(event)

      return service.removeAccount(
        providerAccountIdSchema
          .parse(payload),
      )
    },
  )
}