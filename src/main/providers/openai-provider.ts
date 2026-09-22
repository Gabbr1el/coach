import type { AIProvider, AIProviderCapabilities, AIRequest, AIResponse } from '../../application/ai/ai-provider'
import type { ReasoningEffort } from '../../shared/contracts/provider-account-contract'

type Fetcher = typeof fetch

export class OpenAIProviderError extends Error {
  constructor(readonly code: 'INVALID_CREDENTIAL' | 'INSUFFICIENT_QUOTA' | 'MODEL_UNAVAILABLE' | 'ACCESS_RESTRICTED' | 'RATE_LIMITED' | 'NETWORK_UNAVAILABLE' | 'REQUEST_TIMEOUT' | 'UNKNOWN') {
    super(code)
    this.name = 'OpenAIProviderError'
  }
}

function errorForResponse(status: number, body: OpenAIResponseBody | null): OpenAIProviderError {
  if (status === 401) return new OpenAIProviderError('INVALID_CREDENTIAL')
  if (status === 403) return new OpenAIProviderError('ACCESS_RESTRICTED')
  if ((status === 400 || status === 404) && (body?.error?.param === 'model' || body?.error?.code === 'model_not_found')) return new OpenAIProviderError('MODEL_UNAVAILABLE')
  if (status === 404) return new OpenAIProviderError('MODEL_UNAVAILABLE')
  if (status === 429) {
    const quotaCodes = new Set(['insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded'])
    const code = body?.error?.code?.toLocaleLowerCase('en-US') ?? ''
    const type = body?.error?.type?.toLocaleLowerCase('en-US') ?? ''
    const message = body?.error?.message?.toLocaleLowerCase('en-US') ?? ''
    const quota = quotaCodes.has(code) || quotaCodes.has(type) || message.includes('exceeded your current quota') || message.includes('credit balance is too low') || message.includes('usage limit has been reached')
    return new OpenAIProviderError(quota ? 'INSUFFICIENT_QUOTA' : 'RATE_LIMITED')
  }
  return new OpenAIProviderError('UNKNOWN')
}

interface OpenAIResponseBody {
  readonly model?: string
  readonly output_text?: string
  readonly output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
  readonly usage?: { input_tokens?: number; output_tokens?: number }
  readonly error?: { message?: string; type?: string; code?: string | null; param?: string | null }
}

function extractText(body: OpenAIResponseBody): string {
  if (body.output_text) return body.output_text
  return body.output?.flatMap((item) => item.content ?? []).filter((item) => item.type === 'output_text').map((item) => item.text ?? '').join('') ?? ''
}

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai'
  readonly name = 'OpenAI'

  constructor(
    private readonly apiKey: string,
    private readonly defaultModel: string,
    private readonly reasoningEffort: ReasoningEffort = 'auto',
    private readonly fetcher: Fetcher = fetch,
  ) {}

  getCapabilities(): AIProviderCapabilities {
    return { streaming: true, usageInformation: true, supportedInput: ['text'] }
  }

  async testConnection(): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20_000)
    let response: Response
    let body: OpenAIResponseBody | null = null
    try {
      response = await this.fetcher('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.defaultModel,
            input: 'Reply only with OK.',
            max_output_tokens: 16,
            store: false,
            ...(this.reasoningEffort === 'auto'
              ? {}
              : {
                  reasoning: {
                    effort: this.reasoningEffort,
                  },
                }),
          }),        signal: controller.signal,
      })
      if (!response.ok) body = await response.json().catch(() => null) as OpenAIResponseBody | null
    } catch {
      throw new OpenAIProviderError(controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_UNAVAILABLE')
    } finally {
      clearTimeout(timeout)
    }
    if (response.ok) return
    throw errorForResponse(response.status, body)
  }

  sendMessage(request: AIRequest): Promise<AIResponse> {
    return this.request(request)
  }

  async *streamMessage(request: AIRequest): AsyncIterable<import('../../application/ai/ai-provider').AIStreamEvent> {
    if (request.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
    const timeoutController = new AbortController()
    const timeout = setTimeout(() => timeoutController.abort(), 60_000)
    const abort = () => timeoutController.abort()
    request.signal?.addEventListener('abort', abort, { once: true })
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let completed = false
    try {
      const response = await this.fetcher('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:
            request.model
            ?? this.defaultModel,

          input:
            request.messages.map(
              (message) => ({
                role:
                  message.role,

                content:
                  message.content,
              }),
            ),

          max_output_tokens:
            request.maxOutputTokens,

          store:
            false,

          stream:
            true,

          ...(this.reasoningEffort === 'auto'
            ? {}
            : {
                reasoning: {
                  effort:
                    this.reasoningEffort,
                },
              }),
        }),
        signal: timeoutController.signal,
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as OpenAIResponseBody | null
        throw errorForResponse(response.status, body)
      }
      if (!response.body) throw new OpenAIProviderError('NETWORK_UNAVAILABLE')
      reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        if (buffer.length > 1_000_000) throw new Error('OpenAI stream frame exceeded the safe limit')
        const frames = buffer.split(/\r?\n\r?\n/)
        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          for (const line of frame.split('\n')) {
            const match = /^data:\s?(.*)$/.exec(line.replace(/\r$/, ''))
            if (!match) continue
            const data = match[1] ?? ''
            if (!data) continue
            if (data === '[DONE]') continue
            const event = JSON.parse(data) as { type?: string; delta?: string; response?: OpenAIResponseBody }
            if (event.type === 'response.output_text.delta' && event.delta) {
              content += event.delta
              yield { type: 'text-delta', content: event.delta }
            }
            if (event.type === 'response.completed' && event.response) {
              completed = true
              yield { type: 'completed', response: { content: extractText(event.response) || content, providerId: this.id, modelId: event.response.model ?? request.model ?? this.defaultModel } }
            }
          }
        }
      }
      if (!completed) throw new Error('OpenAI stream ended before completion')
    } catch (error) {
      if (error instanceof OpenAIProviderError) throw error
      if (request.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
      if (timeoutController.signal.aborted) throw new OpenAIProviderError('REQUEST_TIMEOUT')
      throw new OpenAIProviderError('NETWORK_UNAVAILABLE')
    } finally {
      clearTimeout(timeout)
      request.signal?.removeEventListener('abort', abort)
      if (reader) {
        if (!completed) await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
    }
  }

  private async request(request: AIRequest): Promise<AIResponse> {
    const timeoutController = new AbortController()
    const timeout = setTimeout(() => timeoutController.abort(), 30_000)
    const abortFromCaller = () => timeoutController.abort()
    request.signal?.addEventListener('abort', abortFromCaller, { once: true })
    let response: Response
    let body: OpenAIResponseBody
    try {
      response = await this.fetcher('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model:
              request.model
              ?? this.defaultModel,

            input:
              request.messages.map(
                (message) => ({
                  role:
                    message.role,

                  content:
                    message.content,
                }),
              ),

            max_output_tokens:
              request.maxOutputTokens,

            store:
              false,

            ...(this.reasoningEffort === 'auto'
              ? {}
              : {
                  reasoning: {
                    effort:
                      this.reasoningEffort,
                  },
                }),
          }),
        signal: timeoutController.signal,
      })
      body = await response.json().catch(() => ({})) as OpenAIResponseBody
    } catch (error) {
      if (request.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
      if (timeoutController.signal.aborted) throw new OpenAIProviderError('REQUEST_TIMEOUT')
      throw new OpenAIProviderError('NETWORK_UNAVAILABLE')
    } finally {
      clearTimeout(timeout)
      request.signal?.removeEventListener('abort', abortFromCaller)
    }
    if (!response.ok) {
      throw errorForResponse(response.status, body)
    }
    const content = extractText(body)
    if (!content) throw new OpenAIProviderError('UNKNOWN')
    return {
      content,
      providerId: this.id,
      modelId: body.model ?? request.model ?? this.defaultModel,
      ...(body.usage ? { usage: { inputTokens: body.usage.input_tokens ?? 0, outputTokens: body.usage.output_tokens ?? 0 } } : {}),
    }
  }
}
