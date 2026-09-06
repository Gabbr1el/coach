import { describe, expect, it } from 'vitest'
import { normalizeCompatibleBaseUrl, OpenAICompatibleProvider } from '../../src/main/providers/openai-compatible-provider'

describe('OpenAICompatibleProvider', () => {
  it('allows local HTTP and requires HTTPS remotely', () => {
    expect(normalizeCompatibleBaseUrl('http://127.0.0.1:20128/v1/')).toBe('http://127.0.0.1:20128/v1')
    expect(() => normalizeCompatibleBaseUrl('http://localhost:20128/v1')).toThrow(/HTTPS/)
    expect(() => normalizeCompatibleBaseUrl('http://example.com/v1')).toThrow(/HTTPS/)
    expect(() => normalizeCompatibleBaseUrl('https://user:pass@example.com/v1')).toThrow(/Credentials/)
  })

  it('validates that the configured model is listed', async () => {
    const fetcher: typeof fetch = async (input) => new Response(JSON.stringify(String(input).endsWith('/models') ? { data: [{ id: 'codex/gpt-5.6-sol' }] } : { choices: [{ message: { content: 'OK' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const provider = new OpenAICompatibleProvider('OmniRoute', 'http://127.0.0.1:20128/v1', 'omniroute', 'codex/gpt-5.6-sol', fetcher)
    await expect(provider.testConnection()).resolves.toBeUndefined()
  })

  it('maps chat completions into the canonical response', async () => {
    const fetcher: typeof fetch = async (input) => {
      if (String(input).endsWith('/models')) return new Response(JSON.stringify({ data: [] }), { status: 200 })
      return new Response(JSON.stringify({ model: 'route/model', choices: [{ message: { content: 'OK' } }] }), { status: 200 })
    }
    const provider = new OpenAICompatibleProvider('Route', 'https://route.example/v1', 'token', 'route/model', fetcher)
    expect(await provider.sendMessage({ messages: [{ role: 'user', content: 'Oi' }], maxOutputTokens: 20 })).toMatchObject({ content: 'OK', providerId: 'openai-compatible', modelId: 'route/model' })
  })

  it('keeps caller cancellation active while consuming the response body', async () => {
    const controller = new AbortController()
    const fetcher: typeof fetch = async (_input, init) => new Response(new ReadableStream({
      start(streamController) {
        init?.signal?.addEventListener('abort', () => streamController.error(new DOMException('Aborted', 'AbortError')), { once: true })
      },
    }), { status: 200 })
    const provider = new OpenAICompatibleProvider('Route', 'https://route.example/v1', 'token', 'route/model', fetcher)
    const pending = provider.sendMessage({ messages: [{ role: 'user', content: 'Oi' }], maxOutputTokens: 20, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('does not send a request when the caller already cancelled it', async () => {
    const controller = new AbortController()
    controller.abort()
    let called = false
    const fetcher: typeof fetch = async () => {
      called = true
      return new Response('{}', { status: 200 })
    }
    const provider = new OpenAICompatibleProvider('Route', 'https://route.example/v1', 'token', 'route/model', fetcher)

    await expect(provider.sendMessage({ messages: [{ role: 'user', content: 'Oi' }], maxOutputTokens: 20, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(called).toBe(false)
  })

  it('parses chat completion streaming deltas', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"O"}}]}\n\ndata: {"choices":[{"delta":{"content":"K"}}]}\n\ndata: [DONE]\n\n')); controller.close() } })
    const fetcher: typeof fetch = async () => new Response(stream, { status: 200 })
    const provider = new OpenAICompatibleProvider('Route', 'https://route.example/v1', 'token', 'route/model', fetcher)
    const events = []
    for await (const event of provider.streamMessage!({ messages: [{ role: 'user', content: 'Oi' }], maxOutputTokens: 20 })) events.push(event)
    expect(events).toEqual([{ type: 'text-delta', content: 'O' }, { type: 'text-delta', content: 'K' }, { type: 'completed', response: { content: 'OK', providerId: 'openai-compatible', modelId: 'route/model' } }])
  })
})
