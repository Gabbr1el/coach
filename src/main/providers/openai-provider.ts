import type { AIProvider, AIProviderCapabilities, AIRequest, AIResponse } from '../../application/ai/ai-provider'

type Fetcher = typeof fetch

interface OpenAIResponseBody {
  readonly model?: string
  readonly output_text?: string
  readonly output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
  readonly usage?: { input_tokens?: number; output_tokens?: number }
  readonly error?: { message?: string }
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
    private readonly fetcher: Fetcher = fetch,
  ) {}

  getCapabilities(): AIProviderCapabilities {
    return { streaming: true, usageInformation: true, supportedInput: ['text'] }
  }

  async testConnection(): Promise<void> {
    await this.request({ messages: [{ role: 'user', content: 'Reply only with OK.' }], maxOutputTokens: 8 })
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
        body: JSON.stringify({ model: request.model ?? this.defaultModel, input: request.messages.map((message) => ({ role: message.role, content: message.content })), max_output_tokens: request.maxOutputTokens, store: false, stream: true }),
        signal: timeoutController.signal,
      })
      if (!response.ok || !response.body) throw new Error(`OpenAI streaming request failed with status ${response.status}`)
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
          model: request.model ?? this.defaultModel,
          input: request.messages.map((message) => ({ role: message.role, content: message.content })),
          max_output_tokens: request.maxOutputTokens,
          store: false,
        }),
        signal: timeoutController.signal,
      })
      body = await response.json() as OpenAIResponseBody
    } catch (error) {
      if (timeoutController.signal.aborted) throw new Error('OpenAI request was cancelled or timed out')
      throw new Error('Could not connect to OpenAI', { cause: error })
    } finally {
      clearTimeout(timeout)
      request.signal?.removeEventListener('abort', abortFromCaller)
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('OpenAI rejected the API credential')
      if (response.status === 429) throw new Error('OpenAI rate limit or quota was reached')
      throw new Error(`OpenAI request failed with status ${response.status}`)
    }
    const content = extractText(body)
    if (!content) throw new Error('OpenAI returned an empty response')
    return {
      content,
      providerId: this.id,
      modelId: body.model ?? request.model ?? this.defaultModel,
      ...(body.usage ? { usage: { inputTokens: body.usage.input_tokens ?? 0, outputTokens: body.usage.output_tokens ?? 0 } } : {}),
    }
  }
}
