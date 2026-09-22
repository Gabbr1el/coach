import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  GitHubCopilotOAuthDeviceFlow,
  GitHubCopilotOAuthError,
} from '../../src/main/providers/github-copilot-oauth'

function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  )
}

describe('GitHubCopilotOAuthDeviceFlow', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('returns the immutable GitHub user id and carries the reauthentication target', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        device_code: 'device',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 1,
      }))
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'oauth-token',
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 123456,
        login: 'renamed-user',
      }))
    vi.stubGlobal('fetch', fetchMock)

    const flow = new GitHubCopilotOAuthDeviceFlow()
    const started = await flow.begin(
      'client-id',
      '00000000-0000-4000-8000-000000000099',
    )
    const completion = flow.complete(started.flowId)
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(completion).resolves.toEqual({
      credential: 'oauth-token',
      identity: {
        key: 'github:123456',
        label: '@renamed-user',
      },
      targetAccountId: '00000000-0000-4000-8000-000000000099',
    })
  })

  it('does not accept an OAuth credential without a verified numeric GitHub id', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        device_code: 'device',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 1,
      }))
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'oauth-token',
      }))
      .mockResolvedValueOnce(jsonResponse({
        login: 'unverified-user',
      })))

    const flow = new GitHubCopilotOAuthDeviceFlow()
    const started = await flow.begin('client-id')
    const completion = flow.complete(started.flowId)
    const assertion = expect(completion).rejects.toBeInstanceOf(
      GitHubCopilotOAuthError,
    )
    await vi.advanceTimersByTimeAsync(1_000)

    await assertion
  })
})
