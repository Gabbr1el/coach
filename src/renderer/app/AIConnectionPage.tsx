import {
  Bot,
  ChevronRight,
  Code2,
  Info,
  KeyRound,
  LogIn,
  Network,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import type {
  ConfigureProviderResult,
  ProviderAccountSummary,
  ProviderStatus,
} from '../../shared/contracts/provider-contract'

type ProviderType =
  | 'openai'
  | 'omniroute'
  | 'openai-compatible'

type Persistence =
  | 'secure-vault'
  | 'session'


type ConnectionMethod =
  | ProviderType
  | 'gemini-oauth'
  | 'copilot-oauth'
  | 'claude-oauth'
  | 'other-provider'
  | 'opencode-api'
  | 'custom-endpoint'
  | 'manual-token'

const SIMPLE_CONNECTIONS = [
  {
    id: 'gemini-oauth' as const,
    title: 'Gemini OAuth',
    subtitle: 'Google',
    icon: Sparkles,
    badge: 'Recomendado',
  },
  {
    id: 'copilot-oauth' as const,
    title: 'GitHub Copilot',
    subtitle: 'Entrar com GitHub',
    icon: Code2,
    badge: 'Em breve',
  },
  {
    id: 'claude-oauth' as const,
    title: 'Claude OAuth',
    subtitle: 'Anthropic',
    icon: Bot,
    badge: 'Em breve',
  },
  {
    id: 'other-provider' as const,
    title: 'Outros provedores',
    subtitle: 'Login do provedor',
    icon: LogIn,
    badge: null,
  },
]

const ADVANCED_CONNECTIONS = [
  {
    id: 'openai' as const,
    title: 'OpenAI API key',
    icon: KeyRound,
  },
  {
    id: 'omniroute' as const,
    title: 'OmniRoute',
    icon: Network,
  },
  {
    id: 'openai-compatible' as const,
    title: 'OpenAI-compatible',
    icon: SlidersHorizontal,
  },
  {
    id: 'opencode-api' as const,
    title: 'OpenCode / API',
    icon: Code2,
  },
  {
    id: 'custom-endpoint' as const,
    title: 'Endpoint personalizado',
    icon: Network,
  },
  {
    id: 'manual-token' as const,
    title: 'Token + modelo manual',
    icon: SlidersHorizontal,
  },
]


function providerConnectionName(
  providerType: ProviderType,
): string {
  switch (providerType) {
    case 'openai':
      return 'OpenAI'

    case 'omniroute':
      return 'OmniRoute'

    case 'openai-compatible':
      return 'OpenAI-compatible'
  }
}


export interface AIConnectionPageProps {
  status: ProviderStatus | null
  accounts: ProviderAccountSummary[]
  onConfigured: (
    label: string,
    apiKey: string,
    model: string,
    persistence: Persistence,
  ) => Promise<ConfigureProviderResult>
  onConfiguredCompatible: (
    connectorId:
      | 'omniroute'
      | 'openai-compatible',
    label: string,
    baseUrl: string,
    apiKey: string,
    model: string,
    persistence: Persistence,
  ) => Promise<ConfigureProviderResult>
  onSelect: (accountId: string) => Promise<void>
  onSetEnabled: (
    accountId: string,
    enabled: boolean,
  ) => Promise<void>
  onRemove: (accountId: string) => Promise<void>
}

function ProviderConnectionForm({
  status,
  accounts,
  onConfigured,
  onConfiguredCompatible,
  initialProviderType,
  onConnected,
}: AIConnectionPageProps & {
  initialProviderType: ProviderType
  onConnected: (
    providerType: ProviderType,
  ) => void
}) {
  const providerType =
    initialProviderType

  const [label, setLabel] =
    useState(
      providerType === 'openai'
        ? 'OpenAI'
        : providerType === 'omniroute'
          ? 'OmniRoute local'
          : 'Provedor compatível',
    )

  const [apiKey, setApiKey] =
    useState(
      providerType === 'omniroute'
        ? 'omniroute'
        : '',
    )

  const [model, setModel] =
    useState(
      providerType === 'openai'
        ? 'gpt-4.1-mini'
        : providerType === 'omniroute'
          ? 'codex/gpt-5.6-sol'
          : '',
    )

  const [saving, setSaving] =
    useState(false)

  const [error, setError] =
    useState<string | null>(null)

  const [persistence, setPersistence] =
    useState<Persistence>('session')

  const [omnirouteMode, setOmnirouteMode] =
    useState<'local' | 'custom'>('local')

  const [baseUrl, setBaseUrl] =
    useState(
      providerType === 'omniroute'
        ? 'http://127.0.0.1:20128/v1'
        : '',
    )

  const secureStorageUnavailable =
    status?.secureStorageAvailable === false

  const effectivePersistence =
    secureStorageUnavailable
      ? 'session'
      : persistence

  async function configure() {
    setSaving(true)
    setError(null)

    try {
      const result =
        providerType === 'openai'
          ? await onConfigured(
              label,
              apiKey,
              model,
              effectivePersistence,
            )
          : await onConfiguredCompatible(
              providerType,
              label,
              baseUrl,
              apiKey,
              model,
              effectivePersistence,
            )

      if (!result.ok) {
        const providerLabel =
          providerType === 'openai'
            ? 'A OpenAI'
            : providerType === 'omniroute'
              ? 'O OmniRoute'
              : 'O provedor compatível'

        const messages = {
          INVALID_CREDENTIAL:
            `${providerLabel} recusou a credencial. Verifique a chave ou token configurado.`,

          INSUFFICIENT_QUOTA:
            providerType === 'openai'
              ? 'A conta de API está sem créditos ou faturamento ativo. ChatGPT Plus não inclui créditos da API.'
              : `${providerLabel} informou que a conta está sem quota ou créditos disponíveis.`,

          MODEL_UNAVAILABLE:
            `${providerLabel} aceitou a credencial, mas o modelo “${model}” não está disponível. Verifique o identificador do modelo e o acesso desta conta.`,

          ACCESS_RESTRICTED:
            `${providerLabel} bloqueou o acesso por permissão, política ou região.`,

          RATE_LIMITED:
            `${providerLabel} está limitando temporariamente as requisições. Aguarde um pouco e tente novamente.`,

          NETWORK_UNAVAILABLE:
            `Não foi possível alcançar ${
              providerType === 'openai'
                ? 'a OpenAI'
                : providerType === 'omniroute'
                  ? 'o OmniRoute'
                  : 'o provedor compatível'
            }. Verifique o serviço, rede ou firewall.`,

          SECURE_STORAGE_UNAVAILABLE:
            'O cofre seguro não está disponível. Escolha “Somente nesta sessão”.',

          INVALID_CONFIGURATION:
            'A configuração enviada é inválida. Revise nome, chave, modelo e armazenamento.',

          ACCOUNT_DISABLED:
            'Esta conta de IA está desativada.',

          ACCOUNT_NOT_FOUND:
            'A conta de IA não foi encontrada.',

          ACCOUNT_LIMIT_REACHED:
            'O limite de 10 contas de IA foi atingido.',

          UNKNOWN:
            `${providerLabel} retornou uma resposta inesperada. Confira a conta e tente novamente.`,
        } as const

        setError(messages[result.code])
        return
      }

      setApiKey('')
      onConnected(providerType)
    } catch {
      setError(
        'A conexão falhou. Verifique a credencial, o modelo e o acesso da conta.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <form
        className="mt-8 rounded-2xl border border-[#242730] bg-[#111217] p-5 sm:p-6"
        onSubmit={(event) => {
          event.preventDefault()
          void configure()
        }}
      >
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#626773]">
            Nova conexão
          </p>

          <h2 className="mt-1 text-xl font-semibold text-white">
            {providerType === 'openai'
              ? 'OpenAI API'
              : providerType === 'omniroute'
                ? 'OmniRoute'
                : 'OpenAI-compatible'}
          </h2>

          <p className="mt-2 text-xs leading-5 text-[#747986]">
            {providerType === 'openai'
              ? 'Use uma chave da API oficial da OpenAI.'
              : providerType === 'omniroute'
                ? 'Conecte uma instância OmniRoute local ou remota.'
                : 'Conecte um serviço que implemente endpoints compatíveis com a API da OpenAI.'}
          </p>
        </div>

        {secureStorageUnavailable && (
          <div className="mt-5 rounded-xl border border-[#5f512c] bg-[#211d12] p-4 text-xs leading-5 text-[#e8c878]">
            O cofre seguro persistente não está disponível neste ambiente.
            Você ainda pode usar a credencial somente nesta sessão; ela será
            esquecida ao fechar o Coach.
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-5 rounded-xl border border-[#55353a] bg-[#211417] p-4 text-xs leading-5 text-[#e99ca1]"
          >
            {error}
          </div>
        )}

        {providerType === 'omniroute' && (
          <section className="mt-6">
            <p className="text-xs font-bold text-[#c8cad0]">
              Configuração
            </p>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={omnirouteMode === 'local'}
                onClick={() => {
                  setOmnirouteMode('local')
                  setLabel('OmniRoute local')
                  setBaseUrl('http://127.0.0.1:20128/v1')
                  setApiKey('omniroute')
                  setModel('codex/gpt-5.6-sol')
                  setPersistence('session')
                  setError(null)
                }}
                className={`rounded-xl border px-4 py-3 text-left text-xs font-semibold ${
                  omnirouteMode === 'local'
                    ? 'border-[#8c7cff] bg-[#181622] text-white'
                    : 'border-[#30333c] bg-[#0d0e12] text-[#9297a3] hover:border-[#454956]'
                }`}
              >
                <span className="block">
                  Local padrão
                </span>

                <span className="mt-1 block text-[10px] font-normal text-[#626773]">
                  127.0.0.1:20128
                </span>
              </button>

              <button
                type="button"
                aria-pressed={omnirouteMode === 'custom'}
                onClick={() => {
                  setOmnirouteMode('custom')
                  setLabel('OmniRoute personalizado')
                  setBaseUrl('')
                  setApiKey('')
                  setModel('')
                  setError(null)
                }}
                className={`rounded-xl border px-4 py-3 text-left text-xs font-semibold ${
                  omnirouteMode === 'custom'
                    ? 'border-[#8c7cff] bg-[#181622] text-white'
                    : 'border-[#30333c] bg-[#0d0e12] text-[#9297a3] hover:border-[#454956]'
                }`}
              >
                <span className="block">
                  Personalizada
                </span>

                <span className="mt-1 block text-[10px] font-normal text-[#626773]">
                  Endpoint, token e modelo próprios
                </span>
              </button>
            </div>
          </section>
        )}

        <label className="mt-6 block text-xs font-bold text-[#c8cad0]">
          Nome desta conta
          <input
            required
            maxLength={60}
            value={label}
            onChange={(event) =>
              setLabel(event.target.value)
            }
            className="mt-2 w-full rounded-xl border border-[#30333c] bg-[#0d0e12] px-4 py-3 text-white outline-none focus:border-[#8c7cff]"
          />
        </label>

        {providerType !== 'openai' && (
          <label className="mt-5 block text-xs font-bold text-[#c8cad0]">
            Endpoint
            <input
              required
              value={baseUrl}
              onChange={(event) =>
                setBaseUrl(event.target.value)
              }
              placeholder={
                providerType === 'omniroute'
                  ? 'http://127.0.0.1:20128/v1'
                  : 'https://api.exemplo.com/v1'
              }
              className="mt-2 w-full rounded-xl border border-[#30333c] bg-[#0d0e12] px-4 py-3 font-mono text-sm text-white outline-none focus:border-[#8c7cff]"
            />
          </label>
        )}

        <label className="mt-5 block text-xs font-bold text-[#c8cad0]">
          {providerType === 'openai'
            ? 'Chave de API OpenAI'
            : providerType === 'omniroute'
              ? 'Token OmniRoute'
              : 'Token / chave de API'}

          <input
            type="password"
            autoComplete="off"
            required
            minLength={
              providerType === 'openai'
                ? 20
                : 1
            }
            maxLength={512}
            value={apiKey}
            onChange={(event) =>
              setApiKey(event.target.value)
            }
            placeholder={
              providerType === 'openai'
                ? 'sk-…'
                : providerType === 'omniroute'
                  ? 'Token local'
                  : 'Token ou chave do provedor'
            }
            className="mt-2 w-full rounded-xl border border-[#30333c] bg-[#0d0e12] px-4 py-3 font-mono text-white outline-none focus:border-[#8c7cff]"
          />
        </label>

        <label className="mt-5 block text-xs font-bold text-[#c8cad0]">
          Modelo
          <input
            required
            maxLength={100}
            value={model}
            onChange={(event) =>
              setModel(event.target.value)
            }
            className="mt-2 w-full rounded-xl border border-[#30333c] bg-[#0d0e12] px-4 py-3 text-white outline-none focus:border-[#8c7cff]"
          />
        </label>

        <label className="mt-5 block text-xs font-bold text-[#c8cad0]">
          Armazenamento
          <select
            value={effectivePersistence}
            onChange={(event) =>
              setPersistence(
                event.target.value as Persistence,
              )
            }
            className="mt-2 w-full rounded-xl border border-[#30333c] bg-[#0d0e12] px-4 py-3 text-white outline-none"
          >
            <option value="session">
              Somente nesta sessão
            </option>

            {!secureStorageUnavailable && (
              <option value="secure-vault">
                Cofre seguro do sistema
              </option>
            )}
          </select>
        </label>

        <button
          disabled={
            saving
            || !apiKey.trim()
          }
          className="mt-6 w-full rounded-xl bg-[#8c7cff] px-5 py-3 text-sm font-bold text-[#0c0d10] disabled:opacity-45"
        >
          {saving
            ? 'Testando conexão…'
            : accounts.length
              ? 'Adicionar e usar conta'
              : 'Testar e conectar'}
        </button>
      </form>
    </>
  )
}


type AIHubTab =
  | 'connect'
  | 'accounts'

function providerDisplayName(
  account: ProviderAccountSummary,
) {
  switch (account.providerId) {
    case 'openai':
      return 'OpenAI'

    case 'omniroute':
      return 'OmniRoute'

    case 'openai-compatible':
      return 'OpenAI-compatible'

    case 'gemini':
      return 'Google Gemini'

    case 'anthropic':
      return 'Claude'

    case 'ollama':
      return 'Ollama'

    default:
      return account.providerName
  }
}

function AccountManager({
  status,
  accounts,
  onSelect,
  onSetEnabled,
  onRemove,
  onConnect,
}: Pick<
  AIConnectionPageProps,
  | 'status'
  | 'accounts'
  | 'onSelect'
  | 'onSetEnabled'
  | 'onRemove'
> & {
  onConnect(): void
}) {
  const [busyAccountId, setBusyAccountId] =
    useState<string | null>(null)

  const [managerError, setManagerError] =
    useState<string | null>(null)

  const enabledCount =
    accounts.filter(
      (account) =>
        account.isEnabled,
    ).length

  const providerIds =
    Array.from(
      new Set(
        accounts.map(
          (account) =>
            account.providerId,
        ),
      ),
    )

  return (
    <section className="mt-6">
            <div className="grid gap-3 sm:grid-cols-3">
          <article className="rounded-xl border border-[#292c35] bg-[#111217] p-4">
            <strong className="text-2xl text-white">
              {accounts.length}
            </strong>

            <span className="mt-1 block text-[11px] text-[#747986]">
              Contas configuradas
            </span>
          </article>

          <article className="rounded-xl border border-[#292c35] bg-[#111217] p-4">
            <strong className="text-2xl text-white">
              {enabledCount}
            </strong>

            <span className="mt-1 block text-[11px] text-[#747986]">
              Habilitadas
            </span>
          </article>

          <article className="rounded-xl border border-[#292c35] bg-[#111217] p-4">
            <strong className="text-2xl text-white">
              {providerIds.length}
            </strong>

            <span className="mt-1 block text-[11px] text-[#747986]">
              Provedores
            </span>
          </article>
      </div>

      {managerError && (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-[#55353a] bg-[#211417] p-4 text-xs text-[#e99ca1]"
        >
          {managerError}
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-[#30333c] bg-[#111217] px-6 py-12 text-center">
          <Network
            size={24}
            className="mx-auto text-[#626773]"
            aria-hidden="true"
          />

          <h2 className="mt-4 text-lg font-semibold text-white">
            Nenhuma conta conectada
          </h2>

          <p className="mt-2 text-sm text-[#747986]">
            Conecte um provedor para ele aparecer aqui.
          </p>

          <button
            type="button"
            onClick={onConnect}
            className="mt-5 text-sm font-semibold text-[#aa9cff]"
          >
            Conectar IA →
          </button>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {providerIds.map(
            (providerId) => {
              const providerAccounts =
                accounts.filter(
                  (account) =>
                    account.providerId
                    === providerId,
                )

              const first =
                providerAccounts[0]

              if (!first)
                return null

              return (
                <section
                  key={providerId}
                  className="overflow-hidden rounded-2xl border border-[#292c35] bg-[#111217]"
                >
                  <header className="flex items-center justify-between gap-3 border-b border-[#292c35] px-5 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#242139] text-[#8c7cff]">
                        <Network
                          size={16}
                          aria-hidden="true"
                        />
                      </span>

                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold text-white">
                          {providerDisplayName(
                            first,
                          )}
                        </h2>

                        <span className="text-[10px] text-[#747986]">
                          {providerId}
                        </span>
                      </div>
                    </div>

                    <span className="text-[11px] text-[#747986]">
                      {providerAccounts.length}
                      {' '}
                      {providerAccounts.length === 1
                        ? 'conta'
                        : 'contas'}
                    </span>
                  </header>

                  <div>
                    {providerAccounts.map(
                      (account) => (
                        <article
                          key={account.id}
                          className="flex flex-wrap items-center gap-4 border-b border-[#242730] px-5 py-4 last:border-b-0"
                        >
                          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#252833] text-xs font-bold text-white">
                            {(
                              account.identityLabel
                              ?? account.label
                            )
                              .trim()
                              .charAt(0)
                              .toUpperCase()
                              || 'IA'}
                          </span>

                          <div className="min-w-[180px] flex-1">
                            <p className="truncate text-sm font-semibold text-white">
                              {account.identityLabel
                                ?? account.label}
                            </p>

                            <p className="mt-1 truncate text-[10px] text-[#747986]">
                              {account.identityLabel
                                ? `${account.label} · `
                                : ''}
                              {account.model}
                              {account.sessionOnly
                                ? ' · somente nesta sessão'
                                : ''}
                            </p>
                          </div>

                          <span
                            className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-1 text-[10px] font-semibold ${
                              status?.activeAccountId === account.id
                                ? status.connected
                                  ? 'bg-[#11261d] text-[#72d7aa]'
                                  : 'bg-[#2a1719] text-[#e27e82]'
                                : account.isEnabled
                                  ? 'bg-[#1b1d24] text-[#9297a3]'
                                  : 'bg-[#1b1d24] text-[#626773]'
                            }`}
                          >
                            <i
                              className={`size-1.5 rounded-full ${
                                status?.activeAccountId === account.id
                                  ? status.connected
                                    ? 'bg-[#72d7aa]'
                                    : 'bg-[#e27e82]'
                                  : 'bg-[#626773]'
                              }`}
                              aria-hidden="true"
                            />

                            {status?.activeAccountId === account.id
                              ? status.connected
                                ? 'Conectada · Principal'
                                : 'Desconectada · Principal'
                              : account.isEnabled
                                ? 'Habilitada'
                                : 'Desativada'}
                          </span>

                          {account.isEnabled
                            && !account.isActive && (
                              <button
                                type="button"
                                onClick={() =>
                                  void onSelect(
                                    account.id,
                                  )
                                }
                                className="rounded-lg border border-[#343743] px-3 py-2 text-[11px] font-semibold text-white hover:border-[#8c7cff]"
                              >
                                Usar
                              </button>
                            )}

                          <button
                            type="button"
                            role="switch"
                            aria-label={`${
                              account.isEnabled
                                ? 'Desativar'
                                : 'Ativar'
                            } ${account.label}`}
                            aria-checked={account.isEnabled}
                            disabled={
                              busyAccountId
                              === account.id
                            }
                            onClick={() => {
                              const enabled =
                                !account.isEnabled

                              setBusyAccountId(
                                account.id,
                              )
                              setManagerError(null)

                              void onSetEnabled(
                                account.id,
                                enabled,
                              )
                                .catch(() =>
                                  setManagerError(
                                    enabled
                                      ? 'Não foi possível ativar esta conta.'
                                      : 'Não foi possível desativar esta conta.',
                                  ),
                                )
                                .finally(() =>
                                  setBusyAccountId(
                                    null,
                                  ),
                                )
                            }}
                            className={`relative h-6 w-11 shrink-0 rounded-full border transition disabled:opacity-50 ${
                              account.isEnabled
                                ? 'border-[#72d7aa] bg-[#245b43]'
                                : 'border-[#454956] bg-[#242730]'
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className={`absolute top-0.5 size-4 rounded-full bg-white transition ${
                                account.isEnabled
                                  ? 'left-[22px]'
                                  : 'left-1'
                              }`}
                            />
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              void onRemove(
                                account.id,
                              )
                            }
                            className="rounded-lg border border-[#55353a] px-3 py-2 text-[11px] font-semibold text-[#e99ca1]"
                          >
                            Remover
                          </button>
                        </article>
                      ),
                    )}
                  </div>
                </section>
              )
            },
          )}
        </div>
      )}
    </section>
  )
}

export function AIConnectionPage(
  props: AIConnectionPageProps,
) {
  const [activeTab, setActiveTab] =
    useState<AIHubTab>('connect')

  const [selectedMethod, setSelectedMethod] =
    useState<ConnectionMethod | null>(null)

  const [connectionSuccess, setConnectionSuccess] =
    useState<string | null>(null)

  const secureStorageAvailable =
    props.status?.secureStorageAvailable

  const selectedProvider =
    selectedMethod === 'openai'
    || selectedMethod === 'omniroute'
    || selectedMethod === 'openai-compatible'
      ? selectedMethod
      : null

  const selectedInfo = [
    ...SIMPLE_CONNECTIONS,
    ...ADVANCED_CONNECTIONS,
  ].find(
    (item) =>
      item.id === selectedMethod,
  )

  return (
    <div className="mx-auto w-full max-w-[1320px]">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="text-3xl font-semibold text-white">
            {activeTab === 'connect'
              ? 'Conectar IA'
              : 'Contas de IA'}
          </h1>

          <p className="mt-2 text-sm text-[#9297a3]">
            {activeTab === 'connect'
              ? 'Adicione provedores e escolha como o Coach acessa seus modelos.'
              : 'Gerencie acessos, disponibilidade e a conta principal usada pelo Coach.'}
          </p>
        </div>

        <div
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
            secureStorageAvailable === true
              ? 'border-[#173b2d] bg-[#11261d] text-[#72d7aa]'
              : secureStorageAvailable === false
                ? 'border-[#5f512c] bg-[#211d12] text-[#e8c878]'
                : 'border-[#30333c] bg-[#17191f] text-[#9297a3]'
          }`}
        >
          <ShieldCheck
            size={15}
            aria-hidden="true"
          />

          {secureStorageAvailable === true
            ? 'Credenciais protegidas'
            : secureStorageAvailable === false
              ? 'Somente nesta sessão'
              : 'Verificando segurança'}
        </div>
      </header>

      <nav
        aria-label="Central de IA"
        className="mt-6 flex gap-7 border-b border-[#292c35]"
      >
        <button
          type="button"
          onClick={() =>
            setActiveTab('connect')
          }
          aria-current={
            activeTab === 'connect'
              ? 'page'
              : undefined
          }
          className={`flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-semibold ${
            activeTab === 'connect'
              ? 'border-[#8c7cff] text-white'
              : 'border-transparent text-[#747986] hover:text-white'
          }`}
        >
          <Network
            size={15}
            className={
              activeTab === 'connect'
                ? 'text-[#8c7cff]'
                : undefined
            }
            aria-hidden="true"
          />
          Conectar IA
        </button>

        <button
          type="button"
          onClick={() =>
            setActiveTab('accounts')
          }
          aria-current={
            activeTab === 'accounts'
              ? 'page'
              : undefined
          }
          className={`flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-semibold ${
            activeTab === 'accounts'
              ? 'border-[#8c7cff] text-white'
              : 'border-transparent text-[#747986] hover:text-white'
          }`}
        >
          <Users
            size={15}
            className={
              activeTab === 'accounts'
                ? 'text-[#8c7cff]'
                : undefined
            }
            aria-hidden="true"
          />
          Gerenciar contas
        </button>
                {activeTab === 'accounts' && (
            <button
              type="button"
              onClick={() =>
                setActiveTab('connect')
              }
              className="ml-auto mb-2 rounded-xl bg-[#8c7cff] px-4 py-2 text-xs font-bold text-[#0c0d10]"
            >
              + Conectar nova conta
            </button>
          )}
</nav>

      {activeTab === 'accounts' && (
        <AccountManager
          status={props.status}
          accounts={props.accounts}
          onSelect={props.onSelect}
          onSetEnabled={props.onSetEnabled}
          onRemove={props.onRemove}
          onConnect={() =>
            setActiveTab('connect')
          }
        />
      )}

      <div
        className={`mt-6 gap-6 lg:grid-cols-[minmax(310px,450px)_minmax(0,1fr)] ${
          activeTab === 'connect'
            ? 'grid'
            : 'hidden'
        }`}
      >
        <aside>
          <section>
            <h2 className="text-base font-semibold text-white">
              Login simples
            </h2>

            <p className="mt-1 text-xs text-[#747986]">
              Entre com sua conta. Sem copiar chaves ou configurar endpoints.
            </p>

            <div className="mt-3 space-y-3">
              {SIMPLE_CONNECTIONS.map(
                ({
                  id,
                  title,
                  subtitle,
                  icon: Icon,
                  badge,
                }) => {
                  const active =
                    selectedMethod === id

                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setSelectedMethod(id)
                      }
                      className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition ${
                        active
                          ? 'border-[#8c7cff] bg-[#181622]'
                          : 'border-[#292c35] bg-[#111217] hover:border-[#454956]'
                      }`}
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#242139] text-[#8c7cff]">
                        <Icon
                          size={18}
                          aria-hidden="true"
                        />
                      </span>

                      <span className="min-w-0 flex-1">
                        <strong className="block text-sm font-medium text-white">
                          {title}
                        </strong>

                        <span className="mt-0.5 block text-[11px] text-[#747986]">
                          {subtitle}
                        </span>
                      </span>

                      {badge && (
                        <span className="rounded-md bg-[#292244] px-2 py-1 text-[9px] font-bold text-[#aa9cff]">
                          {badge}
                        </span>
                      )}

                      <ChevronRight
                        size={15}
                        className="shrink-0 text-[#626773]"
                        aria-hidden="true"
                      />
                    </button>
                  )
                },
              )}
            </div>
          </section>

          <section className="mt-5">
            <h2 className="text-base font-semibold text-white">
              Avançado
            </h2>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-2">
              {ADVANCED_CONNECTIONS.map(
                ({
                  id,
                  title,
                  icon: Icon,
                }) => {
                  const active =
                    selectedMethod === id

                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setSelectedMethod(id)
                      }
                      className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-left text-[11px] font-medium transition ${
                        active
                          ? 'border-[#8c7cff] bg-[#181622] text-white'
                          : 'border-[#292c35] bg-[#111217] text-[#9297a3] hover:border-[#454956] hover:text-white'
                      }`}
                    >
                      <Icon
                        size={14}
                        aria-hidden="true"
                      />
                      {title}
                    </button>
                  )
                },
              )}
            </div>
          </section>

          <section className="mt-4 rounded-xl border border-[#292c35] bg-[#111217] p-4">
            <div className="flex gap-3">
              <Info
                size={17}
                className="mt-0.5 shrink-0 text-[#e8c878]"
                aria-hidden="true"
              />

              <div>
                <h3 className="text-xs font-semibold text-white">
                  Qual opção devo usar?
                </h3>

                <p className="mt-2 text-[11px] leading-5 text-[#9297a3]">
                  Prefira OAuth para contas pessoais. Use as opções avançadas
                  quando sua equipe já possui chaves, gateway ou infraestrutura
                  própria.
                </p>

                <button
                  type="button"
                  className="mt-3 text-[11px] font-medium text-[#aa9cff]"
                >
                  Comparar métodos de conexão →
                </button>
              </div>
            </div>
          </section>
        </aside>

        <section className="min-h-[590px] overflow-hidden rounded-2xl border border-[#292c35] bg-[#111217]">
          {selectedMethod === null ? (
            <div className="flex min-h-[590px] flex-col items-center justify-center px-6 py-12 text-center">
              <span className="grid size-16 place-items-center rounded-2xl bg-[#292244] text-[#8c7cff]">
                <Network
                  size={27}
                  aria-hidden="true"
                />
              </span>

              <h2 className="mt-6 text-2xl font-semibold text-white">
                Escolha como deseja conectar
              </h2>

              <p className="mt-2 max-w-xl text-sm leading-6 text-[#9297a3]">
                Selecione uma opção ao lado para visualizar os detalhes,
                permissões e etapas antes de conectar sua conta.
              </p>

              <div className="mt-6 grid w-full max-w-2xl gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-[#292c35] bg-[#0d0e12] p-4">
                  <Sparkles
                    size={16}
                    className="mx-auto text-[#9297a3]"
                    aria-hidden="true"
                  />

                  <strong className="mt-3 block text-[11px] text-white">
                    Mais simples
                  </strong>

                  <span className="mt-1 block text-[10px] text-[#626773]">
                    Use OAuth
                  </span>
                </div>

                <div className="rounded-xl border border-[#292c35] bg-[#0d0e12] p-4">
                  <Users
                    size={16}
                    className="mx-auto text-[#9297a3]"
                    aria-hidden="true"
                  />

                  <strong className="mt-3 block text-[11px] text-white">
                    Para equipes
                  </strong>

                  <span className="mt-1 block text-[10px] text-[#626773]">
                    Use API ou gateway
                  </span>
                </div>

                <div className="rounded-xl border border-[#292c35] bg-[#0d0e12] p-4">
                  <SlidersHorizontal
                    size={16}
                    className="mx-auto text-[#9297a3]"
                    aria-hidden="true"
                  />

                  <strong className="mt-3 block text-[11px] text-white">
                    Maior controle
                  </strong>

                  <span className="mt-1 block text-[10px] text-[#626773]">
                    Configure manualmente
                  </span>
                </div>
              </div>

              <div className="mt-6 rounded-lg bg-[#181622] px-4 py-2 text-[11px] text-[#aa9cff]">
                ← Selecione um método no painel à esquerda
              </div>
            </div>
          ) : selectedProvider ? (
            <div className="p-5 sm:p-6">
              <ProviderConnectionForm
                key={selectedProvider}
                {...props}
                initialProviderType={
                  selectedProvider
                }
                onConnected={(
                  providerType,
                ) => {
                  setConnectionSuccess(
                    providerConnectionName(
                      providerType,
                    ),
                  )
                  setSelectedMethod(null)
                }}
              />
            </div>
          ) : (
            <div className="flex min-h-[590px] flex-col items-center justify-center px-8 text-center">
              {selectedInfo && (
                <>
                  <span className="grid size-14 place-items-center rounded-2xl bg-[#292244] text-[#8c7cff]">
                    <selectedInfo.icon
                      size={23}
                      aria-hidden="true"
                    />
                  </span>

                  <h2 className="mt-5 text-xl font-semibold text-white">
                    {selectedInfo.title}
                  </h2>

                  <p className="mt-2 max-w-md text-sm leading-6 text-[#9297a3]">
                    {selectedMethod === 'copilot-oauth'
                      ? 'A conexão com GitHub Copilot será feita por login com GitHub, sem exigir que o usuário cole uma chave manualmente. A autenticação ainda será implementada.'
                      : 'A estrutura desta conexão já está reservada na Central de IA. A integração funcional será adicionada na etapa específica deste provedor.'}
                  </p>
                </>
              )}
            </div>
          )}
        </section>
      </div>

      {connectionSuccess && (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-black/65 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-connection-success-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-[#343743] bg-[#111217] p-6 shadow-2xl">
            <div className="mx-auto grid size-14 place-items-center rounded-full bg-[#11261d] text-2xl font-bold text-[#72d7aa]">
              ✓
            </div>

            <h2
              id="ai-connection-success-title"
              className="mt-5 text-center text-xl font-semibold text-white"
            >
              IA conectada com sucesso
            </h2>

            <p className="mt-2 text-center text-sm leading-6 text-[#9297a3]">
              {connectionSuccess} foi conectado ao Coach e já está pronto para uso.
            </p>

            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={() =>
                  setConnectionSuccess(null)
                }
                className="rounded-xl border border-[#343743] px-4 py-2.5 text-xs font-semibold text-white hover:border-[#525663]"
              >
                Continuar
              </button>

              <button
                type="button"
                onClick={() => {
                  setConnectionSuccess(null)
                  setActiveTab('accounts')
                }}
                className="rounded-xl bg-[#8c7cff] px-4 py-2.5 text-xs font-bold text-[#0c0d10]"
              >
                Gerenciar conta
              </button>
            </div>
          </div>
        </div>
      )}

      <section
        className={`mt-6 flex-wrap items-center justify-between gap-4 rounded-xl border border-[#292c35] bg-[#111217] p-4 ${
          activeTab === 'connect'
            ? 'flex'
            : 'hidden'
        }`}
      >
        <div className="flex items-start gap-3">
          <Info
            size={17}
            className="mt-0.5 text-[#9297a3]"
            aria-hidden="true"
          />

          <div>
            <strong className="block text-xs text-white">
              Ainda não sabe qual conexão usar?
            </strong>

            <p className="mt-1 text-[10px] text-[#747986]">
              Veja exemplos para contas pessoais, equipes e provedores
              personalizados.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="rounded-lg bg-[#1b1d24] px-4 py-2 text-[11px] text-white"
        >
          Ver guia de conexões ↗
        </button>
      </section>
    </div>
  )
}
