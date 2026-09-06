import type { AIProvider, AIProviderCapabilities, AIRequest, AIResponse, AIStreamEvent } from '../../application/ai/ai-provider'

type Fetcher = typeof fetch

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

export class OpenAICompatibleProviderError extends Error {
  constructor(readonly code: 'INVALID_CREDENTIAL' | 'MODEL_UNAVAILABLE' | 'ACCESS_RESTRICTED' | 'RATE_LIMITED' | 'NETWORK_UNAVAILABLE' | 'UNKNOWN', message?: string) {
    super(message ?? code)
    this.name = 'OpenAICompatibleProviderError'
  }
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly id = 'openai-compatible'
  readonly name: string
  private readonly baseUrl: string

  constructor(name: string, baseUrl: string, private readonly apiKey: string, private readonly defaultModel: string, private readonly fetcher: Fetcher = fetch) {
    this.name = name
    this.baseUrl = normalizeCompatibleBaseUrl(baseUrl)
  }

  getCapabilities(): AIProviderCapabilities {
    return { streaming: true, usageInformation: true, supportedInput: ['text'] }
  }

  async testConnection(): Promise<void> {
    const { response, cleanup } = await this.fetchWithTimeout(`${this.baseUrl}/models`, { method: 'GET', headers: this.headers() }, 10_000)
    let body: { data?: Array<{ id?: string }> }
    try {
      if (!response.ok) throw this.responseError(response.status)
      body = await this.jsonWithLimit(response) as { data?: Array<{ id?: string }> }
    } finally { cleanup() }
    if (body.data?.length && !body.data.some((model) => model.id === this.defaultModel)) throw new Error('Configured model is not listed by the compatible provider')
    await this.sendMessage({ messages: [{ role: 'user', content: 'Reply only OK' }], maxOutputTokens: 8 })
  }

  async sendMessage(request: AIRequest): Promise<AIResponse> {
    const { response, cleanup } = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: this.headers(), signal: request.signal,
      body: JSON.stringify({ model: request.model ?? this.defaultModel, messages: request.messages, max_tokens: request.maxOutputTokens, stream: false }),
    }, 60_000)
    try {
      const body = await this.jsonWithLimit(response) as ChatCompletionBody
      if (!response.ok) throw this.responseError(response.status, body.error?.message)
      const content = body.choices?.[0]?.message?.content ?? ''
      if (!content) throw new Error('Compatible provider returned an empty response')
      return { content, providerId: this.id, modelId: body.model ?? this.defaultModel, ...(body.usage ? { usage: { inputTokens: body.usage.prompt_tokens ?? 0, outputTokens: body.usage.completion_tokens ?? 0 } } : {}) }
    } finally { cleanup() }
  }

  async *streamMessage(request: AIRequest): AsyncIterable<AIStreamEvent> {
    const { response, cleanup } = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: this.headers(), signal: request.signal,
      body: JSON.stringify({ model: request.model ?? this.defaultModel, messages: request.messages, max_tokens: request.maxOutputTokens, stream: true }),
    }, 60_000)
    if (!response.ok) { cleanup(); throw this.responseError(response.status) }
    if (!response.body) { cleanup(); throw new OpenAICompatibleProviderError('UNKNOWN', 'Compatible provider returned no response body') }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let effectiveModel = request.model ?? this.defaultModel
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
              yield { type: 'completed', response: { content, providerId: this.id, modelId: effectiveModel } }
              return
            }
            const body = JSON.parse(match[1]) as ChatCompletionBody
            if (body.error?.message) throw new OpenAICompatibleProviderError('UNKNOWN', 'Compatible provider returned a streaming error')
            if (body.model) effectiveModel = body.model
            const delta = body.choices?.[0]?.delta?.content
            if (delta) { content += delta; yield { type: 'text-delta', content: delta } }
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

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }
  }

  private async fetchWithTimeout(url: string, init: RequestInit, milliseconds: number): Promise<{ response: Response; cleanup: () => void }> {
    if (init.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), milliseconds)
    const abort = () => controller.abort()
    init.signal?.addEventListener('abort', abort, { once: true })
    const cleanup = () => { clearTimeout(timeout); init.signal?.removeEventListener('abort', abort) }
    try { return { response: await this.fetcher(url, { ...init, redirect: 'error', signal: controller.signal }), cleanup } }
    catch (error) { cleanup(); throw error }
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
    if (status === 429) return new OpenAICompatibleProviderError('RATE_LIMITED')
    return new OpenAICompatibleProviderError('UNKNOWN', `Compatible provider failed with status ${status}`)
  }
}
