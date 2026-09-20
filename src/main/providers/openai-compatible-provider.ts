import type { AIProvider, AIProviderCapabilities, AIRequest, AIResponse, AIStreamEvent } from '../../application/ai/ai-provider'

type Fetcher = typeof fetch

export function compatibleRequestTimeoutMs(maxOutputTokens: number): number {
  return Math.min(240_000, Math.max(120_000, maxOutputTokens * 55))
}

export function normalizeCompatibleBaseUrl(value: string): string {
  const url = new URL(value)
  if (url.username || url.password) throw new Error('Credentials are not allowed in the provider URL')
  if (url.search || url.hash) throw new Error('Query parameters and fragments are not allowed in the provider URL')
  const isLoopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(isLoopback && url.protocol === 'http:')) {
    throw new Error('Remote compatible providers must use HTTPS')
  }
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

interface ChatCompletionBody {
  readonly model?: string
  readonly choices?: Array<{ message?: { content?: string }; delta?: { content?: string } }>
  readonly usage?: { prompt_tokens?: number; completion_tokens?: number }
  readonly error?: { message?: string }
}

interface ResponsesBody {
  readonly model?: string
  readonly output_text?: string
  readonly output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
  readonly usage?: { input_tokens?: number; output_tokens?: number }
  readonly error?: { message?: string }
}

function responsesText(body: ResponsesBody): string {
  if (body.output_text) return body.output_text
  return body.output?.flatMap((item) => item.content ?? []).filter((item) => item.type === 'output_text').map((item) => item.text ?? '').join('') ?? ''
}

function responsesEndpointUnsupported(status: number, message?: string): boolean {
  return status === 404 || status === 405 || status === 501 || (status === 400 && /(?:unsupported|unknown|not found).*(?:response|endpoint)|(?:response|endpoint).*(?:unsupported|unknown|not found)/i.test(message ?? ''))
}

export class OpenAICompatibleProviderError extends Error {
  constructor(readonly code: 'INVALID_CREDENTIAL' | 'INSUFFICIENT_QUOTA' | 'MODEL_UNAVAILABLE' | 'ACCESS_RESTRICTED' | 'RATE_LIMITED' | 'NETWORK_UNAVAILABLE' | 'REQUEST_TIMEOUT' | 'UNKNOWN', message?: string) {
    super(message ?? code)
    this.name = 'OpenAICompatibleProviderError'
  }
}

export type OpenAICompatibleConnectorId =
  | 'openai-compatible'
  | 'omniroute'

export class OpenAICompatibleProvider implements AIProvider {
  readonly id:
    OpenAICompatibleConnectorId

  readonly name: string
  private readonly baseUrl: string

  constructor(
    connectorId:
      OpenAICompatibleConnectorId,

    name: string,
    baseUrl: string,

    private readonly apiKey:
      string,

    private readonly defaultModel:
      string,

    private readonly fetcher:
      Fetcher = fetch,
  ) {
    this.id =
      connectorId

    this.name =
      name

    this.baseUrl =
      normalizeCompatibleBaseUrl(
        baseUrl,
      )
  }

  getCapabilities(): AIProviderCapabilities {
    return { streaming: true, usageInformation: true, supportedInput: ['text'] }
  }

  async checkAvailability(): Promise<void> {
    const configuredModel =
      this.defaultModel.trim()

    const modelPath =
      configuredModel
        .split('/')
        .map(
          (segment) =>
            encodeURIComponent(segment),
        )
        .join('/')

    const omnirouteModelProbe =
      this.id === 'omniroute'
      && Boolean(modelPath)

    const availabilityUrl =
      omnirouteModelProbe
        ? `${this.baseUrl}/models/${modelPath}`
        : `${this.baseUrl}/models`

    const { response, cleanup } =
      await this.fetchWithTimeout(
        availabilityUrl,
        {
          method:
            this.id === 'omniroute'
            && !omnirouteModelProbe
              ? 'HEAD'
              : 'GET',

          headers: this.headers(),
        },
        3_000,
      )

    try {
      if (!response.ok) {
        throw this.responseError(
          response.status,
        )
      }
    } finally {
      cleanup()
    }
  }

  async listModels(): Promise<readonly string[]> {
    const { response, cleanup } =
      await this.fetchWithTimeout(
        `${this.baseUrl}/models`,
        {
          method: 'GET',
          headers: this.headers(),
        },
        10_000,
      )

    let body: {
      data?: Array<{
        id?: string
      }>
    }

    try {
      if (!response.ok) {
        throw this.responseError(
          response.status,
        )
      }

      body =
        await this.jsonWithLimit(
          response,
        ) as {
          data?: Array<{
            id?: string
          }>
        }
    } finally {
      cleanup()
    }

    const models =
      (body.data ?? [])
        .map(
          (model) =>
            model.id?.trim(),
        )
        .filter(
          (id): id is string =>
            Boolean(id),
        )

    return [
      ...new Set(models),
    ]
  }

  async testConnection(): Promise<void> {
    const { response, cleanup } = await this.fetchWithTimeout(`${this.baseUrl}/models`, { method: 'GET', headers: this.headers() }, 10_000)
    let body: { data?: Array<{ id?: string }> }
    try {
      if (!response.ok) throw this.responseError(response.status)
      body = await this.jsonWithLimit(response) as { data?: Array<{ id?: string }> }
    } finally { cleanup() }
    if (
      this.defaultModel.trim()
      && body.data?.length
      && !body.data.some(
        (model) =>
          model.id === this.defaultModel,
      )
    ) {
      throw new Error(
        'Configured model is not listed by the compatible provider',
      )
    }
  }

  async sendMessage(request: AIRequest): Promise<AIResponse> {
    const model =
      this.resolveModel(
        request.model,
      )

    const timeout = compatibleRequestTimeoutMs(request.maxOutputTokens)
    const responses = await this.fetchWithTimeout(`${this.baseUrl}/responses`, {
      method: 'POST', headers: this.headers(), signal: request.signal,
      body: JSON.stringify({ model, input: request.messages, max_output_tokens: request.maxOutputTokens, store: false, ...(request.responseFormat === 'json_object' ? { text: { format: { type: 'json_object' } } } : {}) }),
    }, timeout)
    try {
      const body = await this.jsonWithLimit(responses.response) as ResponsesBody
      if (responsesEndpointUnsupported(responses.response.status, body.error?.message)) return this.sendChatCompletion(request, timeout)
      if (!responses.response.ok) throw this.responseError(responses.response.status, body.error?.message)
      const content = responsesText(body)
      if (!content) throw new Error('Compatible provider returned an empty response')
      this.assertUsableContent(content)
      return { content, providerId: this.id, modelId: body.model ?? model, usage: body.usage ? { inputTokens: body.usage.input_tokens ?? 0, outputTokens: body.usage.output_tokens ?? 0 } : undefined }
    } finally { responses.cleanup() }
  }

  private async sendChatCompletion(request: AIRequest, timeout: number): Promise<AIResponse> {
    const model =
      this.resolveModel(
        request.model,
      )

    const { response, cleanup } = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: this.headers(), signal: request.signal,
      body: JSON.stringify({ model, messages: request.messages, max_tokens: request.maxOutputTokens, ...(request.responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}), stream: false }),
    }, timeout)
    try {
      const body = await this.jsonWithLimit(response) as ChatCompletionBody
      if (!response.ok) throw this.responseError(response.status, body.error?.message)
      const content = body.choices?.[0]?.message?.content ?? ''
      if (!content) throw new Error('Compatible provider returned an empty response')
      this.assertUsableContent(content)
      return { content, providerId: this.id, modelId: body.model ?? model, ...(body.usage ? { usage: { inputTokens: body.usage.prompt_tokens ?? 0, outputTokens: body.usage.completion_tokens ?? 0 } } : {}) }
    } finally { cleanup() }
  }

  async *streamMessage(request: AIRequest): AsyncIterable<AIStreamEvent> {
    const model =
      this.resolveModel(
        request.model,
      )

    const timeout = compatibleRequestTimeoutMs(request.maxOutputTokens)
    const { response, cleanup } = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: this.headers(), signal: request.signal,
      body: JSON.stringify({ model, messages: request.messages, max_tokens: request.maxOutputTokens, stream: true }),
    }, timeout)
    if (!response.ok) {
      let message: string | undefined

      try {
        const body =
          await this.jsonWithLimit(
            response,
          ) as ChatCompletionBody

        message =
          body.error?.message
      } catch {
        /*
         * Mesmo se o body de erro estiver malformado,
         * ainda classificamos pelo status HTTP.
         */
      } finally {
        cleanup()
      }

      throw this.responseError(
        response.status,
        message,
      )
    }
    if (!response.body) { cleanup(); throw new OpenAICompatibleProviderError('UNKNOWN', 'Compatible provider returned no response body') }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let effectiveModel =
      model
    const bufferUntilValidated =
      this.id === 'omniroute'
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        if (buffer.length > 1_000_000 || content.length > 32_000) throw new Error('Compatible provider response exceeded the safe limit')
        const frames = buffer.split(/\r?\n\r?\n/)
        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          for (const line of frame.split(/\r?\n/)) {
            const match = /^data:\s?(.*)$/.exec(line)
            if (!match || !match[1]) continue
            if (match[1] === '[DONE]') {
              if (!content) throw new Error('Compatible provider returned an empty stream')

              this.assertUsableContent(
                content,
              )

              if (bufferUntilValidated) {
                yield {
                  type: 'text-delta',
                  content,
                }
              }

              yield {
                type: 'completed',
                response: {
                  content,
                  providerId:
                    this.id,
                  modelId:
                    effectiveModel,
                },
              }

              return
            }
            const body = JSON.parse(match[1]) as ChatCompletionBody
            if (body.error?.message) throw new OpenAICompatibleProviderError('UNKNOWN', 'Compatible provider returned a streaming error')
            if (body.model) effectiveModel = body.model
            const delta = body.choices?.[0]?.delta?.content
            if (delta) {
              content += delta

              if (!bufferUntilValidated) {
                yield {
                  type: 'text-delta',
                  content:
                    delta,
                }
              }
            }
          }
        }
      }
      throw new Error('Compatible provider stream ended before completion')
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
      cleanup()
    }
  }

  private assertUsableContent(
    content: string,
  ): void {
    if (this.id !== 'omniroute') {
      return
    }

    const normalized =
      content
        .trim()
        .replace(/\s+/g, ' ')

    if (
      /^.+ is no longer available\. Please switch to .+ in the latest version of Antigravity\.$/i
        .test(normalized)
    ) {
      throw new OpenAICompatibleProviderError(
        'MODEL_UNAVAILABLE',
      )
    }
  }


  private resolveModel(
    requestedModel?: string,
  ): string {
    const model =
      requestedModel?.trim()
      || this.defaultModel.trim()

    if (!model) {
      throw new OpenAICompatibleProviderError(
        'MODEL_UNAVAILABLE',
        'No model selected for compatible provider',
      )
    }

    return model
  }


  private headers(): Record<string, string> {
    const headers:
      Record<string, string> = {
        'Content-Type':
          'application/json',
      }

    const apiKey =
      this.apiKey.trim()

    if (apiKey) {
      headers.Authorization =
        `Bearer ${apiKey}`
    }

    return headers
  }

  private async fetchWithTimeout(url: string, init: RequestInit, milliseconds: number): Promise<{ response: Response; cleanup: () => void }> {
    if (init.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, milliseconds)
    const abort = () => controller.abort()
    init.signal?.addEventListener('abort', abort, { once: true })
    const cleanup = () => { clearTimeout(timeout); init.signal?.removeEventListener('abort', abort) }
    try { return { response: await this.fetcher(url, { ...init, redirect: 'error', signal: controller.signal }), cleanup } }
    catch (error) { cleanup(); if (timedOut) throw new OpenAICompatibleProviderError('REQUEST_TIMEOUT', 'Compatible provider request timed out'); throw error }
  }

  private async jsonWithLimit(response: Response): Promise<unknown> {
    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > 1_000_000) throw new Error('Compatible provider response exceeded the safe limit')
    if (!response.body) throw new Error('Compatible provider returned no response body')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 1_000_000) throw new Error('Compatible provider response exceeded the safe limit')
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder().decode(bytes))
  }

  private responseError(status: number, message?: string): OpenAICompatibleProviderError {
    if (status === 401) return new OpenAICompatibleProviderError('INVALID_CREDENTIAL')
    if (status === 403) return new OpenAICompatibleProviderError('ACCESS_RESTRICTED')
    if (status === 404 || (status === 400 && message?.toLowerCase().includes('model'))) return new OpenAICompatibleProviderError('MODEL_UNAVAILABLE')
    if (status === 429) {
      const detail = message?.toLocaleLowerCase('en-US') ?? ''
      const quotaExhausted = detail.includes('insufficient_quota')
        || detail.includes('exceeded your current quota')
        || detail.includes('credit balance')
        || detail.includes('spend limit')
        || detail.includes('usage limit')
        || detail.includes('quota threshold')
      return new OpenAICompatibleProviderError(quotaExhausted ? 'INSUFFICIENT_QUOTA' : 'RATE_LIMITED')
    }
    if (status >= 500) return new OpenAICompatibleProviderError('NETWORK_UNAVAILABLE', `Compatible provider failed with status ${status}`)
    return new OpenAICompatibleProviderError('UNKNOWN', `Compatible provider failed with status ${status}`)
  }
}
