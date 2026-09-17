import { describe, expect, it } from 'vitest'
import { compatibleRequestTimeoutMs, normalizeCompatibleBaseUrl, OpenAICompatibleProvider } from '../../src/main/providers/openai-compatible-provider'
import { ROADMAP_GENERATION_MAX_OUTPUT_TOKENS, ROADMAP_REPAIR_MAX_OUTPUT_TOKENS } from '../../src/application/roadmaps/roadmap-service'
import { CONTENT_GENERATION_TIMEOUT_MS } from '../../src/application/workspaces/content-generation-worker'

describe('OpenAICompatibleProvider', () => {
  it('allows local HTTP and requires HTTPS remotely', () => {
    expect(normalizeCompatibleBaseUrl('http://127.0.0.1:20128/v1/')).toBe('http://127.0.0.1:20128/v1')
    expect(() => normalizeCompatibleBaseUrl('http://localhost:20128/v1')).toThrow(/HTTPS/)
    expect(() => normalizeCompatibleBaseUrl('http://example.com/v1')).toThrow(/HTTPS/)
    expect(() => normalizeCompatibleBaseUrl('https://user:pass@example.com/v1')).toThrow(/Credentials/)
  })

  it('keeps initial generation plus one repair inside the bounded worker budget', () => {
    const initial = compatibleRequestTimeoutMs(ROADMAP_GENERATION_MAX_OUTPUT_TOKENS)
    const repair = compatibleRequestTimeoutMs(ROADMAP_REPAIR_MAX_OUTPUT_TOKENS)
    expect(initial).toBe(120_000)
    expect(repair).toBe(120_000)
    expect(initial + repair).toBeLessThan(CONTENT_GENERATION_TIMEOUT_MS)
    expect(compatibleRequestTimeoutMs(4_000)).toBe(220_000)
    expect(compatibleRequestTimeoutMs(20_000)).toBe(240_000)
    expect(compatibleRequestTimeoutMs(20_000)).toBeLessThan(CONTENT_GENERATION_TIMEOUT_MS)
  })

  it('validates that the configured model is listed', async () => {
    const fetcher: typeof fetch = async (input) => new Response(JSON.stringify(String(input).endsWith('/models') ? { data: [{ id: 'codex/gpt-5.6-sol' }] } : String(input).endsWith('/responses') ? { output_text: 'OK' } : { choices: [{ message: { content: 'OK' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const provider = new OpenAICompatibleProvider('omniroute', 'OmniRoute', 'http://127.0.0.1:20128/v1', 'omniroute', 'codex/gpt-5.6-sol', fetcher)
    await expect(provider.testConnection()).resolves.toBeUndefined()
  })

  it('distinguishes exhausted quota from transient rate limiting', async () => {
    const quota = new OpenAICompatibleProvider('openai-compatible', 'Route', 'https://route.example/v1', 'token', 'route/model', async () => new Response(JSON.stringify({ error: { message: 'You exceeded your current quota' } }), { status: 429 }))
    const rateLimit = new OpenAICompatibleProvider('openai-compatible', 'Route', 'https://route.example/v1', 'token', 'route/model', async () => new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), { status: 429 }))

    await expect(quota.sendMessage({ messages: [{ role: 'user', content: 'Oi' }], maxOutputTokens: 20 })).rejects.toMatchObject({ code: 'INSUFFICIENT_QUOTA' })
    await expect(rateLimit.sendMessage({ messages: [{ role: 'user', content: 'Oi' }], maxOutputTokens: 20 })).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('maps chat completions into the canonical response', async () => {
    let requestBody: Record<string, unknown> | null = null
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/models')) return new Response(JSON.stringify({ data: [] }), { status: 200 })
      if (String(input).endsWith('/responses')) return new Response(JSON.stringify({ error: { message: 'Endpoint not found' } }), { status: 404, headers: { 'Content-Type': 'application/json' } })
      requestBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ model: 'route/model', choices: [{ message: { content: 'OK' } }] }), { status: 200 })
    }
    const provider = new OpenAICompatibleProvider('openai-compatible', 'Route', 'https://route.example/v1', 'token', 'route/model', fetcher)
    expect(await provider.sendMessage({ messages: [{ role: 'user', content: 'Oi' }], maxOutputTokens: 20, responseFormat: 'json_object' })).toMatchObject({ content: 'OK', providerId: 'openai-compatible', modelId: 'route/model' })
    expect(requestBody).toMatchObject({ max_tokens: 20, response_format: { type: 'json_object' }, stream: false })
  })

  it('uses Responses with canonical output, usage, and disabled storage', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const provider = new OpenAICompatibleProvider('omniroute', 'OmniRoute', 'http://127.0.0.1:20128/v1', 'token', 'codex/gpt-5.6-sol', async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ model: 'codex/gpt-5.6-sol', output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }], usage: { input_tokens: 12, output_tokens: 7 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    await expect(provider.sendMessage({ messages: [{ role: 'user', content: 'JSON' }], maxOutputTokens: 2600, responseFormat: 'json_object' })).resolves.toEqual({ content: '{"ok":true}', providerId: 'omniroute', modelId: 'codex/gpt-5.6-sol', usage: { inputTokens: 12, outputTokens: 7 } })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('http://127.0.0.1:20128/v1/responses')
    expect(calls[0]?.body).toMatchObject({ max_output_tokens: 2600, store: false, text: { format: { type: 'json_object' } } })
    expect(calls[0]?.body).not.toHaveProperty('max_tokens')
  })

  it('falls back to chat only when Responses is explicitly unsupported', async () => {
    const urls: string[] = []
    const provider = new OpenAICompatibleProvider('openai-compatible', 'Generic', 'https://route.example/v1', 'token', 'route/model', async (input) => {
      urls.push(String(input))
      return String(input).endsWith('/responses')
        ? new Response(JSON.stringify({ error: { message: 'Unknown endpoint responses' } }), { status: 404, headers: { 'Content-Type': 'application/json' } })
        : new Response(JSON.stringify({ choices: [{ message: { content: 'chat ok' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    await expect(provider.sendMessage({ messages: [{ role: 'user', content: 'Oi' }], maxOutputTokens: 20 })).resolves.toMatchObject({ content: 'chat ok' })
    expect(urls).toEqual(['https://route.example/v1/responses', 'https://route.example/v1/chat/completions'])
  })

  it('does not retry through chat after a Responses service failure', async () => {
    const urls: string[] = []
    const provider = new OpenAICompatibleProvider('openai-compatible', 'Route', 'https://route.example/v1', 'token', 'route/model', async (input) => {
      urls.push(String(input))
      return new Response(JSON.stringify({ error: { message: 'Service unavailable' } }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    })

    await expect(provider.sendMessage({ messages: [{ role: 'user', content: 'Oi' }], maxOutputTokens: 20 })).rejects.toMatchObject({ code: 'NETWORK_UNAVAILABLE' })
    expect(urls).toEqual(['https://route.example/v1/responses'])
  })

  it('keeps caller cancellation active while consuming the response body', async () => {
    const controller = new AbortController()
    const fetcher: typeof fetch = async (_input, init) => new Response(new ReadableStream({
      start(streamController) {
        init?.signal?.addEventListener('abort', () => streamController.error(new DOMException('Aborted', 'AbortError')), { once: true })
      },
    }), { status: 200 })
    const provider = new OpenAICompatibleProvider('openai-compatible', 'Route', 'https://route.example/v1', 'token', 'route/model', fetcher)
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
    const provider = new OpenAICompatibleProvider('openai-compatible', 'Route', 'https://route.example/v1', 'token', 'route/model', fetcher)

    await expect(provider.sendMessage({ messages: [{ role: 'user', content: 'Oi' }], maxOutputTokens: 20, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(called).toBe(false)
  })

  it('parses chat completion streaming deltas', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"O"}}]}\n\ndata: {"choices":[{"delta":{"content":"K"}}]}\n\ndata: [DONE]\n\n')); controller.close() } })
    const fetcher: typeof fetch = async () => new Response(stream, { status: 200 })
    const provider = new OpenAICompatibleProvider('openai-compatible', 'Route', 'https://route.example/v1', 'token', 'route/model', fetcher)
    const events = []
    for await (const event of provider.streamMessage!({ messages: [{ role: 'user', content: 'Oi' }], maxOutputTokens: 20 })) events.push(event)
    expect(events).toEqual([{ type: 'text-delta', content: 'O' }, { type: 'text-delta', content: 'K' }, { type: 'completed', response: { content: 'OK', providerId: 'openai-compatible', modelId: 'route/model' } }])
  })
})
