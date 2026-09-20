import {
  CopilotClient,
  SessionEvent,
} from '@github/copilot-sdk'

import type {
  MessageOptions,
  ModelInfo,
  SessionConfig,
} from '@github/copilot-sdk'

import type {
  AIProvider,
  AIProviderCapabilities,
  AIRequest,
  AIResponse,
  AIStreamEvent,
} from '../../application/ai/ai-provider'


export type GitHubCopilotProviderErrorCode =
  | 'INVALID_CREDENTIAL'
  | 'INSUFFICIENT_QUOTA'
  | 'MODEL_UNAVAILABLE'
  | 'ACCESS_RESTRICTED'
  | 'RATE_LIMITED'
  | 'NETWORK_UNAVAILABLE'
  | 'REQUEST_TIMEOUT'
  | 'UNKNOWN'


export class GitHubCopilotProviderError
  extends Error {
  constructor(
    readonly code:
      GitHubCopilotProviderErrorCode,

    message?: string,
  ) {
    super(
      message
      ?? `GitHub Copilot provider error: ${code}`,
    )

    this.name =
      'GitHubCopilotProviderError'
  }
}


export interface GitHubCopilotSessionLike {
  sendAndWait(
    options: MessageOptions,
    timeout?: number,
  ): Promise<
    | {
        readonly data?: {
          readonly content?: string
        }
      }
    | undefined
  >

  /*
   * O caminho síncrono continua usando sendAndWait.
   *
   * send/on são opcionais na interface para manter
   * compatibilidade com fakes de testes mais antigos.
   * O adapter real do Copilot sempre os fornece.
   */
  send?(
    options: MessageOptions,
  ): Promise<unknown>

  on?(
    handler: (
      event:
        SessionEvent,
    ) => void,
  ): () => void

  abort(): Promise<unknown>

  disconnect(): Promise<void>
}


export interface GitHubCopilotClientLike {
  start(): Promise<void>

  stop(): Promise<void>

  forceStop(): Promise<void>

  getAuthStatus(): Promise<{
    readonly isAuthenticated: boolean
  }>

  listModels(): Promise<ModelInfo[]>

  createSession(
    config: SessionConfig,
  ): Promise<GitHubCopilotSessionLike>
}


export type GitHubCopilotClientFactory =
  (
    credential: string,
    runtimeDirectory: string,
  ) => GitHubCopilotClientLike


function coachSessionConfig(
  config: SessionConfig,
): SessionConfig {
  const configuredSystemMessage =
    config.systemMessage as
      | {
          readonly content?:
            string
        }
      | undefined

  const coachInstructions =
    configuredSystemMessage
      ?.content
      ?.trim()
    || [
      'You are the AI inference engine embedded in Coach.',
      'Respond directly to the supplied conversation.',
      'You are not a coding agent.',
      'Do not inspect repositories, files, directories, terminals, or workspaces.',
      'Do not simulate tool calls.',
    ].join(' ')

  return {
    ...config,

    /*
     * O Copilot SDK nasce com contexto de coding agent.
     * O Coach usa somente a inferência do modelo.
     *
     * "customize" preserva as seções administradas
     * pelo SDK enquanto remove contexto de código,
     * workspace e ferramentas.
     */
    systemMessage: {
      mode:
        'customize',

      sections: {
        identity: {
          action:
            'replace',

          content:
            'You are the AI inference engine embedded in Coach, a study application. Answer the Coach request directly and do not behave as a software-development agent.',
        },

        environment_context: {
          action:
            'remove',
        },

        code_change_rules: {
          action:
            'remove',
        },

        tool_efficiency: {
          action:
            'remove',
        },

        tool_instructions: {
          action:
            'remove',
        },
      },

      content:
        coachInstructions,
    },

    skipCustomInstructions:
      true,

    enableSkills:
      false,
  }
}


function defaultClientFactory(
  credential: string,
  runtimeDirectory: string,
): GitHubCopilotClientLike {
  /*
   * O Coach fornece explicitamente o token OAuth.
   *
   * useLoggedInUser = false impede o SDK de buscar
   * silenciosamente:
   *
   * - login do Copilot CLI;
   * - credenciais do gh;
   * - credenciais OAuth previamente salvas.
   */
  const client =
    new CopilotClient({
      gitHubToken:
        credential,

      useLoggedInUser:
        false,

      /*
       * "empty" reduz a superfície de agente do Copilot.
       * O Coach quer o modelo, não um segundo agente
       * controlando o computador.
       */
      mode:
        'empty',

      /*
       * Também evita depender do ~/.copilot do usuário.
       */
      baseDirectory:
        runtimeDirectory,

      logLevel:
        'error',
    })

  return {
    start:
      () => client.start(),

    stop:
      async () => {
        const errors =
          await client.stop()

        if (errors.length > 0) {
          throw (
            errors[0]
            ?? new Error(
              'GitHub Copilot runtime cleanup failed',
            )
          )
        }
      },

    forceStop:
      () => client.forceStop(),

    getAuthStatus:
      () => client.getAuthStatus(),

    listModels:
      () => client.listModels(),

    createSession:
      async (
        config,
      ) => {
        const session =
          await client.createSession(
            config,
          )

        return {
          sendAndWait:
            async (
              options,
              timeout,
            ) => {
              const response =
                await session.sendAndWait(
                  options,
                  timeout,
                )

              if (!response) {
                return undefined
              }

              return {
                data: {
                  content:
                    response.data.content,
                },
              }
            },

          send:
            (options) =>
              session.send(
                options,
              ),

          on:
            (handler) =>
              session.on(
                (event) =>
                  handler(
                    event,
                  ),
              ),

          abort:
            () => session.abort(),

          disconnect:
            () => session.disconnect(),
        }
      },
  }
}


function requestTimeoutMs(
  maxOutputTokens: number,
): number {
  /*
   * Alguns modelos do Copilot possuem raciocínio.
   *
   * Um limite fixo muito curto faria modelos válidos
   * parecerem quebrados.
   */
  return Math.min(
    240_000,
    Math.max(
      60_000,
      maxOutputTokens * 55,
    ),
  )
}


function normalizeCopilotError(
  error: unknown,
): GitHubCopilotProviderError {
  if (
    error
    instanceof GitHubCopilotProviderError
  ) {
    return error
  }

  const source =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : String(error)

  const message =
    source.toLocaleLowerCase(
      'en-US',
    )

  if (
    /bad credentials|invalid.?token|token.*invalid|unauthenticated|authentication.*required|401/
      .test(message)
  ) {
    return new GitHubCopilotProviderError(
      'INVALID_CREDENTIAL',
    )
  }

  if (
    /quota|usage.?limit|premium.?request|credit.*(?:exhaust|limit)|billing.*limit/
      .test(message)
  ) {
    return new GitHubCopilotProviderError(
      'INSUFFICIENT_QUOTA',
    )
  }

  if (
    /model.*(?:not.?found|unavailable|disabled)|unknown.?model/
      .test(message)
  ) {
    return new GitHubCopilotProviderError(
      'MODEL_UNAVAILABLE',
    )
  }

  if (
    /subscription|entitlement|access.?denied|not.?authorized|forbidden|policy|403/
      .test(message)
  ) {
    return new GitHubCopilotProviderError(
      'ACCESS_RESTRICTED',
    )
  }

  if (
    /rate.?limit|too.?many.?requests|429/
      .test(message)
  ) {
    return new GitHubCopilotProviderError(
      'RATE_LIMITED',
    )
  }

  if (
    /timeout|timed.?out/
      .test(message)
  ) {
    return new GitHubCopilotProviderError(
      'REQUEST_TIMEOUT',
    )
  }

  if (
    /network|socket|econn|enotfound|eai_again|fetch.?failed|connection/
      .test(message)
  ) {
    return new GitHubCopilotProviderError(
      'NETWORK_UNAVAILABLE',
    )
  }

  return new GitHubCopilotProviderError(
    'UNKNOWN',
    error instanceof Error
      ? error.message
      : undefined,
  )
}


function conversationPrompt(
  request: AIRequest,
): string {
  const conversation =
    request.messages
      .filter(
        (message) =>
          message.role !== 'system',
      )
      .map(
        (message) => {
          const role =
            message.role === 'assistant'
              ? 'ASSISTANT'
              : 'USER'

          return (
            `${role}:\n`
            + message.content
          )
        },
      )
      .join('\n\n')

  return (
    conversation.trim()
    || 'Respond according to the system instructions.'
  )
}


function systemInstructions(
  request: AIRequest,
): string | null {
  const messages =
    request.messages
      .filter(
        (message) =>
          message.role === 'system',
      )
      .map(
        (message) =>
          message.content.trim(),
      )
      .filter(Boolean)

  if (
    request.responseFormat
    === 'json_object'
  ) {
    messages.push(
      [
        'For this request, the final answer',
        'must be exactly one valid JSON object.',
        'Do not wrap it in Markdown.',
        'Do not add prose before or after it.',
      ].join(' '),
    )
  }

  return (
    messages.join('\n\n').trim()
    || null
  )
}


export class GitHubCopilotProvider
implements AIProvider {
  readonly id =
    'github-copilot'

  readonly name =
    'GitHub Copilot'

  private warmClient:
    GitHubCopilotClientLike
    | null =
      null

  private warmClientStart:
    Promise<GitHubCopilotClientLike>
    | null =
      null

  private warmClientIdleTimer:
    ReturnType<typeof setTimeout>
    | null =
      null

  private activeClientOperations =
    0

  constructor(
    private readonly credential:
      string,

    private readonly defaultModel:
      string,

    private readonly reasoningEffort:
      | 'auto'
      | 'low'
      | 'medium'
      | 'high' =
        'auto',

    private readonly runtimeDirectory:
      string,

    private readonly clientFactory:
      GitHubCopilotClientFactory =
        defaultClientFactory,
  ) {}


  getCapabilities():
    AIProviderCapabilities {
    /*
     * assistant.message_delta é convertido para
     * o contrato canônico AIStreamEvent do Coach.
     */
    return {
      streaming:
        true,

      usageInformation:
        false,

      supportedInput:
        ['text'],
    }
  }


  async checkAvailability():
    Promise<void> {
    await this.listModels()
  }


  async testConnection():
    Promise<void> {
    await this.listModels()
  }


  async listModels():
    Promise<readonly string[]> {
    try {
      return await this.withClient(
        async (
          client,
        ) => {
          const auth =
            await client
              .getAuthStatus()

          if (!auth.isAuthenticated) {
            throw new GitHubCopilotProviderError(
              'INVALID_CREDENTIAL',
            )
          }

          const models =
            await client.listModels()

          /*
           * Não oferecemos modelos explicitamente
           * desabilitados ou ainda não liberados
           * pela política da conta.
           */
          const enabledModels =
            models
              .filter(
                (model) =>
                  !model.policy
                  || model.policy.state
                    === 'enabled',
              )
              .map(
                (model) =>
                  model.id.trim(),
              )
              .filter(Boolean)

          const uniqueModels = [
            ...new Set(
              enabledModels,
            ),
          ]

          if (
            uniqueModels.length === 0
          ) {
            throw new GitHubCopilotProviderError(
              'ACCESS_RESTRICTED',
              'No enabled GitHub Copilot models are available for this account',
            )
          }

          return uniqueModels
        },
      )
    } catch (error) {
      throw normalizeCopilotError(
        error,
      )
    }
  }


  async sendMessage(
    request: AIRequest,
  ): Promise<AIResponse> {
    if (
      request.signal?.aborted
    ) {
      throw new DOMException(
        'Request cancelled',
        'AbortError',
      )
    }

    try {
      return await this.withClient(
        async (
          client,
        ) => {
          const model =
            request.model
            ?? this.defaultModel

          if (!model.trim()) {
            throw new GitHubCopilotProviderError(
              'MODEL_UNAVAILABLE',
              'GitHub Copilot model is not configured',
            )
          }

          const system =
            systemInstructions(
              request,
            )

          const sessionConfig =
            coachSessionConfig({
            model,

            streaming:
              false,

            /*
             * O Copilot SDK não recebe ferramentas
             * nesta integração.
             *
             * Ferramentas e ações continuam sob
             * autoridade do próprio Coach.
             */
            availableTools:
              [],

            enableConfigDiscovery:
              false,

            enableSessionStore:
              false,

            infiniteSessions: {
              enabled:
                false,
            },

            ...(this.reasoningEffort
              === 'auto'
              ? {}
              : {
                  reasoningEffort:
                    this.reasoningEffort,
                }),

            /*
             * Não usamos "replace":
             * append preserva as proteções do runtime.
             */
            ...(system
              ? {
                  systemMessage: {
                    mode:
                      'append' as const,

                    content:
                      system,
                  },
                }
              : {}),
          })

          const session =
            await client
              .createSession(
                sessionConfig,
              )

          const abort =
            () => {
              void session
                .abort()
                .catch(() => {})
            }

          request.signal
            ?.addEventListener(
              'abort',
              abort,
              {
                once: true,
              },
            )

          try {
            const response =
              await session
                .sendAndWait(
                  {
                    prompt:
                      conversationPrompt(
                        request,
                      ),
                  },

                  requestTimeoutMs(
                    request
                      .maxOutputTokens,
                  ),
                )

            if (
              request.signal
                ?.aborted
            ) {
              throw new DOMException(
                'Request cancelled',
                'AbortError',
              )
            }

            const content =
              response
                ?.data
                ?.content
                ?.trim()
              ?? ''

            if (!content) {
              throw new GitHubCopilotProviderError(
                'UNKNOWN',
                'GitHub Copilot returned an empty response',
              )
            }

            return {
              content,

              providerId:
                this.id,

              modelId:
                model,
            }
          } finally {
            request.signal
              ?.removeEventListener(
                'abort',
                abort,
              )

            await session
              .disconnect()
              .catch(() => {})
          }
        },
      )
    } catch (error) {
      if (
        request.signal?.aborted
        || (
          error instanceof DOMException
          && error.name
            === 'AbortError'
        )
      ) {
        throw new DOMException(
          'Request cancelled',
          'AbortError',
        )
      }

      const normalized =
        normalizeCopilotError(
          error,
        )

      console.error(
        '[Coach Copilot real request failed]',
        {
          model:
            request.model
            ?? this.defaultModel,

          responseFormat:
            request.responseFormat
            ?? null,

          messageCount:
            request.messages.length,

          original:
            error instanceof Error
              ? {
                  name:
                    error.name,

                  message:
                    error.message,

                  code:
                    'code' in error
                      ? (
                          error as Error & {
                            code?: unknown
                          }
                        ).code
                      : undefined,
                }
              : String(error),

          normalized: {
            name:
              normalized.name,

            message:
              normalized.message,

            code:
              normalized.code,
          },
        },
      )

      throw normalized
    }
  }


  async *streamMessage(
    request: AIRequest,
  ): AsyncIterable<AIStreamEvent> {
    if (request.signal?.aborted) {
      throw new DOMException(
        'Request cancelled',
        'AbortError',
      )
    }

    const queue:
      AIStreamEvent[] =
        []

    let wake:
      (() => void)
      | null =
        null

    let finished =
      false

    let operationError:
      unknown =
        null

    const push =
      (
        event:
          AIStreamEvent,
      ) => {
        queue.push(
          event,
        )

        const resolve =
          wake

        wake =
          null

        resolve?.()
      }

    const operation =
      this.withClient(
        async (
          client,
        ) => {
          const model =
            request.model
            ?? this.defaultModel

          if (!model.trim()) {
            throw new GitHubCopilotProviderError(
              'MODEL_UNAVAILABLE',
              'GitHub Copilot model is not configured',
            )
          }

          const system =
            systemInstructions(
              request,
            )

          const session =
            await client
              .createSession(
                coachSessionConfig({
                  model,

                  streaming:
                    true,

                  availableTools:
                    [],

                  enableConfigDiscovery:
                    false,

                  enableSessionStore:
                    false,

                  infiniteSessions: {
                    enabled:
                      false,
                  },

                  ...(this.reasoningEffort
                    === 'auto'
                    ? {}
                    : {
                        reasoningEffort:
                          this.reasoningEffort,
                      }),

                  ...(system
                    ? {
                        systemMessage: {
                          mode:
                            'append' as const,

                          content:
                            system,
                        },
                      }
                    : {}),
                }),
              )

          if (
            !session.send
            || !session.on
          ) {
            await session
              .disconnect()
              .catch(() => {})

            throw new GitHubCopilotProviderError(
              'UNKNOWN',
              'GitHub Copilot streaming is unavailable in this runtime',
            )
          }

          let accumulated =
            ''

          let finalContent =
            ''

          let idleResolve!:
            () => void

          const idle =
            new Promise<void>(
              (resolve) => {
                idleResolve =
                  resolve
              },
            )

          const unsubscribe =
            session.on(
              (event) => {
                if (
                  event.type
                  === 'assistant.message_delta'
                ) {
                  const delta =
                    event.data
                      ?.deltaContent
                    ?? ''

                  if (!delta) {
                    return
                  }

                  accumulated +=
                    delta

                  if (
                    accumulated.length
                    > 32_000
                  ) {
                    void session
                      .abort()
                      .catch(() => {})

                    return
                  }

                  push({
                    type:
                      'text-delta',

                    content:
                      delta,
                  })

                  return
                }

                if (
                  event.type
                  === 'assistant.message'
                ) {
                  finalContent =
                    event.data
                      ?.content
                      ?.trim()
                    ?? ''

                  return
                }

                if (
                  event.type
                  === 'session.idle'
                ) {
                  idleResolve()
                }
              },
            )

          const abort =
            () => {
              void session
                .abort()
                .catch(() => {})

              idleResolve()
            }

          request.signal
            ?.addEventListener(
              'abort',
              abort,
              {
                once: true,
              },
            )

          let timeout:
            ReturnType<typeof setTimeout>
            | null =
              null

          try {
            const timeoutPromise =
              new Promise<never>(
                (_, reject) => {
                  timeout =
                    windowlessTimeout(
                      () => {
                        void session
                          .abort()
                          .catch(() => {})

                        reject(
                          new GitHubCopilotProviderError(
                            'REQUEST_TIMEOUT',
                            'GitHub Copilot streaming request timed out',
                          ),
                        )
                      },

                      requestTimeoutMs(
                        request.maxOutputTokens,
                      ),
                    )
                },
              )

            await session.send({
              prompt:
                conversationPrompt(
                  request,
                ),
            })

            await Promise.race([
              idle,
              timeoutPromise,
            ])

            if (
              request.signal
                ?.aborted
            ) {
              throw new DOMException(
                'Request cancelled',
                'AbortError',
              )
            }

            if (
              accumulated.length
              > 32_000
            ) {
              throw new GitHubCopilotProviderError(
                'UNKNOWN',
                'GitHub Copilot response exceeded the safe limit',
              )
            }

            const content =
              finalContent
              || accumulated.trim()

            if (!content) {
              throw new GitHubCopilotProviderError(
                'UNKNOWN',
                'GitHub Copilot returned an empty response',
              )
            }

            push({
              type:
                'completed',

              response: {
                content,

                providerId:
                  this.id,

                modelId:
                  model,
              },
            })
          } finally {
            if (timeout) {
              clearTimeout(
                timeout,
              )
            }

            unsubscribe()

            request.signal
              ?.removeEventListener(
                'abort',
                abort,
              )

            await session
              .disconnect()
              .catch(() => {})
          }
        },
      )
        .catch(
          (error) => {
            operationError =
              error
          },
        )
        .finally(
          () => {
            finished =
              true

            const resolve =
              wake

            wake =
              null

            resolve?.()
          },
        )

    while (
      !finished
      || queue.length > 0
    ) {
      const event =
        queue.shift()

      if (event) {
        yield event
        continue
      }

      await new Promise<void>(
        (resolve) => {
          wake =
            resolve
        },
      )
    }

    await operation

    if (operationError) {
      if (
        request.signal?.aborted
        || (
          operationError
          instanceof DOMException
          && operationError.name
            === 'AbortError'
        )
      ) {
        throw new DOMException(
          'Request cancelled',
          'AbortError',
        )
      }

      throw normalizeCopilotError(
        operationError,
      )
    }
  }


  private async withClient<T>(
    operation:
      (
        client:
          GitHubCopilotClientLike,
      ) => Promise<T>,
  ): Promise<T> {
    this.cancelWarmClientStop()

    const client =
      await this.getWarmClient()

    this.activeClientOperations +=
      1

    try {
      return await operation(
        client,
      )
    } finally {
      this.activeClientOperations -=
        1

      if (
        this.activeClientOperations
        === 0
      ) {
        this.scheduleWarmClientStop(
          client,
        )
      }
    }
  }

  private async getWarmClient():
    Promise<GitHubCopilotClientLike> {
    if (this.warmClient) {
      return this.warmClient
    }

    if (this.warmClientStart) {
      return this.warmClientStart
    }

    const client =
      this.clientFactory(
        this.credential,
        this.runtimeDirectory,
      )

    const starting =
      (async () => {
        try {
          await client.start()

          this.warmClient =
            client

          return client
        } catch (error) {
          await client
            .forceStop()
            .catch(() => {})

          throw error
        } finally {
          this.warmClientStart =
            null
        }
      })()

    this.warmClientStart =
      starting

    return starting
  }

  private cancelWarmClientStop():
    void {
    if (
      this.warmClientIdleTimer
      === null
    ) {
      return
    }

    clearTimeout(
      this.warmClientIdleTimer,
    )

    this.warmClientIdleTimer =
      null
  }

  private scheduleWarmClientStop(
    client:
      GitHubCopilotClientLike,
  ): void {
    this.cancelWarmClientStop()

    this.warmClientIdleTimer =
      windowlessTimeout(
        () => {
          this.warmClientIdleTimer =
            null

          void this.stopWarmClient(
            client,
          )
        },

        60_000,
      )
  }

  private async stopWarmClient(
    client:
      GitHubCopilotClientLike,
  ): Promise<void> {
    /*
     * Uma operação nova pode ter começado
     * enquanto o timer estava disparando.
     */
    if (
      this.activeClientOperations
        !== 0
      || this.warmClient
        !== client
    ) {
      return
    }

    /*
     * Retiramos o client do cache ANTES
     * de aguardar stop(). Assim uma nova
     * operação nunca reutiliza um runtime
     * que já está sendo encerrado.
     */
    this.warmClient =
      null

    try {
      await Promise.race([
        client.stop(),

        new Promise<never>(
          (_, reject) => {
            windowlessTimeout(
              () =>
                reject(
                  new Error(
                    'Copilot runtime stop timeout',
                  ),
                ),

              5_000,
            )
          },
        ),
      ])
    } catch {
      await client
        .forceStop()
        .catch(() => {})
    }
  }
}


/*
 * setTimeout isolado em função para deixar claro
 * que este código roda no processo main, sem
 * qualquer dependência de window/renderer.
 */
function windowlessTimeout(
  callback: () => void,
  milliseconds: number,
): ReturnType<typeof setTimeout> {
  return setTimeout(
    callback,
    milliseconds,
  )
}
