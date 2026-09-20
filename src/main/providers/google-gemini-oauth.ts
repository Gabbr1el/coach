import {
  createHash,
  randomBytes,
} from 'node:crypto'

import {
  readFile,
} from 'node:fs/promises'

import {
  createServer,
} from 'node:http'

import type {
  AddressInfo,
} from 'node:net'


const GEMINI_SCOPES = [
  'openid',
  'profile',
  'email',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/generative-language.retriever',
] as const

const GOOGLE_AUTH_URL =
  'https://accounts.google.com/o/oauth2/v2/auth'

const GOOGLE_TOKEN_URL =
  'https://oauth2.googleapis.com/token'

const DEFAULT_TIMEOUT_MS =
  5 * 60 * 1000


interface GoogleDesktopClientFile {
  readonly installed?: {
    readonly client_id?: string
    readonly client_secret?: string
    readonly project_id?: string
    readonly auth_uri?: string
    readonly token_uri?: string
  }
}


interface GoogleDesktopClient {
  readonly clientId: string
  readonly clientSecret: string | null
  readonly projectId: string
  readonly authUri: string
  readonly tokenUri: string
}


interface GoogleTokenResponse {
  readonly access_token?: string
  readonly expires_in?: number
  readonly refresh_token?: string
  readonly scope?: string
  readonly token_type?: string

  readonly error?: string
  readonly error_description?: string
}


interface GoogleUserInfo {
  readonly sub?: string
  readonly name?: string
  readonly email?: string
  readonly email_verified?: boolean
}


export interface GoogleGeminiOAuthResult {
  /**
   * Serializado no formato entendido pelo GeminiProvider.
   *
   * Este valor deve ir para o CredentialVault e nunca
   * para metadata, logs ou renderer.
   */
  readonly credential: string

  readonly projectId: string

  readonly identityLabel:
    string | null
}


export interface GoogleGeminiOAuthOptions {
  readonly clientConfigPath: string

  /**
   * É injetado pelo processo principal.
   *
   * Exemplo:
   *   (url) => shell.openExternal(url)
   *
   * Isso mantém este módulo independente do Electron
   * e facilita testes unitários.
   */
  readonly openExternal:
    (url: string) => Promise<unknown>

  readonly timeoutMs?: number
}


function base64Url(
  value: Buffer,
): string {
  return value
    .toString('base64')
    .replace(
      /\+/g,
      '-',
    )
    .replace(
      /\//g,
      '_',
    )
    .replace(
      /=+$/g,
      '',
    )
}


function createCodeVerifier():
  string {
  /*
   * RFC 7636:
   * 43 a 128 caracteres.
   *
   * 64 bytes aleatórios em base64url
   * produz alta entropia e fica dentro do limite.
   */
  return base64Url(
    randomBytes(64),
  )
}


function createCodeChallenge(
  verifier: string,
): string {
  return base64Url(
    createHash('sha256')
      .update(
        verifier,
        'ascii',
      )
      .digest(),
  )
}


async function loadDesktopClient(
  filePath: string,
): Promise<GoogleDesktopClient> {
  let parsed:
    GoogleDesktopClientFile

  try {
    parsed =
      JSON.parse(
        await readFile(
          filePath,
          'utf8',
        ),
      ) as GoogleDesktopClientFile
  } catch (error) {
    throw new Error(
      `Não foi possível carregar a configuração OAuth do Google em ${filePath}`,
      {
        cause:
          error,
      },
    )
  }

  const installed =
    parsed.installed

  if (
    !installed?.client_id
    || !installed.project_id
  ) {
    throw new Error(
      'O JSON OAuth do Google não é uma credencial válida do tipo Desktop app',
    )
  }

  return {
    clientId:
      installed.client_id,

    clientSecret:
      installed.client_secret
      ?? null,

    projectId:
      installed.project_id,

    authUri:
      GOOGLE_AUTH_URL,

    tokenUri:
      GOOGLE_TOKEN_URL,
  }
}


function callbackHtml(
  success: boolean,
): string {
  const title =
    success
      ? 'Conta Google conectada'
      : 'Não foi possível conectar'

  const message =
    success
      ? 'A autorização foi concluída. Você já pode fechar esta aba e voltar ao Coach.'
      : 'A autorização não foi concluída. Volte ao Coach para tentar novamente.'

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width,initial-scale=1"
  >
  <title>${title}</title>
  <style>
    :root {
      color-scheme: dark;
      font-family:
        Inter,
        system-ui,
        sans-serif;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #0d0e12;
      color: #eceef2;
    }

    main {
      width: min(520px, calc(100% - 48px));
      padding: 32px;
      border: 1px solid #292c35;
      border-radius: 20px;
      background: #111217;
      text-align: center;
    }

    h1 {
      margin: 0 0 12px;
      font-size: 22px;
    }

    p {
      margin: 0;
      color: #9297a3;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${message}</p>
  </main>
</body>
</html>`
}


function sendBrowserResponse(
  response:
    import('node:http').ServerResponse,

  success: boolean,
): void {
  const html =
    callbackHtml(success)

  response.writeHead(
    success
      ? 200
      : 400,
    {
      'Content-Type':
        'text/html; charset=utf-8',

      'Cache-Control':
        'no-store',

      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'",

      'X-Content-Type-Options':
        'nosniff',
    },
  )

  response.end(html)
}


async function exchangeCode(
  client: GoogleDesktopClient,

  code: string,

  codeVerifier: string,

  redirectUri: string,
): Promise<GoogleTokenResponse> {
  const body =
    new URLSearchParams({
      client_id:
        client.clientId,

      code,

      code_verifier:
        codeVerifier,

      grant_type:
        'authorization_code',

      redirect_uri:
        redirectUri,
    })

  if (
    client.clientSecret
  ) {
    body.set(
      'client_secret',
      client.clientSecret,
    )
  }

  const controller =
    new AbortController()

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      20_000,
    )

  try {
    const response =
      await fetch(
        client.tokenUri,
        {
          method:
            'POST',

          headers: {
            'Content-Type':
              'application/x-www-form-urlencoded',
          },

          body:
            body.toString(),

          signal:
            controller.signal,
        },
      )

    const result =
      await response.json() as
        GoogleTokenResponse

    if (
      !response.ok
      || !result.access_token
    ) {
      throw new Error(
        result.error_description
        ?? result.error
        ?? 'O Google recusou a troca do código OAuth',
      )
    }

    return result
  } finally {
    clearTimeout(timeout)
  }
}



async function fetchGoogleUserInfo(
  accessToken: string,
): Promise<GoogleUserInfo> {
  const controller =
    new AbortController()

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      20_000,
    )

  try {
    const response =
      await fetch(
        'https://openidconnect.googleapis.com/v1/userinfo',
        {
          headers: {
            Authorization:
              `Bearer ${accessToken}`,
          },

          signal:
            controller.signal,
        },
      )

    if (!response.ok) {
      throw new Error(
        `O Google não retornou o perfil da conta (${response.status})`,
      )
    }

    return (
      await response.json()
    ) as GoogleUserInfo
  } finally {
    clearTimeout(timeout)
  }
}

function waitForCallback(
  state: string,

  timeoutMs: number,
): {
  readonly server:
    ReturnType<typeof createServer>

  readonly callback:
    Promise<string>
} {
  let resolveCallback:
    ((code: string) => void)
    | null = null

  let rejectCallback:
    ((error: Error) => void)
    | null = null

  let settled =
    false

  const callback =
    new Promise<string>(
      (
        resolve,
        reject,
      ) => {
        resolveCallback =
          resolve

        rejectCallback =
          reject
      },
    )

  const server =
    createServer(
      (
        request,
        response,
      ) => {
        if (
          settled
        ) {
          response.writeHead(410)
          response.end()
          return
        }

        const url =
          new URL(
            request.url ?? '/',
            'http://127.0.0.1',
          )

        if (
          url.pathname !== '/'
        ) {
          response.writeHead(404)
          response.end()
          return
        }

        const returnedState =
          url.searchParams.get(
            'state',
          )

        const error =
          url.searchParams.get(
            'error',
          )

        const code =
          url.searchParams.get(
            'code',
          )

        if (
          returnedState
          !== state
        ) {
          settled = true

          sendBrowserResponse(
            response,
            false,
          )

          rejectCallback?.(
            new Error(
              'Estado OAuth inválido. A autorização foi descartada por segurança.',
            ),
          )

          return
        }

        if (error) {
          settled = true

          sendBrowserResponse(
            response,
            false,
          )

          rejectCallback?.(
            new Error(
              `Autorização Google cancelada ou recusada: ${error}`,
            ),
          )

          return
        }

        if (!code) {
          settled = true

          sendBrowserResponse(
            response,
            false,
          )

          rejectCallback?.(
            new Error(
              'O Google não retornou um código de autorização',
            ),
          )

          return
        }

        settled = true

        sendBrowserResponse(
          response,
          true,
        )

        resolveCallback?.(
          code,
        )
      },
    )

  const timer =
    setTimeout(
      () => {
        if (settled) {
          return
        }

        settled = true

        rejectCallback?.(
          new Error(
            'A autorização Google expirou antes de ser concluída',
          ),
        )

        server.close()
      },
      timeoutMs,
    )

  void callback.finally(
    () => {
      clearTimeout(timer)
    },
  )

  return {
    server,
    callback,
  }
}


async function listenLoopback(
  server:
    ReturnType<typeof createServer>,
): Promise<number> {
  await new Promise<void>(
    (
      resolve,
      reject,
    ) => {
      const onError =
        (error: Error) => {
          server.off(
            'listening',
            onListening,
          )

          reject(error)
        }

      const onListening =
        () => {
          server.off(
            'error',
            onError,
          )

          resolve()
        }

      server.once(
        'error',
        onError,
      )

      server.once(
        'listening',
        onListening,
      )

      server.listen(
        0,
        '127.0.0.1',
      )
    },
  )

  const address =
    server.address()

  if (
    !address
    || typeof address
      === 'string'
  ) {
    throw new Error(
      'Não foi possível determinar a porta local do OAuth',
    )
  }

  return (
    address as AddressInfo
  ).port
}


async function closeServer(
  server:
    ReturnType<typeof createServer>,
): Promise<void> {
  if (!server.listening) {
    return
  }

  await new Promise<void>(
    (resolve) => {
      server.close(
        () =>
          resolve(),
      )
    },
  )
}


export async function authorizeGoogleGeminiOAuth(
  options:
    GoogleGeminiOAuthOptions,
): Promise<GoogleGeminiOAuthResult> {
  const client =
    await loadDesktopClient(
      options.clientConfigPath,
    )

  const state =
    base64Url(
      randomBytes(32),
    )

  const codeVerifier =
    createCodeVerifier()

  const codeChallenge =
    createCodeChallenge(
      codeVerifier,
    )

  const {
    server,
    callback,
  } =
    waitForCallback(
      state,
      options.timeoutMs
      ?? DEFAULT_TIMEOUT_MS,
    )

  try {
    const port =
      await listenLoopback(
        server,
      )

    const redirectUri =
      `http://127.0.0.1:${port}`

    const authorizationUrl =
      new URL(
        client.authUri,
      )

    authorizationUrl.searchParams.set(
      'client_id',
      client.clientId,
    )

    authorizationUrl.searchParams.set(
      'redirect_uri',
      redirectUri,
    )

    authorizationUrl.searchParams.set(
      'response_type',
      'code',
    )

    authorizationUrl.searchParams.set(
      'scope',
      GEMINI_SCOPES.join(' '),
    )

    authorizationUrl.searchParams.set(
      'access_type',
      'offline',
    )

    /*
     * Garante que o Google devolva refresh_token
     * durante a conexão explícita realizada pelo usuário.
     */
    authorizationUrl.searchParams.set(
      'prompt',
      'consent',
    )

    authorizationUrl.searchParams.set(
      'state',
      state,
    )

    authorizationUrl.searchParams.set(
      'code_challenge',
      codeChallenge,
    )

    authorizationUrl.searchParams.set(
      'code_challenge_method',
      'S256',
    )

    await options.openExternal(
      authorizationUrl.toString(),
    )

    const code =
      await callback

    const token =
      await exchangeCode(
        client,
        code,
        codeVerifier,
        redirectUri,
      )

    const accessToken =
      token.access_token

    if (!accessToken) {
      throw new Error(
        'O Google não retornou um access token',
      )
    }

    const userInfo =
      await fetchGoogleUserInfo(
        accessToken,
      )

    if (
      !token.refresh_token
    ) {
      throw new Error(
        'O Google não retornou um refresh token. Autorize novamente a conta.',
      )
    }

    const expiresAt =
      Date.now()
      + Math.max(
          0,
          token.expires_in
          ?? 3600,
        )
        * 1000

    /*
     * Formato que GeminiProvider.parseCredential()
     * já entende.
     *
     * IMPORTANTE:
     * o resultado deste JSON deve ser persistido
     * exclusivamente no CredentialVault.
     */
    const credential =
      JSON.stringify({
        kind:
          'oauth',

        clientId:
          client.clientId,

        ...(client.clientSecret
          ? {
              clientSecret:
                client.clientSecret,
            }
          : {}),

        projectId:
          client.projectId,

        refreshToken:
          token.refresh_token,

        accessToken:
          token.access_token,

        expiresAt,
      })

    return {
      credential,

      projectId:
        client.projectId,

      identityLabel:
        userInfo.email
        ?? userInfo.name
        ?? null,
    }
  } finally {
    await closeServer(
      server,
    )
  }
}
