import type {
  ProviderAccountHealthSnapshot,
  ProviderRuntimeIssue,
} from '../../shared/contracts/provider-contract'
import type { AIProviderManager } from './ai-provider-manager'
import type { CredentialVault } from './credential-vault'
import type {
  ProviderConfiguration,
  ProviderConfigurationRepository,
} from './provider-configuration-repository'
import type {
  ProviderAccountSummary,
  ProviderStatus,
} from '../../shared/contracts/provider-contract'
import { MAX_PROVIDER_ACCOUNTS } from '../../shared/contracts/provider-account-contract'
import type { AIProvider } from './ai-provider'

export type ProviderHealth = {
  readonly connected: boolean
  readonly quota: 'unknown' | 'available' | 'exhausted'
}

const OPENAI_SECRET_REFERENCE = 'provider-openai-api-key'

function isQuotaError(
  error: unknown,
): boolean {
  return (
    error instanceof Error
    && 'code' in error
    && error.code === 'INSUFFICIENT_QUOTA'
  )
}

function failedHealth(
  error: unknown,
): ProviderHealth {
  return isQuotaError(error)
    ? {
        connected: true,
        quota: 'exhausted',
      }
    : {
        connected: false,
        quota: 'unknown',
      }
}

function healthRuntimeIssue(
  error: unknown,
): ProviderRuntimeIssue {
  const code =
    error instanceof Error
    && 'code' in error
    && typeof (
      error as Error & {
        code?: unknown
      }
    ).code === 'string'
      ? (
          error as Error & {
            code: string
          }
        ).code
      : null

  switch (code) {
    case 'INSUFFICIENT_QUOTA':
      return 'usage-limit'

    case 'MODEL_UNAVAILABLE':
      return 'model-unavailable'

    case 'INVALID_CREDENTIAL':
      return 'reauth-required'

    case 'ACCESS_RESTRICTED':
      return 'access-restricted'

    case 'RATE_LIMITED':
    case 'NETWORK_UNAVAILABLE':
    case 'REQUEST_TIMEOUT':
      return 'temporarily-unavailable'
  }

  if (
    error instanceof Error
    && /credential|token|unauthor/i
      .test(error.message)
  ) {
    return 'reauth-required'
  }

  return 'temporarily-unavailable'
}


export class ProviderConfigurationService {
  private operationQueue: Promise<void> =
    Promise.resolve()

  /**
   * Contas que existem somente enquanto o processo do Coach estiver aberto.
   *
   * Diferente da implementação anterior, podemos manter mais de uma
   * conta temporária registrada simultaneamente.
   */
  private readonly sessionAccounts =
    new Map<string, ProviderAccountSummary>()

  /**
   * Providers session-only permanecem somente em memória.
   *
   * Ao desativar uma conta, ela sai do AIProviderManager para não poder
   * ser usada nem por seleção nem por rotas, mas sua instância permanece
   * aqui para que possa ser habilitada novamente sem solicitar a
   * credencial outra vez.
   */
  private readonly sessionProviders =
    new Map<string, AIProvider>()
  private readonly sessionSecrets =
    new Map<string, string>()
  private readonly healthByAccount =
    new Map<string, ProviderHealth>()

  constructor(
    private readonly repository:
      ProviderConfigurationRepository,

    private readonly vault:
      CredentialVault,

    private readonly manager:
      AIProviderManager,

    private readonly createOpenAIProvider:
      (
        apiKey: string,
        model: string,
        reasoningEffort:
          'auto'
          | 'low'
          | 'medium'
          | 'high',
      ) => AIProvider,

    private readonly createCompatibleProvider:
      (
        connectorId:
          'openai-compatible'
          | 'omniroute',

        label: string,
        baseUrl: string,
        apiKey: string,
        model: string,
      ) => AIProvider,

    private readonly now: () => number =
      Date.now,
    private readonly createGitHubCopilotProvider?:
      (
        credential: string,
        model: string,
        reasoningEffort:
          'auto' | 'low' | 'medium' | 'high',
      ) => AIProvider,
  ) {}

  async initialize(): Promise<void> {
    await this.exclusive(async () => {
      /**
       * initialize() representa reconstrução da camada operacional.
       *
       * É aceitável limpar o manager aqui, porque depois todas as contas
       * utilizáveis são registradas novamente.
       *
       * O problema anterior era limpar o manager toda vez que o usuário
       * simplesmente selecionava outra conta.
       */
      this.manager.clear()
      this.sessionAccounts.clear()
      this.sessionProviders.clear()
      this.sessionSecrets.clear()
      this.healthByAccount.clear()

      const configurations =
        await this.repository.list()

      if (!this.vault.isAvailable()) {
        /*
         * As credenciais persistentes dependem do cofre seguro.
         * Sem ele, nenhuma conta artificial é criada.
         */
        return
      }

      await this.vault.removeOrphans(
        new Set(
          configurations.map(
            (item) =>
              item.secretReference,
          ),
        ),
      )

      await this.loadPersistedAccounts(
        configurations,
        false,
      )
    })
  }

  async getStatus(): Promise<ProviderStatus> {
    const operationalAccountId =
      this.manager.getActiveRegistrationId()

    const sessionAccount =
      operationalAccountId
        ? this.sessionAccounts.get(
            operationalAccountId,
          ) ?? null
        : null

    let configuration:
      ProviderConfiguration | null = null

    if (
      operationalAccountId
      && !sessionAccount
    ) {
      configuration =
        await this.repository.findById(
          operationalAccountId,
        )
    } else if (!operationalAccountId) {
      configuration =
        await this.repository.getActive()
    }

    const accountId =
      sessionAccount?.id
      ?? configuration?.id
      ?? operationalAccountId
      ?? null

    const activeProvider =
      this.manager.getActive()

    /*
     * A IA ativa pode perder conectividade enquanto o Coach
     * permanece aberto.
     *
     * Cada provider que suporta checkAvailability() define
     * seu próprio probe leve. Assim OmniRoute e os demais
     * providers compatíveis podem atualizar o estado
     * real de conectividade.
     */
    if (
      accountId
      && activeProvider?.checkAvailability
    ) {
      try {
        await activeProvider
          .checkAvailability()

        const previousHealth =
          this.healthByAccount.get(
            accountId,
          )

        this.healthByAccount.set(
          accountId,
          {
            connected: true,
            quota:
              previousHealth?.quota
              ?? 'unknown',
          },
        )
      } catch (error) {
        this.healthByAccount.set(
          accountId,
          failedHealth(error),
        )
      }
    }

    const healthKnown =
      accountId
        ? this.healthByAccount.has(
            accountId,
          )
        : false

    const health =
      accountId
        ? this.healthByAccount.get(
            accountId,
          ) ?? {
            connected: false,
            quota: 'unknown' as const,
          }
        : {
            connected: false,
            quota: 'unknown' as const,
          }

    const configured =
      Boolean(
        sessionAccount
        || configuration,
      )

    const connected =
      health.connected
      && Boolean(
        activeProvider,
      )

    return {
      configured,

      connected,

      connectionState:
        configured
          ? healthKnown
            ? health.connected
              ? 'connected'
              : 'unreachable'
            : activeProvider
              ? 'unchecked'
              : 'unreachable'
          : 'not-configured',

      quota:
        health.quota,

      providerId:
        sessionAccount?.providerId
        ?? configuration?.providerId
        ?? null,

      providerName:
        sessionAccount?.providerName
        ?? configuration?.displayName
        ?? null,

      model:
        sessionAccount?.model
        ?? configuration?.model
        ?? null,

      secureStorageAvailable:
        this.vault.isAvailable(),

      activeAccountId:
        accountId,

      sessionOnly:
        Boolean(
          sessionAccount,
        ),
    }
  }

  async listAccounts():
    Promise<ProviderAccountSummary[]> {
    const operationalAccountId =
      this.manager.getActiveRegistrationId()

    const persisted =
      (
        await this.repository.list()
      ).map(
        (configuration) => ({
          id:
            configuration.id,

          providerId:
            configuration.providerId,

          providerName:
            configuration.displayName,

          label:
            configuration.label,

          model:
            configuration.model,

          reasoningEffort:
            configuration.reasoningEffort
            ?? 'auto',

          identityLabel:
            configuration.identityLabel
            ?? null,

          isEnabled:
            configuration.isEnabled
            !== false,

          isActive:
            configuration.id
            === operationalAccountId,

          sessionOnly:
            false,

          baseUrl:
            configuration.baseUrl,
        }),
      )

    const session =
      [
        ...this.sessionAccounts.values(),
      ].map(
        (account) => ({
          ...account,

          isActive:
            account.id
            === operationalAccountId,
        }),
      )

    return [
      ...session,
      ...persisted,
    ]
  }

  async refreshHealth():
    Promise<
      ProviderAccountHealthSnapshot[]
    > {
    const accounts =
      await this.listAccounts()

    const snapshots:
      ProviderAccountHealthSnapshot[] = []

    for (const account of accounts) {
      const checkedAt =
        this.now()

      if (!account.isEnabled) {
        snapshots.push({
          accountId:
            account.id,

          checkedAt,

          connectionState:
            'unchecked',

          runtimeIssue:
            null,
        })

        continue
      }

      try {
        /*
         * listAvailableModels() já recria/resolve o provider
         * correto para a conta sem mudar a seleção ativa.
         *
         * Além de confirmar conectividade/autenticação,
         * permite detectar um modelo que saiu do catálogo.
         */
        const models =
          await this.listAvailableModels(
            account.id,
          )

        const previousHealth =
          this.healthByAccount.get(
            account.id,
          )

        this.healthByAccount.set(
          account.id,
          {
            connected: true,

            /*
             * Catálogo disponível NÃO prova quota de geração.
             * Portanto nunca promovemos quota para "available"
             * aqui.
             */
            quota:
              previousHealth?.quota
              ?? 'unknown',
          },
        )

        snapshots.push({
          accountId:
            account.id,

          checkedAt,

          connectionState:
            'connected',

          runtimeIssue:
            !account.model.trim()
            || models.includes(
              account.model,
            )
              ? null
              : 'model-unavailable',
        })
      } catch (error) {
        const failed =
          failedHealth(error)

        this.healthByAccount.set(
          account.id,
          failed,
        )

        snapshots.push({
          accountId:
            account.id,

          checkedAt,

          connectionState:
            failed.connected
              ? 'connected'
              : 'unreachable',

          runtimeIssue:
            healthRuntimeIssue(
              error,
            ),
        })
      }
    }

    return snapshots
  }


  async checkActiveFunctionalHealth():
    Promise<
      ProviderAccountHealthSnapshot | null
    > {
    const accountId =
      this.manager.getActiveRegistrationId()

    const provider =
      this.manager.getActive()

    if (
      !accountId
      || !provider
    ) {
      return null
    }

    const account =
      (
        await this.listAccounts()
      ).find(
        (item) =>
          item.id === accountId,
      )

    if (
      !account
      || !account.isEnabled
    ) {
      return null
    }

    const checkedAt =
      this.now()

    if (!account.model.trim()) {
      const previous =
        this.healthByAccount.get(
          accountId,
        )

      return {
        accountId,
        checkedAt,

        connectionState:
          previous?.connected
            ? 'connected'
            : 'unchecked',

        runtimeIssue:
          'model-unavailable',
      }
    }

    try {
      /*
       * Heartbeat funcional do Coach:
       *
       * o modelo precisa gerar uma estrutura semelhante
       * à usada pelo Organizador, não apenas qualquer JSON.
       */
      const controller =
        new AbortController()

      const functionalTimeoutMs =
        account.providerId
          === 'github-copilot'
          ? 20_000
          : 6_000

      const timeout =
        setTimeout(
          () =>
            controller.abort(),
          functionalTimeoutMs,
        )

      const response =
        await (async () => {
          try {
            return await provider.sendMessage({
              messages: [
                {
                  role:
                    'system',

                  content:
                    'Internal Coach functional health check. Return ONLY this strict JSON object: {"mode":"conversation","capability":null,"entities":{"subject":null,"query":null,"eventKind":null,"dateExpression":null,"dateFromExpression":null,"dateToExpression":null,"weekday":null,"minutes":null,"completed":null,"target":null,"status":null},"confidence":1,"missingFields":[],"summary":"Coach functional health check"}. No markdown, prose, comments or extra keys.',
                },
                {
                  role:
                    'user',

                  content:
                    'Return the required OrganizerIntent-compatible JSON now.',
                },
              ],

              model:
                account.model,

              maxOutputTokens:
                400,

              signal:
                controller.signal,

              responseFormat:
                'json_object',
            })
          } finally {
            clearTimeout(
              timeout,
            )
          }
        })()

      let parsed:
        unknown = null

      try {
        parsed =
          JSON.parse(
            response.content,
          )
      } catch {
        parsed = null
      }

      const isRecord = (
        value: unknown,
      ): value is Record<
        string,
        unknown
      > =>
        Boolean(
          value
          && typeof value
            === 'object'
          && !Array.isArray(
            value,
          ),
        )

      const entities =
        isRecord(parsed)
        && isRecord(
          parsed.entities,
        )
          ? parsed.entities
          : null

      const requiredNullEntities = [
        'subject',
        'query',
        'eventKind',
        'dateExpression',
        'dateFromExpression',
        'dateToExpression',
        'weekday',
        'minutes',
        'completed',
        'target',
        'status',
      ] as const

      const entitiesValid =
        entities !== null
        && requiredNullEntities.every(
          (key) =>
            key in entities
            && entities[key] === null,
        )

      const valid =
        isRecord(parsed)
        && parsed.mode
          === 'conversation'
        && parsed.capability
          === null
        && entitiesValid
        && typeof parsed.confidence
          === 'number'
        && parsed.confidence >= 0
        && parsed.confidence <= 1
        && Array.isArray(
          parsed.missingFields,
        )
        && parsed.missingFields.length
          === 0
        && typeof parsed.summary
          === 'string'
        && parsed.summary.trim().length
          > 0

      if (!valid) {
        console.error(
          '[Coach AI functional health] invalid response',
          {
            providerId:
              account.providerId,
            model:
              account.model,
            content:
              response.content.slice(
                0,
                1200,
              ),
          },
        )

        const previous =
          this.healthByAccount.get(
            accountId,
          )

        this.healthByAccount.set(
          accountId,
          {
            connected:
              true,

            quota:
              previous?.quota
              ?? 'unknown',
          },
        )

        return {
          accountId,
          checkedAt,

          connectionState:
            'connected',

          runtimeIssue:
            'temporarily-unavailable',
        }
      }

      this.healthByAccount.set(
        accountId,
        {
          connected:
            true,

          quota:
            'available',
        },
      )

      return {
        accountId,
        checkedAt,

        connectionState:
          'connected',

        runtimeIssue:
          'available',
      }
    } catch (error) {
      console.error(
        '[Coach AI functional health] generation failed',
        {
          providerId:
            account.providerId,
          model:
            account.model,
          error:
            error instanceof Error
              ? {
                  name:
                    error.name,
                  message:
                    error.message,
                  code:
                    'code' in error
                    ? (
                        error as Error & {
                          code?: unknown
                        }
                      ).code
                    : undefined,
                }
              : String(error),
        },
      )

      const generationIssue =
        error instanceof Error
        && error.name === 'AbortError'
          ? 'temporarily-unavailable'
          : healthRuntimeIssue(
              error,
            )

      /*
       * Se a geração falhar, usamos o probe leve
       * somente para diferenciar:
       *
       * - serviço inacessível;
       * - serviço vivo, mas geração/modelo com problema.
       */
      if (
        provider.checkAvailability
      ) {
        try {
          await provider
            .checkAvailability()

          const previous =
            this.healthByAccount.get(
              accountId,
            )

          this.healthByAccount.set(
            accountId,
            {
              connected:
                true,

              quota:
                generationIssue
                  === 'usage-limit'
                  ? 'exhausted'
                  : previous?.quota
                    ?? 'unknown',
            },
          )

          return {
            accountId,
            checkedAt,

            connectionState:
              'connected',

            runtimeIssue:
              generationIssue,
          }
        } catch (probeError) {
          const failed =
            failedHealth(
              probeError,
            )

          this.healthByAccount.set(
            accountId,
            failed,
          )

          return {
            accountId,
            checkedAt,

            connectionState:
              failed.connected
                ? 'connected'
                : 'unreachable',

            runtimeIssue:
              healthRuntimeIssue(
                probeError,
              ),
          }
        }
      }

      const failed =
        failedHealth(
          error,
        )

      this.healthByAccount.set(
        accountId,
        failed,
      )

      return {
        accountId,
        checkedAt,

        connectionState:
          failed.connected
            ? 'connected'
            : 'unreachable',

        runtimeIssue:
          generationIssue,
      }
    }
  }


  async configureOpenAI(
    label: string,
    apiKey: string,
    model: string,
    persistence:
      | 'secure-vault'
      | 'session',
  ): Promise<ProviderStatus> {
    return this.exclusive(
      async () => {
        await this.assertCanCreateAccount()

        return this.configureOpenAIExclusive(
          label,
          apiKey,
          model,
          persistence,
        )
      },
    )
  }

  private async configureOpenAIExclusive(
    label: string,
    apiKey: string,
    model: string,
    persistence:
      | 'secure-vault'
      | 'session',
  ): Promise<ProviderStatus> {
    if (
      persistence === 'secure-vault'
      && !this.vault.isAvailable()
    ) {
      throw new Error(
        'Secure operating-system credential storage is unavailable',
      )
    }

    const provider =
      this.createOpenAIProvider(
        apiKey,
        model,
        'auto',
      )

    const health =
      await this.verifyConnection(
        provider,
      )

    const accountId =
      crypto.randomUUID()

    this.healthByAccount.set(
      accountId,
      health,
    )

    if (
      persistence === 'session'
    ) {
      const account:
        ProviderAccountSummary = {
        id:
          accountId,

        providerId:
          'openai',

        providerName:
          'OpenAI',

        label,

        model,

        reasoningEffort:
          'auto',

        identityLabel:
          null,

        isEnabled:
          true,

        isActive:
          true,

        sessionOnly:
          true,

        baseUrl:
          null,
      }


      this.sessionAccounts.set(
        accountId,
        account,
      )

      this.sessionProviders.set(
        accountId,
        provider,
      )
      this.sessionSecrets.set(
        accountId,
        apiKey,
      )
      this.registerAndSelect(
        accountId,
        provider,
      )

      return this.getStatus()
    }

    const secretReference =
      `${OPENAI_SECRET_REFERENCE}-${accountId}`

    await this.vault.set(
      secretReference,
      apiKey,
    )

    const now =
      this.now()

    try {
      await this.repository.createAndActivate({
        id:
          accountId,

        providerId:
          'openai',

        displayName:
          'OpenAI',

        label,

        authKind:
          'api-key',

        identityLabel:
          null,

        baseUrl:
          null,

        model,

        reasoningEffort:
          'auto',

        secretReference,

        isEnabled:
          true,

        isActive:
          true,

        createdAt:
          now,

        updatedAt:
          now,
      })
    } catch (error) {
      try {
        await this.vault.delete(
          secretReference,
        )
      } catch {
        throw new Error(
          'Provider setup failed; encrypted orphan cleanup will retry at next startup',
          {
            cause: error,
          },
        )
      }

      throw error
    }


    this.registerAndSelect(
      accountId,
      provider,
    )

    return this.getStatus()
  }

  async configureCompatible(
    connectorId:
      | 'openai-compatible'
      | 'omniroute',

    label: string,
    baseUrl: string,
    apiKey: string,
    model: string,
    persistence:
      | 'secure-vault'
      | 'session',
  ): Promise<ProviderStatus> {
    return this.exclusive(
      async () => {
        await this.assertCanCreateAccount()

        if (
          persistence === 'secure-vault'
          && !this.vault.isAvailable()
        ) {
          throw new Error(
            'Secure operating-system credential storage is unavailable',
          )
        }

        const configuredModel =
          model.trim()

        const provider =
          this.createCompatibleProvider(
            connectorId,
            label,
            baseUrl,
            apiKey,
            configuredModel,
          )

        const health =
          await this.verifyConnection(
            provider,
          )

        /*
         * A autenticação/conectividade já foi
         * confirmada.
         *
         * No OmniRoute, a escolha de modelo acontece
         * somente depois de consultar o catálogo real.
         *
         * Se houver pelo menos um modelo, usamos o
         * primeiro retornado pelo OmniRoute.
         *
         * Se o catálogo estiver vazio, a conta continua
         * conectada com model = "", representando
         * corretamente o estado "Sem modelo".
         */
        let selectedModel =
          configuredModel

        if (
          provider.listModels
        ) {
          const availableModels =
            await provider.listModels()

          selectedModel =
            configuredModel
            || availableModels[0]
            || ''
        }

        /*
         * O primeiro provider foi criado sem modelo para
         * validar autenticação e consultar /models.
         *
         * Se a descoberta escolheu um modelo, precisamos
         * registrar uma nova instância com esse modelo como
         * default. Caso contrário, a conta mostraria o modelo
         * correto na UI, mas o runtime continuaria sem modelo.
         */
        const operationalProvider =
          selectedModel === configuredModel
            ? provider
            : this.createCompatibleProvider(
                connectorId,
                label,
                baseUrl,
                apiKey,
                selectedModel,
              )

        const accountId =
          crypto.randomUUID()

        this.healthByAccount.set(
          accountId,
          health,
        )

        if (
          persistence === 'session'
        ) {
          const account:
            ProviderAccountSummary = {
            id:
              accountId,

            providerId:
              connectorId,

            providerName:
              label,

            label,

            model:
              selectedModel,

            reasoningEffort:
              'auto',

            identityLabel:
              null,

            isEnabled:
              true,

            isActive:
              true,

            sessionOnly:
              true,

            baseUrl,
          }


          this.sessionAccounts.set(
            accountId,
            account,
          )

          this.sessionProviders.set(
            accountId,
            operationalProvider,
          )
          this.sessionSecrets.set(
            accountId,
            apiKey,
          )

          this.registerAndSelect(
            accountId,
            operationalProvider,
          )

          return this.getStatus()
        }

        const secretReference =
          `provider-compatible-api-key-${accountId}`

        await this.vault.set(
          secretReference,
          apiKey,
        )

        try {
          const now =
            this.now()

          await this.repository.createAndActivate({
            id:
              accountId,

            providerId:
              connectorId,

            displayName:
              label,

            label,

            authKind:
              'endpoint-token',

            identityLabel:
              null,

            baseUrl,

            model:
              selectedModel,

            reasoningEffort:
              'auto',

            secretReference,

            isEnabled:
              true,

            isActive:
              true,

            createdAt:
              now,

            updatedAt:
              now,
          })
        } catch (error) {
          await this.vault
            .delete(
              secretReference,
            )
            .catch(
              () => {},
            )

          throw error
        }


        this.registerAndSelect(
          accountId,
          operationalProvider,
        )

        return this.getStatus()
      },
    )
  }


  async configureGitHubCopilotOAuth(
    credential: string,
    identityLabel: string | null,
    identityKey: string,
    targetAccountId: string | null = null,
  ): Promise<ProviderStatus> {
    return this.exclusive(async () => {
      if (!this.vault.isAvailable()) {
        throw new Error(
          'Secure operating-system credential storage is unavailable',
        )
      }

      if (!this.createGitHubCopilotProvider) {
        throw new Error(
          'GitHub Copilot provider connector is unavailable',
        )
      }

      const probe =
        this.createGitHubCopilotProvider(
          credential,
          '',
          'auto',
        )

      if (!probe.listModels) {
        throw new Error(
          'GitHub Copilot model discovery is unavailable',
        )
      }

      const availableModels =
        await probe.listModels()

      const matched =
        await this.repository.findByIdentity(
          'github-copilot',
          identityKey,
        )

      const target =
        targetAccountId
          ? await this.repository.findById(
              targetAccountId,
            )
          : matched

      const historicalDuplicate =
        Boolean(
          targetAccountId
          && !target?.identityKey
          && matched
          && matched.id !== targetAccountId,
        )

      if (
        targetAccountId
        && (
          !target
          || target.providerId
            !== 'github-copilot'
        )
      ) {
        throw new Error(
          'Provider account not found',
        )
      }

      if (
        target?.identityKey
        && target.identityKey
          !== identityKey
        && !historicalDuplicate
      ) {
        throw Object.assign(
          new Error(
            'GitHub identity does not match the selected account',
          ),
          { code: 'INVALID_CREDENTIAL' },
        )
      }

      if (!target) {
        await this.assertCanCreateAccount()
      }

      const model =
        target?.model
        && availableModels.includes(
          target.model,
        )
          ? target.model
          : availableModels[0]

      if (!model) {
        throw new Error(
          'No GitHub Copilot generation model is available',
        )
      }

      const provider =
        this.createGitHubCopilotProvider(
          credential,
          model,
          target?.reasoningEffort
          ?? 'auto',
        )

      const accountId =
        target?.id
        ?? crypto.randomUUID()

      this.healthByAccount.set(
        accountId,
        {
          connected: true,
          quota: 'unknown',
        },
      )

      const secretReference =
        target?.secretReference
        ?? `provider-github-copilot-oauth-${accountId}`

      const previousCredential =
        target
          ? await this.vault.get(
              secretReference,
            )
          : null

      await this.vault.set(
        secretReference,
        credential,
      )

      try {
        const now =
          this.now()

        if (target) {
          const duplicate =
            historicalDuplicate
            && matched
              ? matched
              : null

          const updated = duplicate
            ? await this.repository
                .mergeOAuthIdentity(
                  target.id,
                  duplicate.id,
                  identityKey,
                  identityLabel,
                  model,
                  now,
                )
            : await this.repository
                .updateOAuthIdentity(
                  target.id,
                  identityKey,
                  identityLabel,
                  model,
                  now,
                )

          if (!updated) {
            throw new Error(
              'Provider account not found',
            )
          }

          if (duplicate) {
            this.manager.remove(duplicate.id)
            this.healthByAccount.delete(duplicate.id)
            await this.vault
              .delete(duplicate.secretReference)
              .catch(() => {})
          }
        } else {
          await this.repository.createAndActivate({
            id: accountId,
            providerId: 'github-copilot',
            displayName: 'GitHub Copilot',
            label: 'GitHub Copilot',
            authKind: 'oauth',
            identityLabel,
            identityKey,
            baseUrl: null,
            model,
            reasoningEffort: 'auto',
            secretReference,
            isEnabled: true,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          })
        }
      } catch (error) {
        if (target && previousCredential !== null) {
          await this.vault
            .set(
              secretReference,
              previousCredential,
            )
            .catch(() => {})
        } else {
          await this.vault
            .delete(secretReference)
            .catch(() => {})
        }

        this.healthByAccount.delete(
          accountId,
        )

        throw error
      }

      if (target) {
        if (target.isEnabled !== false) {
          this.manager.replace(provider, accountId)
        }

        if (target.isActive) {
          this.manager.select(accountId)
          this.manager.notifyAvailable()
        }
      } else {
        this.registerAndSelect(
          accountId,
          provider,
        )
      }

      return this.getStatus()
    })
  }


  async selectAccount(
    accountId: string,
  ): Promise<ProviderStatus> {
    return this.exclusive(
      () =>
        this.selectAccountExclusive(
          accountId,
          false,
        ),
    )
  }

  private async selectAccountExclusive(
    accountId: string,
    testConnection: boolean,
  ): Promise<ProviderStatus> {
    const sessionAccount =
      this.sessionAccounts.get(
        accountId,
      )

    if (sessionAccount) {
      if (
        sessionAccount.isEnabled
        === false
      ) {
        throw new Error(
          'Provider account is disabled',
        )
      }

      const provider =
        this.sessionProviders.get(
          accountId,
        )

      if (!provider) {
        throw new Error(
          'Provider session connection not found',
        )
      }

      this.manager.replace(
        provider,
        accountId,
      )

      this.manager.select(
        accountId,
      )

      return this.getStatus()
    }

    if (!this.vault.isAvailable()) {
      throw new Error(
        'Secure operating-system credential storage is unavailable',
      )
    }

    const configuration =
      await this.repository.findById(
        accountId,
      )

    if (!configuration) {
      throw new Error(
        'Provider account not found',
      )
    }

    if (
      configuration.isEnabled
      === false
    ) {
      throw new Error(
        'Provider account is disabled',
      )
    }

    const apiKey =
      await this.vault.get(
        configuration.secretReference,
      )

    if (
      apiKey === null
      || (
        configuration.providerId
          !== 'openai-compatible'
        && !apiKey
      )
    ) {
      throw new Error(
        'Provider credential not found',
      )
    }

    const provider =
      this.createProviderForConfiguration(
        configuration,
        apiKey,
      )

    if (testConnection) {
      try {
        this.healthByAccount.set(
          accountId,
          await this.verifyConnection(
            provider,
          ),
        )
      } catch (error) {
        this.healthByAccount.set(
          accountId,
          failedHealth(error),
        )

        throw error
      }
    }

    await this.repository.activate(
      accountId,
      this.now(),
    )


    this.manager.replace(
      provider,
      accountId,
    )

    this.manager.select(
      accountId,
    )

    return this.getStatus()
  }

  async setAccountEnabled(
    accountId: string,
    enabled: boolean,
  ): Promise<ProviderStatus> {
    return this.exclusive(
      async () => {
        const sessionAccount =
          this.sessionAccounts.get(
            accountId,
          )

        if (sessionAccount) {
          const updated = {
            ...sessionAccount,
            isEnabled:
              enabled,
          }

          this.sessionAccounts.set(
            accountId,
            updated,
          )

          if (!enabled) {
            const wasActive =
              this.manager
                .getActiveRegistrationId()
              === accountId

            /*
             * Remove da camada operacional para garantir que uma conta
             * desativada não seja usada nem pela seleção principal nem
             * por uma rota específica.
             *
             * A instância continua em sessionProviders.
             */
            this.manager.remove(
              accountId,
            )

            if (wasActive) {
              /*
               * Desativar a conta é uma operação local.
               * A tentativa de escolher outra conta é best-effort:
               * falha de rede de outro provider não pode desfazer
               * nem transformar a desativação em erro.
               */
              await this.ensureActiveProvider(
                false,
              ).catch(() => {})
            }

            return this.getStatus()
          }

          const provider =
            this.sessionProviders.get(
              accountId,
            )

          if (!provider) {
            throw new Error(
              'Provider session connection not found',
            )
          }

          /*
           * Habilitar torna a conta utilizável novamente, mas não a
           * transforma automaticamente na conta principal.
           */
          this.manager.replace(
            provider,
            accountId,
          )

          return this.getStatus()
        }

        if (enabled) {
          const existing =
            await this.repository.findById(
              accountId,
            )

          if (!existing) {
            throw new Error(
              'Provider account not found',
            )
          }

          if (!this.vault.isAvailable()) {
            throw new Error(
              'Secure operating-system credential storage is unavailable',
            )
          }

          const secret =
            await this.vault.get(
              existing.secretReference,
            )

          if (
            secret === null
            || (
              existing.providerId
                !== 'openai-compatible'
              && !secret
            )
          ) {
            throw new Error(
              'Provider credential not found',
            )
          }

          const provider =
            this.createProviderForConfiguration(
              {
                ...existing,
                isEnabled: true,
              },
              secret,
            )

          const configuration =
            await this.repository.setEnabled(
              accountId,
              true,
              this.now(),
            )

          if (!configuration) {
            throw new Error(
              'Provider account not found',
            )
          }

          this.manager.replace(
            provider,
            accountId,
          )

          return this.getStatus()
        }

        const configuration =
          await this.repository.setEnabled(
            accountId,
            false,
            this.now(),
          )

        if (!configuration) {
          throw new Error(
            'Provider account not found',
          )
        }

        const wasActive =
          this.manager
            .getActiveRegistrationId()
          === accountId

        this.manager.remove(
          accountId,
        )

        this.healthByAccount.delete(
          accountId,
        )

        if (wasActive) {
          /*
           * A configuração já foi desativada no repositório.
           * Encontrar uma substituta não faz parte do sucesso
           * da operação de desativação.
           */
          await this.ensureActiveProvider(
            false,
          ).catch(() => {})
        }

        return this.getStatus()
      },
    )
  }

async listAvailableModels(
  accountId: string,
): Promise<readonly string[]> {
  const sessionAccount =
    this.sessionAccounts.get(
      accountId,
    )

  if (sessionAccount) {
    const provider =
      this.sessionProviders.get(
        accountId,
      )

    if (!provider) {
      throw new Error(
        'Provider session connection not found',
      )
    }

    if (!provider.listModels) {
      throw new Error(
        'Provider does not support model discovery',
      )
    }

    return provider.listModels()
  }

  const configuration =
    await this.repository.findById(
      accountId,
    )

  if (!configuration) {
    throw new Error(
      'Provider account not found',
    )
  }

  if (!this.vault.isAvailable()) {
    throw new Error(
      'Secure operating-system credential storage is unavailable',
    )
  }

  const secret =
    await this.vault.get(
      configuration.secretReference,
    )

  if (
    secret === null
    || (
      configuration.providerId
        !== 'openai-compatible'
      && !secret
    )
  ) {
    throw new Error(
      'Provider credential not found',
    )
  }

  const provider =
    this.createProviderForConfiguration(
      configuration,
      secret,
    )

  if (!provider.listModels) {
    throw new Error(
      'Provider does not support model discovery',
    )
  }

  return provider.listModels()
}

async updateAccount(
  accountId: string,
  label: string,
  identityLabel: string | null | undefined,
  model: string,
  reasoningEffort:
    'auto'
    | 'low'
    | 'medium'
    | 'high',
): Promise<ProviderStatus> {
    return this.exclusive(
      async () => {
        const normalizedLabel =
          label.trim()

        if (
          normalizedLabel.length < 1
          || normalizedLabel.length > 60
        ) {
          throw new Error(
            'Invalid provider account label',
          )
        }
        const normalizedModel =
          model.trim()

        if (
          normalizedModel.length < 1
          || normalizedModel.length > 150
        ) {
          throw new Error(
            'Invalid provider account model',
          )
        }

        if (
          reasoningEffort !== 'auto'
          && reasoningEffort !== 'low'
          && reasoningEffort !== 'medium'
          && reasoningEffort !== 'high'
        ) {
          throw new Error(
            'Invalid provider reasoning effort',
          )
        }
        const normalizedIdentity =
          identityLabel === undefined
            ? undefined
            : identityLabel === null
              ? null
              : identityLabel.trim()

        if (
          normalizedIdentity !== undefined
          && normalizedIdentity !== null
          && (
            normalizedIdentity.length < 1
            || normalizedIdentity.length > 120
          )
        ) {
          throw new Error(
            'Invalid provider account identity label',
          )
        }

        const sessionAccount =
          this.sessionAccounts.get(
            accountId,
          )

        if (sessionAccount) {
          const secret =
            this.sessionSecrets.get(
              accountId,
            )

          if (
            secret === undefined
            || (
              sessionAccount.providerId
                !== 'openai-compatible'
              && !secret
            )
          ) {
            throw new Error(
              'Provider session credential not found',
            )
          }

          let provider: AIProvider

          switch (sessionAccount.providerId) {
            case 'openai':
              provider =
                this.createOpenAIProvider(
                  secret,
                  normalizedModel,
                  reasoningEffort,
                )
              break

            case 'openai-compatible':
            case 'omniroute':
              provider =
                this.createCompatibleProvider(
                  sessionAccount.providerId,
                  normalizedLabel,
                  sessionAccount.baseUrl
                    ?? '',
                  secret,
                  normalizedModel,
                )
              break


            case 'github-copilot':
              if (!this.createGitHubCopilotProvider) {
                throw new Error(
                  'GitHub Copilot provider factory is not configured',
                )
              }

              provider =
                this.createGitHubCopilotProvider(
                  secret,
                  normalizedModel,
                  reasoningEffort,
                )
              break


            case 'anthropic':


            case 'ollama':


              throw new Error(


                `Provider connector '${sessionAccount.providerId}' is not implemented yet`,


              )

          }

          const updatedSessionAccount:
            ProviderAccountSummary = {
              ...sessionAccount,

              label:
                normalizedLabel,

              model:
                normalizedModel,

              reasoningEffort,

              identityLabel:
                normalizedIdentity
                ?? sessionAccount.identityLabel
                ?? null,
            }

          this.sessionAccounts.set(
            accountId,
            updatedSessionAccount,
          )

          this.sessionProviders.set(
            accountId,
            provider,
          )

          if (
            updatedSessionAccount.isEnabled
            !== false
          ) {
            this.manager.replace(
              provider,
              accountId,
            )
          }

          this.healthByAccount.delete(
            accountId,
          )

          return this.getStatus()
        }

        const existing =
          await this.repository.findById(
            accountId,
          )

        if (!existing) {
          throw new Error(
            'Provider account not found',
          )
        }
        if (!this.vault.isAvailable()) {
          throw new Error(
            'Secure operating-system credential storage is unavailable',
          )
        }

        const secret =
          await this.vault.get(
            existing.secretReference,
          )

        if (
          secret === null
          || (
            existing.providerId
              !== 'openai-compatible'
            && !secret
          )
        ) {
          throw new Error(
            'Provider credential not found',
          )
        }

        const updated =
          await this.repository.update(
            accountId,
            {
              label:
                normalizedLabel,
              model:
                normalizedModel,

              reasoningEffort,
              ...(normalizedIdentity
                !== undefined
                ? {
                    identityLabel:
                      normalizedIdentity,
                  }
                : {}),

              updatedAt:
                this.now(),
            },
          )

        if (!updated) {
          throw new Error(
            'Provider account not found',
          )
        }
        const provider =
          this.createProviderForConfiguration(
            updated,
            secret,
          )

        if (
          updated.isEnabled
          !== false
        ) {
          this.manager.replace(
            provider,
            accountId,
          )
        }

        this.healthByAccount.delete(
          accountId,
        )
        return this.getStatus()
      },
    )
  }

  async removeAccount(
    accountId: string,
  ): Promise<ProviderStatus> {
    return this.exclusive(
      () =>
        this.removeAccountExclusive(
          accountId,
        ),
    )
  }

  private async removeAccountExclusive(
    accountId: string,
  ): Promise<ProviderStatus> {
    const sessionAccount =
      this.sessionAccounts.get(
        accountId,
      )

    if (sessionAccount) {
      const wasActive =
        this.manager
          .getActiveRegistrationId()
        === accountId

      this.manager.remove(
        accountId,
      )

      this.sessionAccounts.delete(
        accountId,
      )

      this.sessionProviders.delete(
        accountId,
      )
      this.sessionSecrets.delete(
        accountId,
      )

      this.healthByAccount.delete(
        accountId,
      )

      if (wasActive) {
        await this.ensureActiveProvider(
          false,
        ).catch(() => {})
      }

      return this.getStatus()
    }

    const configuration =
      await this.repository.findById(
        accountId,
      )

    if (!configuration) {
      return this.getStatus()
    }

    const wasActive =
      this.manager
        .getActiveRegistrationId()
        === accountId

      || configuration.isActive

    /**
     * Mantemos este comportamento propositalmente:
     *
     * se a conta estava ativa, ela sai do manager antes da exclusão da
     * credencial.
     *
     * Isso evita que uma conta continue operacional caso a exclusão
     * segura da credencial falhe.
     */
    this.manager.remove(
      accountId,
    )

    this.healthByAccount.delete(
      accountId,
    )

    await this.repository.remove(
      accountId,
    )

    /*
     * Remove metadata first. A vault failure may leave an orphaned secret,
     * which startup cleanup can safely collect; the inverse would leave a
     * live account pointing at a credential that no longer exists.
     */
    await this.vault.delete(
      configuration.secretReference,
    )

    if (wasActive) {
      await this.ensureActiveProvider(
        false,
      ).catch(() => {})
    }

    return this.getStatus()
  }

  private async loadPersistedAccounts(
    configurations:
      readonly ProviderConfiguration[],

    testConnection: boolean,
  ): Promise<boolean> {
    let firstUsable:
      ProviderConfiguration | null = null

    let activeUsable:
      ProviderConfiguration | null = null

    for (
      const configuration
      of configurations
    ) {
      if (
        configuration.isEnabled
        === false
      ) {
        continue
      }

      try {
        const apiKey =
          await this.vault.get(
            configuration.secretReference,
          )

        if (
          apiKey === null
          || (
            configuration.providerId
              !== 'openai-compatible'
            && !apiKey
          )
        ) {
          continue
        }

        const provider =
          this.createProviderForConfiguration(
            configuration,
            apiKey,
          )

        if (testConnection) {
          this.healthByAccount.set(
            configuration.id,
            await this.verifyConnection(
              provider,
            ),
          )
        }

        this.manager.replace(
          provider,
          configuration.id,
        )

        firstUsable ??=
          configuration

        if (
          configuration.isActive
        ) {
          activeUsable =
            configuration
        }
      } catch (error) {
        this.healthByAccount.set(
          configuration.id,
          failedHealth(error),
        )
      }
    }

    const selected =
      activeUsable
      ?? firstUsable

    if (!selected) {
      return false
    }

    if (!selected.isActive) {
      await this.repository.activate(
        selected.id,
        this.now(),
      )
    }

    this.manager.select(
      selected.id,
    )

    return true
  }

  private async ensureActiveProvider(
    testConnection: boolean,
  ): Promise<void> {
    if (
      this.manager.getActive()
    ) {
      return
    }

    const configurations =
      await this.repository.list()

    if (
      this.vault.isAvailable()
      && await this.loadPersistedAccounts(
        configurations,
        testConnection,
      )
    ) {
      return
    }

    for (
      const account
      of this.sessionAccounts.values()
    ) {
      if (
        account.isEnabled
        === false
      ) {
        continue
      }

      try {
        this.manager.select(
          account.id,
        )

        return
      } catch {
        // Continua procurando uma conta operacional.
      }
    }

    /*
     * Não criamos mais um OmniRoute implícito quando nenhuma conta
     * configurada está disponível.
     *
     * A Central de IA tornou a conexão uma decisão explícita do usuário.
     * Se nenhuma conta puder ser selecionada, o Coach permanece sem um
     * provider ativo até que uma conta seja conectada ou escolhida.
     */
  }

  private createProviderForConfiguration(
    configuration:
      ProviderConfiguration,

    secret: string,
  ): AIProvider {
    switch (
      configuration.providerId
    ) {
      case 'openai':
        return this.createOpenAIProvider(
          secret,
          configuration.model,
          configuration.reasoningEffort
            ?? 'auto',
        )

      case 'openai-compatible':
      case 'omniroute':
        return this.createCompatibleProvider(
          configuration.providerId,
          configuration.label,
          configuration.baseUrl
            ?? '',
          secret,
          configuration.model,
        )


      case 'github-copilot':
        if (!this.createGitHubCopilotProvider) {
          throw new Error(
            'GitHub Copilot provider factory is not configured',
          )
        }

        return this.createGitHubCopilotProvider(
          secret,
          configuration.model,
          configuration.reasoningEffort
            ?? 'auto',
        )


      case 'anthropic':


      case 'ollama':


        throw new Error(


          `Provider connector '${configuration.providerId}' is not implemented yet`,


        )

    }
  }

  private async verifyConnection(
    provider: AIProvider,
  ): Promise<ProviderHealth> {
    /*
     * Conectividade e quota são conceitos diferentes.
     *
     * A conexão deve validar somente se o provider está acessível
     * e autenticado. Nunca devemos consumir geração apenas para
     * permitir que uma conta seja adicionada ao Coach.
     *
     * Um modelo sem quota não torna o provider inteiro inválido:
     * o usuário ainda pode trocar para outro modelo disponível.
     */
    if (provider.checkAvailability) {
      await provider.checkAvailability()
    } else {
      await provider.testConnection()
    }

    return {
      connected: true,
      quota: 'unknown',
    }
  }

  private async assertCanCreateAccount():
    Promise<void> {
    const persisted =
      await this.repository.list()

    const sessionCount =
      this.sessionAccounts.size

    const total =
      persisted.length
      + sessionCount

    if (
      total >= MAX_PROVIDER_ACCOUNTS
    ) {
      throw new Error(
        `Provider account limit reached (${MAX_PROVIDER_ACCOUNTS})`,
      )
    }
  }

  private async exclusive<T>(
    operation:
      () => Promise<T>,
  ): Promise<T> {
    const previous =
      this.operationQueue

    let release!:
      () => void

    this.operationQueue =
      new Promise<void>(
        (resolve) => {
          release =
            resolve
        },
      )

    await previous

    try {
      return await operation()
    } finally {
      release()
    }
  }

  private registerAndSelect(
    accountId: string,
    provider: AIProvider,
  ): void {
    /**
     * IMPORTANTE:
     *
     * Não fazemos mais manager.clear() aqui.
     *
     * Cada conta fica registrada pelo seu accountId.
     */
    this.manager.replace(
      provider,
      accountId,
    )

    this.manager.select(
      accountId,
    )
  }
}
