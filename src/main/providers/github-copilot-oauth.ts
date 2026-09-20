import { randomUUID } from 'node:crypto'

import type {
  ProviderConnectionErrorCode,
} from '../../shared/contracts/provider-contract'


interface PendingFlow {
  readonly clientId: string
  readonly deviceCode: string
  readonly expiresAt: number
  intervalMs: number
}


export class GitHubCopilotOAuthError
extends Error {
  constructor(
    readonly code:
      ProviderConnectionErrorCode,
    message?: string,
  ) {
    super(
      message
      ?? `GitHub OAuth error: ${code}`,
    )
    this.name =
      'GitHubCopilotOAuthError'
  }
}


export class GitHubCopilotOAuthDeviceFlow {
  private readonly pending =
    new Map<string, PendingFlow>()

  async begin(
    clientId: string,
  ) {
    const normalized =
      clientId.trim()

    if (!normalized) {
      throw new GitHubCopilotOAuthError(
        'OAUTH_CONFIGURATION_MISSING',
      )
    }

    let response: Response

    try {
      response =
        await fetch(
          'https://github.com/login/device/code',
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type':
                'application/x-www-form-urlencoded',
            },
            body:
              new URLSearchParams({
                client_id: normalized,
                scope: 'read:user',
              }),
          },
        )
    } catch {
      throw new GitHubCopilotOAuthError(
        'NETWORK_UNAVAILABLE',
      )
    }

    const body =
      await response.json()
        .catch(() => null) as {
          device_code?: string
          user_code?: string
          verification_uri?: string
          expires_in?: number
          interval?: number
          error?: string
        } | null

    if (
      !response.ok
      || !body
      || body.error
    ) {
      const configurationError =
        body?.error === 'device_flow_disabled'
        || body?.error
          === 'incorrect_client_credentials'

      throw new GitHubCopilotOAuthError(
        configurationError
          ? 'OAUTH_CONFIGURATION_MISSING'
          : 'UNKNOWN',
      )
    }

    if (
      !body.device_code
      || !body.user_code
      || !body.verification_uri
      || !body.expires_in
      || !body.interval
    ) {
      throw new GitHubCopilotOAuthError(
        'UNKNOWN',
      )
    }

    const flowId =
      randomUUID()
    const expiresAt =
      Date.now()
      + body.expires_in * 1_000

    this.pending.set(
      flowId,
      {
        clientId: normalized,
        deviceCode: body.device_code,
        expiresAt,
        intervalMs:
          body.interval * 1_000,
      },
    )

    return {
      flowId,
      userCode: body.user_code,
      verificationUri:
        body.verification_uri,
      expiresAt,
    }
  }


  async complete(
    flowId: string,
  ): Promise<{
    readonly credential: string
    readonly identityLabel:
      string | null
  }> {
    const pending =
      this.pending.get(flowId)

    if (!pending) {
      throw new GitHubCopilotOAuthError(
        'AUTH_CANCELLED',
      )
    }

    while (
      Date.now()
      < pending.expiresAt
    ) {
      await new Promise<void>(
        (resolve) =>
          setTimeout(
            resolve,
            pending.intervalMs,
          ),
      )

      let response: Response

      try {
        response =
          await fetch(
            'https://github.com/login/oauth/access_token',
            {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                'Content-Type':
                  'application/x-www-form-urlencoded',
              },
              body:
                new URLSearchParams({
                  client_id:
                    pending.clientId,
                  device_code:
                    pending.deviceCode,
                  grant_type:
                    'urn:ietf:params:oauth:grant-type:device_code',
                }),
            },
          )
      } catch {
        throw new GitHubCopilotOAuthError(
          'NETWORK_UNAVAILABLE',
        )
      }

      const body =
        await response.json()
          .catch(() => null) as {
            access_token?: string
            error?: string
            interval?: number
          } | null

      if (
        response.ok
        && body?.access_token
      ) {
        this.pending.delete(
          flowId,
        )

        return {
          credential:
            body.access_token,
          identityLabel:
            await this.identity(
              body.access_token,
            ),
        }
      }

      switch (body?.error) {
        case 'authorization_pending':
          continue

        case 'slow_down':
          pending.intervalMs =
            Math.max(
              pending.intervalMs + 5_000,
              (body.interval ?? 0)
                * 1_000,
            )
          continue

        case 'access_denied':
        case 'expired_token':
          this.pending.delete(flowId)
          throw new GitHubCopilotOAuthError(
            'AUTH_CANCELLED',
          )

        case 'device_flow_disabled':
        case 'incorrect_client_credentials':
        case 'unsupported_grant_type':
          this.pending.delete(flowId)
          throw new GitHubCopilotOAuthError(
            'OAUTH_CONFIGURATION_MISSING',
          )

        default:
          this.pending.delete(flowId)
          throw new GitHubCopilotOAuthError(
            'UNKNOWN',
          )
      }
    }

    this.pending.delete(flowId)
    throw new GitHubCopilotOAuthError(
      'AUTH_CANCELLED',
    )
  }


  private async identity(
    accessToken: string,
  ): Promise<string | null> {
    try {
      const response =
        await fetch(
          'https://api.github.com/user',
          {
            headers: {
              Accept:
                'application/vnd.github+json',
              Authorization:
                `Bearer ${accessToken}`,
              'X-GitHub-Api-Version':
                '2022-11-28',
            },
          },
        )

      if (!response.ok) {
        return null
      }

      const body =
        await response.json() as {
          login?: string
        }

      const login =
        body.login?.trim()

      return login
        ? `@${login}`
        : null
    } catch {
      return null
    }
  }
}
