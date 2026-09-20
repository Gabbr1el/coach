import type {
  AIProvider,
  AIProviderCapabilities,
  AIRequest,
  AIResponse,
  AIStreamEvent,
} from '../../application/ai/ai-provider'


type Fetcher = typeof fetch


type GeminiApiKeyCredential = {
  readonly kind: 'api-key'
  readonly apiKey: string
}


type GeminiOAuthCredential = {
  readonly kind: 'oauth'

  readonly clientId: string
  readonly clientSecret?: string

  readonly projectId: string
  readonly refreshToken: string

  readonly accessToken?: string
  readonly expiresAt?: number
}


type GeminiCredential =
  | GeminiApiKeyCredential
  | GeminiOAuthCredential


interface GeminiModel {
  readonly name?: string

  readonly supportedGenerationMethods?:
    readonly string[]

  readonly supportedActions?:
    readonly string[]
}


interface GeminiModelsResponse {
  readonly models?:
    readonly GeminiModel[]

  readonly nextPageToken?: string
}


interface GeminiUsageMetadata {
  readonly promptTokenCount?: number
  readonly candidatesTokenCount?: number
}


interface GeminiGenerateResponse {
  readonly candidates?: readonly {
    readonly content?: {
      readonly parts?: readonly {
        readonly text?: string
      }[]
    }
  }[]

  readonly usageMetadata?:
    GeminiUsageMetadata

  readonly modelVersion?: string

  readonly error?: {
    readonly message?: string
  }
}


interface GeminiTokenResponse {
  readonly access_token?: string
  readonly expires_in?: number
  readonly error?: string
  readonly error_description?: string
}


export class GeminiProviderError
  extends Error {
  constructor(
    readonly code:
      | 'INVALID_CREDENTIAL'
      | 'INSUFFICIENT_QUOTA'
      | 'MODEL_UNAVAILABLE'
      | 'ACCESS_RESTRICTED'
      | 'RATE_LIMITED'
      | 'NETWORK_UNAVAILABLE'
      | 'REQUEST_TIMEOUT'
      | 'UNKNOWN',

    message?: string,
  ) {
    super(
      message
      ?? `Gemini provider error: ${code}`,
    )

    this.name =
      'GeminiProviderError'
  }
}


function geminiTimeoutMs(
  maxOutputTokens: number,
): number {
  return Math.min(
    240_000,
    Math.max(
      120_000,
      maxOutputTokens * 55,
    ),
  )
}


function normalizeModel(
  model: string,
): string {
  return model
    .trim()
    .replace(
      /^models\//,
      '',
    )
}


function isCoachCompatibleGeminiModel(
  model: string,
): boolean {
  const id =
    normalizeModel(
      model,
    ).toLowerCase()

  if (
    !id.startsWith(
      'gemini-',
    )
  ) {
    return false
  }

  /*
   * O Coach atualmente usa conversa textual.
   *
   * Esses modelos pertencem a modalidades ou fluxos
   * especializados que o pipeline atual do Coach não
   * implementa.
   */
  const unsupportedKinds = [
    'computer-use',
    'image',
    'tts',
    'native-audio',
    'audio',
    'speech',
    'live',
    'robotics',
  ] as const

  return !unsupportedKinds.some(
    (kind) =>
      id.includes(kind),
  )
}


function parseCredential(
  secret: string,
): GeminiCredential {
  const trimmed =
    secret.trim()

  if (!trimmed) {
    throw new GeminiProviderError(
      'INVALID_CREDENTIAL',
    )
  }

  if (
    trimmed.startsWith('{')
  ) {
    try {
      const value =
        JSON.parse(trimmed) as
          Partial<GeminiOAuthCredential>

      if (
        value.kind === 'oauth'
        && typeof value.clientId
          === 'string'
        && typeof value.projectId
          === 'string'
        && typeof value.refreshToken
          === 'string'
      ) {
        return {
          kind:
            'oauth',

          clientId:
            value.clientId,

          ...(value.clientSecret
            ? {
                clientSecret:
                  value.clientSecret,
              }
            : {}),

          projectId:
            value.projectId,

          refreshToken:
            value.refreshToken,

          ...(value.accessToken
            ? {
                accessToken:
                  value.accessToken,
              }
            : {}),

          ...(typeof value.expiresAt
            === 'number'
            ? {
                expiresAt:
                  value.expiresAt,
              }
            : {}),
        }
      }
    } catch {
      // Continua como chave de API.
    }
  }

  return {
    kind:
      'api-key',

    apiKey:
      trimmed,
  }
}


function responseText(
  body: GeminiGenerateResponse,
): string {
  return (
    body.candidates
      ?.flatMap(
        (candidate) =>
          candidate.content
            ?.parts
          ?? [],
      )
      .map(
        (part) =>
          part.text ?? '',
      )
      .join('')
    ?? ''
  )
}


export class GeminiProvider
implements AIProvider {
  readonly id =
    'gemini'

  readonly name =
    'Google Gemini'

  private readonly credential:
    GeminiCredential

  private oauthAccessToken:
    string | null

  private oauthExpiresAt:
    number

  constructor(
    secret: string,

    private readonly defaultModel:
      string,

    private readonly fetcher:
      Fetcher = fetch,
  ) {
    this.credential =
      parseCredential(secret)

    this.oauthAccessToken =
      this.credential.kind === 'oauth'
        ? this.credential.accessToken
          ?? null
        : null

    this.oauthExpiresAt =
      this.credential.kind === 'oauth'
        ? this.credential.expiresAt
          ?? 0
        : 0
  }


  getCapabilities():
    AIProviderCapabilities {
    return {
      streaming:
        true,

      usageInformation:
        true,

      supportedInput: [
        'text',
      ],
    }
  }


  async checkAvailability():
    Promise<void> {
    await this.listModels()
  }


  async testConnection():
    Promise<void> {
    const models =
      await this.listModels()

    const configuredModel =
      normalizeModel(
        this.defaultModel,
      )

    if (
      configuredModel
      && !models.includes(
        configuredModel,
      )
    ) {
      throw new GeminiProviderError(
        'MODEL_UNAVAILABLE',
        `Gemini model '${configuredModel}' is not available`,
      )
    }
  }


  async listModels():
    Promise<readonly string[]> {
    const models =
      new Set<string>()

    let pageToken:
      string | undefined

    for (
      let page = 0;
      page < 10;
      page += 1
    ) {
      const url =
        new URL(
          'https://generativelanguage.googleapis.com/v1beta/models',
        )

      url.searchParams.set(
        'pageSize',
        '1000',
      )

      if (pageToken) {
        url.searchParams.set(
          'pageToken',
          pageToken,
        )
      }

      const {
        response,
        cleanup,
      } =
        await this.fetchWithTimeout(
          url.toString(),
          {
            method:
              'GET',

            headers:
              await this.headers(),
          },
          20_000,
        )

      try {
        const body =
          await this.jsonWithLimit(
            response,
          ) as GeminiModelsResponse
            & {
              error?: {
                message?: string
              }
            }

        if (!response.ok) {
          throw this.responseError(
            response.status,
            body.error?.message,
          )
        }

        for (
          const model
          of body.models ?? []
        ) {
          if (!model.name) {
            continue
          }

          const methods =
            model
              .supportedGenerationMethods
            ?? model
              .supportedActions
            ?? []

          if (
            methods.length > 0
            && !methods.includes(
              'generateContent',
            )
          ) {
            continue
          }

          const id =
            normalizeModel(
              model.name,
            )

          if (
            !id
            || !isCoachCompatibleGeminiModel(
              id,
            )
          ) {
            continue
          }

          models.add(id)
        }

        pageToken =
          body.nextPageToken

        if (!pageToken) {
          break
        }
      } finally {
        cleanup()
      }
    }

    if (
      models.size === 0
    ) {
      throw new GeminiProviderError(
        'UNKNOWN',
        'Gemini returned no generative models',
      )
    }

    return [
      ...models,
    ].sort(
      (left, right) =>
        left.localeCompare(
          right,
          'en',
          {
            numeric: true,
          },
        ),
    )
  }


  async sendMessage(
    request: AIRequest,
  ): Promise<AIResponse> {
    const model =
      normalizeModel(
        request.model
        ?? this.defaultModel,
      )

    if (
      !model
      || !isCoachCompatibleGeminiModel(
        model,
      )
    ) {
      throw new GeminiProviderError(
        'MODEL_UNAVAILABLE',
      )
    }

    const body =
      this.requestBody(
        request,
      )

    const {
      response,
      cleanup,
    } =
      await this.fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method:
            'POST',

          headers:
            await this.headers(),

          signal:
            request.signal,

          body:
            JSON.stringify(body),
        },
        geminiTimeoutMs(
          request.maxOutputTokens,
        ),
      )

    try {
      const payload =
        await this.jsonWithLimit(
          response,
        ) as GeminiGenerateResponse

      if (!response.ok) {
        throw this.responseError(
          response.status,
          payload.error?.message,
        )
      }

      const content =
        responseText(payload)

      if (!content) {
        throw new GeminiProviderError(
          'UNKNOWN',
          'Gemini returned an empty response',
        )
      }

      return {
        content,

        providerId:
          this.id,

        modelId:
          payload.modelVersion
          ?? model,

        ...(payload.usageMetadata
          ? {
              usage: {
                inputTokens:
                  payload
                    .usageMetadata
                    .promptTokenCount
                  ?? 0,

                outputTokens:
                  payload
                    .usageMetadata
                    .candidatesTokenCount
                  ?? 0,
              },
            }
          : {}),
      }
    } finally {
      cleanup()
    }
  }


  async *streamMessage(
    request: AIRequest,
  ): AsyncIterable<AIStreamEvent> {
    const model =
      normalizeModel(
        request.model
        ?? this.defaultModel,
      )

    if (
      !model
      || !isCoachCompatibleGeminiModel(
        model,
      )
    ) {
      throw new GeminiProviderError(
        'MODEL_UNAVAILABLE',
      )
    }

    const url =
      new URL(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent`,
      )

    url.searchParams.set(
      'alt',
      'sse',
    )

    const {
      response,
      cleanup,
    } =
      await this.fetchWithTimeout(
        url.toString(),
        {
          method:
            'POST',

          headers:
            await this.headers(),

          signal:
            request.signal,

          body:
            JSON.stringify(
              this.requestBody(
                request,
              ),
            ),
        },
        geminiTimeoutMs(
          request.maxOutputTokens,
        ),
      )

    if (!response.ok) {
      let message:
        string | undefined

      try {
        const body =
          await this.jsonWithLimit(
            response,
          ) as GeminiGenerateResponse

        message =
          body.error?.message
      } finally {
        cleanup()
      }

      throw this.responseError(
        response.status,
        message,
      )
    }

    if (!response.body) {
      cleanup()

      throw new GeminiProviderError(
        'UNKNOWN',
        'Gemini returned no response body',
      )
    }

    const reader =
      response.body.getReader()

    const decoder =
      new TextDecoder()

    let buffer = ''
    let content = ''

    let effectiveModel =
      model

    let usage:
      AIResponse['usage']
      | undefined

    try {
      while (true) {
        const {
          done,
          value,
        } =
          await reader.read()

        if (done) {
          break
        }

        buffer +=
          decoder.decode(
            value,
            {
              stream:
                true,
            },
          )

        if (
          buffer.length
          > 1_000_000
          || content.length
          > 128_000
        ) {
          throw new GeminiProviderError(
            'UNKNOWN',
            'Gemini streaming response exceeded the safe limit',
          )
        }

        const frames =
          buffer.split(
            /\r?\n\r?\n/,
          )

        buffer =
          frames.pop() ?? ''

        for (
          const frame
          of frames
        ) {
          for (
            const line
            of frame.split(
              /\r?\n/,
            )
          ) {
            const match =
              /^data:\s?(.*)$/
                .exec(line)

            if (
              !match
              || !match[1]
            ) {
              continue
            }

            const payload =
              JSON.parse(
                match[1],
              ) as
                GeminiGenerateResponse

            if (
              payload.error
                ?.message
            ) {
              throw new GeminiProviderError(
                'UNKNOWN',
                payload.error.message,
              )
            }

            if (
              payload.modelVersion
            ) {
              effectiveModel =
                payload.modelVersion
            }

            if (
              payload.usageMetadata
            ) {
              usage = {
                inputTokens:
                  payload
                    .usageMetadata
                    .promptTokenCount
                  ?? 0,

                outputTokens:
                  payload
                    .usageMetadata
                    .candidatesTokenCount
                  ?? 0,
              }
            }

            const delta =
              responseText(
                payload,
              )

            if (delta) {
              content += delta

              yield {
                type:
                  'text-delta',

                content:
                  delta,
              }
            }
          }
        }
      }

      if (!content) {
        throw new GeminiProviderError(
          'UNKNOWN',
          'Gemini returned an empty stream',
        )
      }

      yield {
        type:
          'completed',

        response: {
          content,

          providerId:
            this.id,

          modelId:
            effectiveModel,

          ...(usage
            ? {
                usage,
              }
            : {}),
        },
      }
    } finally {
      await reader
        .cancel()
        .catch(
          () => {},
        )

      reader.releaseLock()
      cleanup()
    }
  }


  private requestBody(
    request: AIRequest,
  ) {
    const systemInstruction =
      request.messages
        .filter(
          (message) =>
            message.role
            === 'system',
        )
        .map(
          (message) =>
            message.content,
        )
        .join('\n\n')

    const contents =
      request.messages
        .filter(
          (message) =>
            message.role
            !== 'system',
        )
        .map(
          (message) => ({
            role:
              message.role
              === 'assistant'
                ? 'model'
                : 'user',

            parts: [
              {
                text:
                  message.content,
              },
            ],
          }),
        )

    return {
      ...(systemInstruction
        ? {
            systemInstruction: {
              parts: [
                {
                  text:
                    systemInstruction,
                },
              ],
            },
          }
        : {}),

      contents,

      generationConfig: {
        maxOutputTokens:
          request.maxOutputTokens,

        ...(request.responseFormat
          === 'json_object'
          ? {
              responseMimeType:
                'application/json',
            }
          : {}),
      },
    }
  }


  private async headers():
    Promise<Record<string, string>> {
    if (
      this.credential.kind
      === 'api-key'
    ) {
      return {
        'Content-Type':
          'application/json',

        'x-goog-api-key':
          this.credential.apiKey,
      }
    }

    const accessToken =
      await this.accessToken()

    return {
      Authorization:
        `Bearer ${accessToken}`,

      'Content-Type':
        'application/json',

      'x-goog-user-project':
        this.credential.projectId,
    }
  }


  private async accessToken():
    Promise<string> {
    if (
      this.credential.kind
      !== 'oauth'
    ) {
      throw new GeminiProviderError(
        'INVALID_CREDENTIAL',
      )
    }

    if (
      this.oauthAccessToken
      && this.oauthExpiresAt
        > Date.now() + 60_000
    ) {
      return this.oauthAccessToken
    }

    const form =
      new URLSearchParams({
        client_id:
          this.credential.clientId,

        refresh_token:
          this.credential.refreshToken,

        grant_type:
          'refresh_token',
      })

    if (
      this.credential.clientSecret
    ) {
      form.set(
        'client_secret',
        this.credential.clientSecret,
      )
    }

    let response:
      Response

    try {
      response =
        await this.fetcher(
          'https://oauth2.googleapis.com/token',
          {
            method:
              'POST',

            headers: {
              'Content-Type':
                'application/x-www-form-urlencoded',
            },

            body:
              form.toString(),
          },
        )
    } catch {
      throw new GeminiProviderError(
        'NETWORK_UNAVAILABLE',
        'Could not refresh Google OAuth token',
      )
    }

    const body =
      await response.json() as
        GeminiTokenResponse

    if (
      !response.ok
      || !body.access_token
    ) {
      throw new GeminiProviderError(
        response.status === 400
          || response.status === 401
          ? 'INVALID_CREDENTIAL'
          : 'NETWORK_UNAVAILABLE',

        body.error_description
        ?? body.error
        ?? 'Could not refresh Google OAuth token',
      )
    }

    this.oauthAccessToken =
      body.access_token

    this.oauthExpiresAt =
      Date.now()
      + Math.max(
          0,
          body.expires_in
          ?? 3600,
        )
        * 1000

    return body.access_token
  }


  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    milliseconds: number,
  ): Promise<{
    response: Response
    cleanup(): void
  }> {
    if (
      init.signal?.aborted
    ) {
      throw new DOMException(
        'Request cancelled',
        'AbortError',
      )
    }

    const controller =
      new AbortController()

    let timedOut =
      false

    const timeout =
      setTimeout(
        () => {
          timedOut = true
          controller.abort()
        },
        milliseconds,
      )

    const abort =
      () =>
        controller.abort()

    init.signal?.addEventListener(
      'abort',
      abort,
      {
        once:
          true,
      },
    )

    const cleanup =
      () => {
        clearTimeout(timeout)

        init.signal
          ?.removeEventListener(
            'abort',
            abort,
          )
      }

    try {
      const response =
        await this.fetcher(
          url,
          {
            ...init,

            signal:
              controller.signal,
          },
        )

      return {
        response,
        cleanup,
      }
    } catch (error) {
      cleanup()

      if (
        timedOut
      ) {
        throw new GeminiProviderError(
          'REQUEST_TIMEOUT',
          'Gemini request timed out',
        )
      }

      if (
        init.signal?.aborted
      ) {
        throw new DOMException(
          'Request cancelled',
          'AbortError',
        )
      }

      throw new GeminiProviderError(
        'NETWORK_UNAVAILABLE',
        'Could not reach Gemini',
      )
    }
  }


  private async jsonWithLimit(
    response: Response,
  ): Promise<unknown> {
    const declaredLength =
      Number(
        response.headers.get(
          'content-length',
        )
        ?? 0,
      )

    if (
      declaredLength
      > 1_000_000
    ) {
      throw new GeminiProviderError(
        'UNKNOWN',
        'Gemini response exceeded the safe limit',
      )
    }

    if (!response.body) {
      throw new GeminiProviderError(
        'UNKNOWN',
        'Gemini returned no response body',
      )
    }

    const reader =
      response.body.getReader()

    const chunks:
      Uint8Array[] = []

    let size =
      0

    try {
      while (true) {
        const {
          done,
          value,
        } =
          await reader.read()

        if (done) {
          break
        }

        size +=
          value.byteLength

        if (
          size > 1_000_000
        ) {
          throw new GeminiProviderError(
            'UNKNOWN',
            'Gemini response exceeded the safe limit',
          )
        }

        chunks.push(value)
      }
    } finally {
      await reader
        .cancel()
        .catch(
          () => {},
        )

      reader.releaseLock()
    }

    const bytes =
      new Uint8Array(
        size,
      )

    let offset =
      0

    for (
      const chunk
      of chunks
    ) {
      bytes.set(
        chunk,
        offset,
      )

      offset +=
        chunk.byteLength
    }

    return JSON.parse(
      new TextDecoder()
        .decode(bytes),
    )
  }


  private responseError(
    status: number,
    message?: string,
  ): GeminiProviderError {
    if (
      status === 401
    ) {
      return new GeminiProviderError(
        'INVALID_CREDENTIAL',
      )
    }

    if (
      status === 403
    ) {
      return new GeminiProviderError(
        'ACCESS_RESTRICTED',
      )
    }

    if (
      status === 404
      || (
        status === 400
        && /model/i.test(
          message ?? '',
        )
      )
    ) {
      return new GeminiProviderError(
        'MODEL_UNAVAILABLE',
      )
    }

    if (
      status === 429
    ) {
      const detail =
        (
          message ?? ''
        ).toLowerCase()

      const quotaExhausted =
        detail.includes(
          'quota',
        )
        || detail.includes(
          'billing',
        )
        || detail.includes(
          'resource exhausted',
        )

      return new GeminiProviderError(
        quotaExhausted
          ? 'INSUFFICIENT_QUOTA'
          : 'RATE_LIMITED',
      )
    }

    if (
      status >= 500
    ) {
      return new GeminiProviderError(
        'NETWORK_UNAVAILABLE',
      )
    }

    return new GeminiProviderError(
      'UNKNOWN',
      message,
    )
  }
}
