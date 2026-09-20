import {
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type {
  MessageOptions,
  SessionConfig,
} from '@github/copilot-sdk'

import {
  GitHubCopilotProvider,
  GitHubCopilotProviderError,
} from '../../src/main/providers/github-copilot-provider'

import type {
  GitHubCopilotClientFactory,
  GitHubCopilotClientLike,
  GitHubCopilotSessionLike,
} from '../../src/main/providers/github-copilot-provider'


function fakeClient(
  overrides:
    Partial<
      GitHubCopilotClientLike
    > = {},
): GitHubCopilotClientLike {
  const session:
    GitHubCopilotSessionLike = {
    sendAndWait:
      async () => ({
        data: {
          content:
            'OK',
        },
      }),

    abort:
      async () => undefined,

    disconnect:
      async () => {},
  }

  return {
    start:
      async () => {},

    stop:
      async () => {},

    forceStop:
      async () => {},

    getAuthStatus:
      async () => ({
        isAuthenticated:
          true,
      }),

    listModels:
      async () => [
        {
          id:
            'gpt-5.4',

          name:
            'GPT-5.4',

          capabilities:
            {} as never,
        },
      ],

    createSession:
      async () =>
        session,

    ...overrides,
  }
}


function providerWith(
  client:
    GitHubCopilotClientLike,
): GitHubCopilotProvider {
  const factory:
    GitHubCopilotClientFactory =
      () => client

  return new GitHubCopilotProvider(
    'ghu_test_token',
    'gpt-5.4',
    'auto',
    '/tmp/coach-copilot-test',
    factory,
  )
}


describe(
  'GitHubCopilotProvider',
  () => {
    it(
      'lists only models enabled for this Copilot account',
      async () => {
        const provider =
          providerWith(
            fakeClient({
              listModels:
                async () => [
                  {
                    id:
                      'gpt-5.4',

                    name:
                      'GPT-5.4',

                    capabilities:
                      {} as never,

                    policy: {
                      state:
                        'enabled',

                      terms:
                        '',
                    },
                  },
                  {
                    id:
                      'blocked-model',

                    name:
                      'Blocked',

                    capabilities:
                      {} as never,

                    policy: {
                      state:
                        'disabled',

                      terms:
                        '',
                    },
                  },
                  {
                    id:
                      'needs-policy',

                    name:
                      'Needs policy',

                    capabilities:
                      {} as never,

                    policy: {
                      state:
                        'unconfigured',

                      terms:
                        '',
                    },
                  },
                ],
            }),
          )

        await expect(
          provider.listModels(),
        ).resolves.toEqual([
          'gpt-5.4',
        ])
      },
    )


    it(
      'rejects an unauthenticated Copilot identity',
      async () => {
        const provider =
          providerWith(
            fakeClient({
              getAuthStatus:
                async () => ({
                  isAuthenticated:
                    false,
                }),
            }),
          )

        await expect(
          provider
            .checkAvailability(),
        ).rejects.toMatchObject({
          code:
            'INVALID_CREDENTIAL',
        })
      },
    )


    it(
      'sends Coach requests without exposing Copilot tools',
      async () => {
        let receivedConfig:
          SessionConfig | null =
            null

        let receivedMessage:
          MessageOptions | null =
            null

        const session:
          GitHubCopilotSessionLike = {
          sendAndWait:
            async (
              options,
            ) => {
              receivedMessage =
                options

              return {
                data: {
                  content:
                    '{"ok":true}',
                },
              }
            },

          abort:
            async () =>
              undefined,

          disconnect:
            async () => {},
        }

        const provider =
          providerWith(
            fakeClient({
              createSession:
                async (
                  config,
                ) => {
                  receivedConfig =
                    config

                  return session
                },
            }),
          )

        await expect(
          provider.sendMessage({
            messages: [
              {
                role:
                  'system',

                content:
                  'Você é o Coach.',
              },
              {
                role:
                  'user',

                content:
                  'Responda.',
              },
            ],

            model:
              'gpt-5.4',

            maxOutputTokens:
              400,

            responseFormat:
              'json_object',
          }),
        ).resolves.toEqual({
          content:
            '{"ok":true}',

          providerId:
            'github-copilot',

          modelId:
            'gpt-5.4',
        })

        expect(
          receivedConfig,
        ).toMatchObject({
          model:
            'gpt-5.4',

          streaming:
            false,

          availableTools:
            [],

          enableConfigDiscovery:
            false,

          enableSessionStore:
            false,

          skipCustomInstructions:
            true,

          enableSkills:
            false,

          systemMessage:
            expect.objectContaining({
              mode:
                'customize',

              sections:
                expect.objectContaining({
                  identity:
                    expect.objectContaining({
                      action:
                        'replace',
                    }),

                  environment_context:
                    expect.objectContaining({
                      action:
                        'remove',
                    }),

                  code_change_rules:
                    expect.objectContaining({
                      action:
                        'remove',
                    }),

                  tool_efficiency:
                    expect.objectContaining({
                      action:
                        'remove',
                    }),

                  tool_instructions:
                    expect.objectContaining({
                      action:
                        'remove',
                    }),
                }),
            }),

        })

        expect(
          JSON.stringify(
            receivedConfig,
          ),
        ).toContain(
          'one valid JSON object',
        )

        expect(
          receivedMessage,
        ).toEqual({
          prompt:
            'USER:\nResponda.',
        })
      },
    )


    it(
      'preserves AbortError when the Coach cancels a request',
      async () => {
        const controller =
          new AbortController()

        controller.abort()

        const provider =
          providerWith(
            fakeClient(),
          )

        await expect(
          provider.sendMessage({
            messages: [
              {
                role:
                  'user',

                content:
                  'Oi',
              },
            ],

            maxOutputTokens:
              100,

            signal:
              controller.signal,
          }),
        ).rejects.toMatchObject({
          name:
            'AbortError',
        })
      },
    )


    it(
      'maps Copilot quota failures to Coach quota state',
      async () => {
        const provider =
          providerWith(
            fakeClient({
              listModels:
                async () => {
                  throw new Error(
                    'Premium request usage limit has been reached',
                  )
                },
            }),
          )

        try {
          await provider
            .listModels()

          throw new Error(
            'Expected provider failure',
          )
        } catch (error) {
          expect(
            error,
          ).toBeInstanceOf(
            GitHubCopilotProviderError,
          )

          if (
            !(
              error
              instanceof GitHubCopilotProviderError
            )
          ) {
            throw error
          }

          expect(
            error.code,
          ).toBe(
            'INSUFFICIENT_QUOTA',
          )
        }
      },
    )
  },
)
