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
    const provider = new OpenAIProvider('secret-key-value-that-is-long-enough', 'gpt-test', 'auto', fetcher)

    const response = await provider.sendMessage({ messages: [{ role: 'user', content: 'Olá' }], maxOutputTokens: 50 })

    expect(response).toEqual({ content: 'Resposta', providerId: 'openai', modelId: 'gpt-test', usage: { inputTokens: 4, outputTokens: 2 } })
    expect(requestBody).toContain('Olá')
    expect(JSON.parse(requestBody)).toMatchObject({ store: false })
    expect(JSON.parse(requestBody))
      .not
      .toHaveProperty('reasoning')
    expect(new Headers(requestHeaders).get('Authorization')).toBe('Bearer secret-key-value-that-is-long-enough')
  })
  it.each([
    'low',
    'medium',
    'high',
  ] as const)(
    'sends reasoning effort %s to the Responses API',
    async (reasoningEffort) => {
      let requestBody = ''

      const fetcher:
        typeof fetch =
        async (_input, init) => {
          requestBody =
            String(init?.body)

          return new Response(
            JSON.stringify({
              model:
                'gpt-test',

              output_text:
                'Resposta',
            }),
            {
              status: 200,

              headers: {
                'Content-Type':
                  'application/json',
              },
            },
          )
        }

      const provider =
        new OpenAIProvider(
          'secret-key-value-that-is-long-enough',
          'gpt-test',
          reasoningEffort,
          fetcher,
        )

      await provider.sendMessage({
        messages: [
          {
            role: 'user',
            content: 'Olá',
          },
        ],

        maxOutputTokens: 50,
      })

      expect(
        JSON.parse(requestBody),
      ).toMatchObject({
        reasoning: {
          effort:
            reasoningEffort,
        },
      })
    },
  )
  it('uses the configured reasoning effort when testing the connection', async () => {
    let requestBody = ''

    const fetcher:
      typeof fetch =
      async (_input, init) => {
        requestBody =
          String(init?.body)

        return new Response(
          JSON.stringify({
            model:
              'gpt-test',
          }),
          {
            status: 200,

            headers: {
              'Content-Type':
                'application/json',
            },
          },
        )
      }

    const provider =
      new OpenAIProvider(
        'secret-key-value-that-is-long-enough',
        'gpt-test',
        'medium',
        fetcher,
      )

    await provider.testConnection()

    expect(
      JSON.parse(requestBody),
    ).toMatchObject({
      reasoning: {
        effort: 'medium',
      },
    })
  })
  it('normalizes official API errors', async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    const provider = new OpenAIProvider('secret-key-value-that-is-long-enough', 'gpt-test', 'auto', fetcher)

    await expect(provider.testConnection()).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
  })

  it.each([
    [403, { error: { code: 'policy_restricted' } }, 'ACCESS_RESTRICTED'],
    [404, { error: { code: 'model_not_found', param: 'model' } }, 'MODEL_UNAVAILABLE'],
    [429, { error: { code: 'insufficient_quota' } }, 'INSUFFICIENT_QUOTA'],
    [429, { error: { code: 'rate_limit_exceeded' } }, 'RATE_LIMITED'],
    [429, { error: { type: 'insufficient_quota', code: null } }, 'INSUFFICIENT_QUOTA'],
    [429, { error: { message: 'You exceeded your current quota, please check your plan and billing details.', code: null } }, 'INSUFFICIENT_QUOTA'],
    [429, { error: { code: 'credit_balance_exhausted' } }, 'INSUFFICIENT_QUOTA'],
    [429, { error: { code: 'project_spend_limit_exceeded' } }, 'INSUFFICIENT_QUOTA'],
    [429, { error: { message: 'Rate limit reached. Review billing settings if higher limits are needed.', code: null } }, 'RATE_LIMITED'],
  ] as const)('maps OpenAI status %s to %s', async (status, body, code) => {
    let requestBody = ''
    const fetcher: typeof fetch = async (_input, init) => {
      requestBody = String(init?.body)
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    }
    const provider = new OpenAIProvider('secret-key-value-that-is-long-enough', 'gpt-test', 'auto', fetcher)

    await expect(provider.testConnection()).rejects.toMatchObject({ code })
    expect(JSON.parse(requestBody)).toMatchObject({ model: 'gpt-test', store: false })
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
    let requestBody = ''

    const fetcher:
      typeof fetch =
      async (_input, init) => {
        requestBody =
          String(init?.body)

        return new Response(
          body,
          {
            status: 200,
          },
        )
      }

    const provider =
      new OpenAIProvider(
        'secret-key-value-that-is-long-enough',
        'gpt-test',
        'high',
        fetcher,
      )

    const events = []
    for await (const event of provider.streamMessage!({ messages: [{ role: 'user', content: 'Olá' }], maxOutputTokens: 50 })) events.push(event)

    expect(events).toEqual([
      { type: 'text-delta', content: 'Olá ' },
      { type: 'text-delta', content: 'mundo' },
      { type: 'completed', response: { content: 'Olá mundo', providerId: 'openai', modelId: 'gpt-test' } },
    ])
    expect(
      JSON.parse(requestBody),
    ).toMatchObject({
      stream: true,

      reasoning: {
        effort: 'high',
      },
    })
  })

})
