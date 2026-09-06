import { describe, expect, it } from 'vitest'
import { OpenAIProvider } from '../../src/main/providers/openai-provider'

describe('OpenAIProvider', () => {
  it('maps the canonical request and response without exposing the API key', async () => {
    let requestHeaders: RequestInit['headers']
    let requestBody = ''
    const fetcher: typeof fetch = async (_input, init) => {
      requestHeaders = init?.headers
      requestBody = String(init?.body)
      return new Response(JSON.stringify({ model: 'gpt-test', output_text: 'Resposta', usage: { input_tokens: 4, output_tokens: 2 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const provider = new OpenAIProvider('secret-key-value-that-is-long-enough', 'gpt-test', fetcher)

    const response = await provider.sendMessage({ messages: [{ role: 'user', content: 'Olá' }], maxOutputTokens: 50 })

    expect(response).toEqual({ content: 'Resposta', providerId: 'openai', modelId: 'gpt-test', usage: { inputTokens: 4, outputTokens: 2 } })
    expect(requestBody).toContain('Olá')
    expect(JSON.parse(requestBody)).toMatchObject({ store: false })
    expect(new Headers(requestHeaders).get('Authorization')).toBe('Bearer secret-key-value-that-is-long-enough')
  })

  it('normalizes official API errors', async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    const provider = new OpenAIProvider('secret-key-value-that-is-long-enough', 'gpt-test', fetcher)

    await expect(provider.testConnection()).rejects.toThrow('OpenAI rejected the API credential')
  })

  it('parses Responses API server-sent text deltas', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"Olá "}\n\n'))
        controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"mundo"}\n\n'))
        controller.enqueue(encoder.encode('data: {"type":"response.completed","response":{"model":"gpt-test","output_text":"Olá mundo"}}\n\n'))
        controller.close()
      },
    })
    const fetcher: typeof fetch = async () => new Response(body, { status: 200 })
    const provider = new OpenAIProvider('secret-key-value-that-is-long-enough', 'gpt-test', fetcher)

    const events = []
    for await (const event of provider.streamMessage!({ messages: [{ role: 'user', content: 'Olá' }], maxOutputTokens: 50 })) events.push(event)

    expect(events).toEqual([
      { type: 'text-delta', content: 'Olá ' },
      { type: 'text-delta', content: 'mundo' },
      { type: 'completed', response: { content: 'Olá mundo', providerId: 'openai', modelId: 'gpt-test' } },
    ])
  })
})
