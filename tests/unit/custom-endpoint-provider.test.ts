import {
  describe,
  expect,
  it,
} from 'vitest'

import {
  configureCompatibleInputSchema,
} from '../../src/shared/contracts/provider-contract'

import {
  OpenAICompatibleProvider,
} from '../../src/main/providers/openai-compatible-provider'


describe(
  'custom endpoint configuration',
  () => {
    it(
      'accepts endpoint without token and without initial model',
      () => {
        const input =
          configureCompatibleInputSchema.parse({
            connectorId:
              'openai-compatible',

            label:
              'Endpoint personalizado',

            baseUrl:
              'https://endpoint.example/v1',

            apiKey:
              '',

            model:
              '',

            persistence:
              'session',
          })

        expect(input.apiKey)
          .toBe('')

        expect(input.model)
          .toBe('')
      },
    )


    it(
      'keeps OmniRoute token required',
      () => {
        expect(() =>
          configureCompatibleInputSchema.parse({
            connectorId:
              'omniroute',

            label:
              'OmniRoute',

            baseUrl:
              'http://127.0.0.1:20128/v1',

            apiKey:
              '',

            model:
              '',

            persistence:
              'session',
          }),
        ).toThrow()
      },
    )


    it(
      'does not send Authorization when token is empty',
      async () => {
        let authorization:
          string | null = 'not-called'

        const provider =
          new OpenAICompatibleProvider(
            'openai-compatible',
            'Endpoint',
            'https://endpoint.example/v1',
            '',
            '',
            async (
              _input,
              init,
            ) => {
              authorization =
                new Headers(
                  init?.headers,
                ).get(
                  'Authorization',
                )

              return new Response(
                JSON.stringify({
                  data: [
                    {
                      id:
                        'modelo-a',
                    },
                    {
                      id:
                        'modelo-b',
                    },
                  ],
                }),
                {
                  status:
                    200,

                  headers: {
                    'Content-Type':
                      'application/json',
                  },
                },
              )
            },
          )

        await expect(
          provider.listModels(),
        ).resolves.toEqual([
          'modelo-a',
          'modelo-b',
        ])

        expect(
          authorization,
        ).toBeNull()
      },
    )
  },
)
