import {
  app,
  ipcMain,
  shell,
} from 'electron'

import {
  join,
} from 'node:path'

import type {
  ProviderConfigurationService,
} from '../../application/ai/provider-configuration-service'

import {
  authorizeGoogleGeminiOAuth,
} from '../providers/google-gemini-oauth'

import {
  OpenAICompatibleProviderError,
} from '../providers/openai-compatible-provider'

import {
  OpenAIProviderError,
} from '../providers/openai-provider'

import {
  GeminiProviderError,
} from '../providers/gemini-provider'

import {
  GitHubCopilotProviderError,
} from '../providers/github-copilot-provider'

import {
  GitHubCopilotOAuthDeviceFlow,
  GitHubCopilotOAuthError,
} from '../providers/github-copilot-oauth'

import {
  PROVIDER_CHANNELS,
} from '../../shared/contracts/provider-channels'

import {
  configureCompatibleInputSchema,
  beginGitHubCopilotOAuthInputSchema,
  configureOpenAIInputSchema,
  githubCopilotOAuthFlowIdSchema,
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
    && 'code' in error
    && typeof error.code === 'string'
    && [
      'INVALID_CREDENTIAL',
      'INSUFFICIENT_QUOTA',
      'MODEL_UNAVAILABLE',
      'ACCESS_RESTRICTED',
      'RATE_LIMITED',
      'NETWORK_UNAVAILABLE',
    ].includes(error.code)
  ) {
    return error.code as
      | 'INVALID_CREDENTIAL'
      | 'INSUFFICIENT_QUOTA'
      | 'MODEL_UNAVAILABLE'
      | 'ACCESS_RESTRICTED'
      | 'RATE_LIMITED'
      | 'NETWORK_UNAVAILABLE'
  }

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
  const githubCopilotOAuth =
    new GitHubCopilotOAuthDeviceFlow()

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
    PROVIDER_CHANNELS.listAvailableModels,
    (
      event,
      payload: unknown,
    ) => {
      assertTrustedSender(event)

      return service.listAvailableModels(
        providerAccountIdSchema
          .parse(payload),
      )
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
                input.connectorId,
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
    PROVIDER_CHANNELS.connectGeminiOAuth,
    async (
      event,
    ) => {
      try {
        assertTrustedSender(event)

        const configuredPath =
          process.env
            .COACH_GOOGLE_OAUTH_CLIENT_CONFIG
            ?.trim()

        const clientConfigPath =
          configuredPath
          || join(
            app.getAppPath(),
            '.coach-dev',
            'google-oauth-client.json',
          )

        const authorization =
          await authorizeGoogleGeminiOAuth({
            clientConfigPath,

            openExternal:
              (url) =>
                shell.openExternal(
                  url,
                ),
          })

        return {
          ok:
            true,

          status:
            await service
              .configureGeminiOAuth(
                authorization.credential,
                authorization.identityLabel,
              ),
        } as const
      } catch (error) {
        /*
         * GeminiProvider já classifica respostas HTTP
         * da API. Preserve esse código em vez de
         * transformar tudo em UNKNOWN.
         */
        if (
          error
          instanceof GeminiProviderError
        ) {
          console.error(
            '[Gemini OAuth] provider error',
            {
              name:
                error.name,

              code:
                error.code,

              message:
                error.message,
            },
          )


          return {
            ok:
              false,

            code:
              error.code === 'REQUEST_TIMEOUT'
                ? 'NETWORK_UNAVAILABLE'
                : error.code,
          } as const
        }

        const common =
          providerErrorCode(error)

        if (common) {
          return {
            ok:
              false,

            code:
              common,
          } as const
        }

        const message =
          error instanceof Error
            ? error.message
            : ''

        if (
          message.includes(
            'cancelada ou recusada',
          )
        ) {
          return {
            ok:
              false,

            code:
              'AUTH_CANCELLED',
          } as const
        }

        if (
          message.includes(
            'configuração OAuth',
          )
          || message.includes(
            'credencial válida do tipo Desktop',
          )
        ) {
          return {
            ok:
              false,

            code:
              'OAUTH_CONFIGURATION_MISSING',
          } as const
        }

        if (
          message.includes(
            'refresh token',
          )
          || message.includes(
            'access token',
          )
        ) {
          return {
            ok:
              false,

            code:
              'INVALID_CREDENTIAL',
          } as const
        }

        if (
          message.includes(
            'No Gemini generation model',
          )
          || message.includes(
            'model',
          )
        ) {
          return {
            ok:
              false,

            code:
              'MODEL_UNAVAILABLE',
          } as const
        }

        return {
          ok:
            false,

          code:
            'UNKNOWN',
        } as const
      }
    },
  )

  ipcMain.handle(
    PROVIDER_CHANNELS.beginGitHubCopilotOAuth,
    async (event, payload: unknown = {}) => {
      try {
        assertTrustedSender(event)

        const clientId =
          process.env
            .COACH_GITHUB_OAUTH_CLIENT_ID
            ?.trim()
          || "Iv23lid7hkdJCeL7QYMo"

        if (!clientId) {
          return {
            ok: false,
            code:
              'OAUTH_CONFIGURATION_MISSING',
          } as const
        }

        const { accountId } =
          beginGitHubCopilotOAuthInputSchema
            .parse(payload)

        const authorization =
          await githubCopilotOAuth.begin(
            clientId,
            accountId ?? null,
          )

        await shell.openExternal(
          authorization.verificationUri,
        )

        return {
          ok: true,
          authorization,
        } as const
      } catch (error) {
        if (
          error
          instanceof GitHubCopilotOAuthError
        ) {
          return {
            ok: false,
            code: error.code,
          } as const
        }

        return {
          ok: false,
          code: 'UNKNOWN',
        } as const
      }
    },
  )

  ipcMain.handle(
    PROVIDER_CHANNELS.completeGitHubCopilotOAuth,
    async (
      event,
      payload: unknown,
    ) => {
      try {
        assertTrustedSender(event)

        const flowId =
          githubCopilotOAuthFlowIdSchema
            .parse(payload)

        const authorization =
          await githubCopilotOAuth
            .complete(flowId)

        return {
          ok: true,
          status:
            await service
              .configureGitHubCopilotOAuth(
                authorization.credential,
                authorization.identity.label,
                authorization.identity.key,
                authorization.targetAccountId,
              ),
        } as const
      } catch (error) {
        if (
          error
          instanceof GitHubCopilotOAuthError
          || error
            instanceof GitHubCopilotProviderError
        ) {
          return {
            ok: false,
            code: error.code,
          } as const
        }

        const common =
          providerErrorCode(error)

        if (common) {
          return {
            ok: false,
            code: common,
          } as const
        }

        if (
          error instanceof Error
          && /GitHub Copilot.*model|model discovery/i
            .test(error.message)
        ) {
          return {
            ok: false,
            code: 'MODEL_UNAVAILABLE',
          } as const
        }

        return {
          ok: false,
          code: 'UNKNOWN',
        } as const
      }
    },
  )


  ipcMain.handle(
    PROVIDER_CHANNELS.refreshHealth,
    (event) => {
      assertTrustedSender(event)

      return service.refreshHealth()
    },
  )


  ipcMain.handle(
    PROVIDER_CHANNELS.checkActiveFunctionalHealth,
    (event) => {
      assertTrustedSender(event)

      return service
        .checkActiveFunctionalHealth()
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
