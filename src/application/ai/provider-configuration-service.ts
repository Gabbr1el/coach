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

const LOCAL_OMNIROUTE_ACCOUNT_ID =
  'omniroute-local-default'

function isLocalOmniRoute(
  baseUrl: string | null,
): boolean {
  try {
    const url = new URL(baseUrl ?? '')

    return (
      (
        url.hostname === '127.0.0.1'
        || url.hostname === 'localhost'
      )
      && url.port === '20128'
    )
  } catch {
    return false
  }
}

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
      ) => AIProvider,

    private readonly createCompatibleProvider:
      (
        label: string,
        baseUrl: string,
        apiKey: string,
        model: string,
      ) => AIProvider,

    private readonly now: () => number =
      Date.now,
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
      this.healthByAccount.clear()

      const configurations =
        await this.repository.list()

      if (!this.vault.isAvailable()) {
        const local = [
          configurations.find(
            (item) => item.isActive,
          ),
          ...configurations,
        ].find(
          (item) =>
            item?.providerId ===
              'openai-compatible'
            && isLocalOmniRoute(
              item.baseUrl,
            ),
        )

        this.activateLocalOmniRoute(
          local?.displayName
            ?? 'OmniRoute local',

          local?.baseUrl
            ?? 'http://127.0.0.1:20128/v1',

          local?.model
            ?? 'codex/gpt-5.6-sol',
        )

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

      const loaded =
        await this.loadPersistedAccounts(
          configurations,
          false,
        )

      if (!loaded) {
        this.activateLocalOmniRoute(
          'OmniRoute local',
          'http://127.0.0.1:20128/v1',
          'codex/gpt-5.6-sol',
        )
      }
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

    return {
      configured,

      connected:
        health.connected
        && Boolean(
          this.manager.getActive(),
        ),

      connectionState:
        configured
          ? health.connected
            ? 'connected'
            : this.manager.getActive()
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
        Boolean(sessionAccount),
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

        isActive:
          true,

        sessionOnly:
          true,

        baseUrl:
          null,
      }

      this.removeLocalFallback()

      this.sessionAccounts.set(
        accountId,
        account,
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

    this.removeLocalFallback()

    this.registerAndSelect(
      accountId,
      provider,
    )

    return this.getStatus()
  }

  async configureCompatible(
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

        const provider =
          this.createCompatibleProvider(
            label,
            baseUrl,
            apiKey,
            model,
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
              'openai-compatible',

            providerName:
              label,

            label,

            model,

            isActive:
              true,

            sessionOnly:
              true,

            baseUrl,
          }

          this.removeLocalFallback()

          this.sessionAccounts.set(
            accountId,
            account,
          )

          this.registerAndSelect(
            accountId,
            provider,
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
              'openai-compatible',

            displayName:
              label,

            label,

            authKind:
              'endpoint-token',

            identityLabel:
              null,

            baseUrl,

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
          await this.vault
            .delete(
              secretReference,
            )
            .catch(
              () => {},
            )

          throw error
        }

        this.removeLocalFallback()

        this.registerAndSelect(
          accountId,
          provider,
        )

        return this.getStatus()
      },
    )
  }

  async selectAccount(
    accountId: string,
  ): Promise<ProviderStatus> {
    return this.exclusive(
      () =>
        this.selectAccountExclusive(
          accountId,
          true,
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

    if (!apiKey) {
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

    this.removeLocalFallback()

    this.manager.replace(
      provider,
      accountId,
    )

    this.manager.select(
      accountId,
    )

    return this.getStatus()
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

      this.healthByAccount.delete(
        accountId,
      )

      if (wasActive) {
        await this.ensureActiveProvider(
          true,
        )
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
    if (wasActive) {
      this.manager.remove(
        accountId,
      )
    }

    await this.vault.delete(
      configuration.secretReference,
    )

    await this.repository.remove(
      accountId,
    )

    this.manager.remove(
      accountId,
    )

    this.healthByAccount.delete(
      accountId,
    )

    if (wasActive) {
      await this.ensureActiveProvider(
        true,
      )
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

        if (!apiKey) {
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
      try {
        this.manager.select(
          account.id,
        )

        return
      } catch {
        // Continua procurando uma conta operacional.
      }
    }

    this.activateLocalOmniRoute(
      'OmniRoute local',
      'http://127.0.0.1:20128/v1',
      'codex/gpt-5.6-sol',
    )
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
        )

      case 'openai-compatible':
      case 'omniroute':
        return this.createCompatibleProvider(
          configuration.label,
          configuration.baseUrl
            ?? '',
          secret,
          configuration.model,
        )

      case 'gemini':
      case 'anthropic':
      case 'ollama':
        throw new Error(
          `Provider connector '${configuration.providerId}' is not implemented yet`,
        )
    }
  }

  private activateLocalOmniRoute(
    label: string,
    baseUrl: string,
    model: string,
  ): void {
    const account:
      ProviderAccountSummary = {
      id:
        LOCAL_OMNIROUTE_ACCOUNT_ID,

      providerId:
        'openai-compatible',

      providerName:
        label,

      label,

      model,

      isActive:
        true,

      sessionOnly:
        true,

      baseUrl,
    }

    this.sessionAccounts.set(
      LOCAL_OMNIROUTE_ACCOUNT_ID,
      account,
    )

    this.registerAndSelect(
      LOCAL_OMNIROUTE_ACCOUNT_ID,

      this.createCompatibleProvider(
        label,
        baseUrl,
        'omniroute',
        model,
      ),
    )
  }

  private removeLocalFallback():
    void {
    if (
      !this.sessionAccounts.has(
        LOCAL_OMNIROUTE_ACCOUNT_ID,
      )
    ) {
      return
    }

    this.sessionAccounts.delete(
      LOCAL_OMNIROUTE_ACCOUNT_ID,
    )

    this.healthByAccount.delete(
      LOCAL_OMNIROUTE_ACCOUNT_ID,
    )

    this.manager.remove(
      LOCAL_OMNIROUTE_ACCOUNT_ID,
    )
  }

  private async verifyConnection(
    provider: AIProvider,
  ): Promise<ProviderHealth> {
    await provider.testConnection()

    return {
      connected: true,
      quota: 'available',
    }
  }

  private async assertCanCreateAccount():
    Promise<void> {
    const persisted =
      await this.repository.list()

    const sessionCount =
      [
        ...this.sessionAccounts.keys(),
      ].filter(
        (id) =>
          id
          !== LOCAL_OMNIROUTE_ACCOUNT_ID,
      ).length

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