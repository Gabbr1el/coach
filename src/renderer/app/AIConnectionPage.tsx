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
import { useState, useRef, useEffect } from 'react'
import type {
  BeginGitHubCopilotOAuthResult,
  ConfigureProviderResult,
  GitHubCopilotOAuthAuthorization,
  ProviderAccountSummary,
  ProviderConnectionErrorCode,
  ProviderStatus,
} from '../../shared/contracts/provider-contract'
import type { ProviderRuntimeIssue } from '../../shared/contracts/provider-contract'
import type { ProviderAccountHealthSnapshot } from '../../shared/contracts/provider-contract'

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
  | 'claude-oauth'
  | 'other-provider'
  | 'opencode-api'
  | 'manual-token'
  /*
   * Métodos atualmente oferecidos na Central de IA.
   *
   * Os IDs antigos permanecem no tipo temporariamente
   * porque existem fluxos legados e contas já criadas,
   * mas não são mais apresentados ao usuário.
   */
  | 'copilot-oauth'
  | 'gateway'
  | 'local-ai'
  | 'custom-endpoint'

const SIMPLE_CONNECTIONS = [
  {
    id: 'copilot-oauth' as const,
    title: 'GitHub Copilot',
    subtitle: 'Entrar com GitHub',
    icon: Code2,
    badge: 'Recomendado',
  },
]

const ADVANCED_CONNECTIONS = [
  {
    id: 'gateway' as const,
    title: 'Gateway de IA',
    icon: Network,
  },
  {
    id: 'local-ai' as const,
    title: 'IA local',
    icon: Bot,
  },
  {
    id: 'custom-endpoint' as const,
    title: 'Endpoint personalizado',
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

  runtimeIssues?: Readonly<
    Record<
      string,
      ProviderRuntimeIssue
    >
  >

  healthSnapshots?: Readonly<
    Record<
      string,
      ProviderAccountHealthSnapshot
    >
  >

  lastActivities?: Readonly<
    Record<
      string,
      {
        readonly outcome:
          | 'success'
          | 'failure'

        readonly at: number
        readonly code: string | null
        readonly detail: string
        readonly model: string
      }
    >
  >

  connectingAccountId?: string | null

  onRefreshHealth?:
    () => Promise<void>

  openCurrentRequest?: number
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
  onConnectGeminiOAuth:
    () => Promise<ConfigureProviderResult>

  onBeginGitHubCopilotOAuth:
    (accountId?: string) => Promise<BeginGitHubCopilotOAuthResult>

  onCompleteGitHubCopilotOAuth:
    (
      flowId: string,
    ) => Promise<ConfigureProviderResult>

  onListModels: (
    accountId: string,
  ) => Promise<readonly string[]>
  onSelect: (accountId: string) => Promise<void>
  onSetEnabled: (
    accountId: string,
    enabled: boolean,
  ) => Promise<void>
  onUpdate: (
    accountId: string,
    label: string,
    model: string,
    reasoningEffort:
      | 'auto'
      | 'low'
      | 'medium'
      | 'high',
  ) => Promise<void>
  onRemove: (accountId: string) => Promise<void>
}

function ProviderConnectionForm({
  status,
  accounts,
  onConfigured,
  onConfiguredCompatible,
  initialProviderType,
  connectionMethod,
  onConnected,
}: AIConnectionPageProps & {
  initialProviderType: ProviderType

  connectionMethod:
    | 'gateway'
    | 'custom-endpoint'

  onConnected: (
    providerType: ProviderType,
  ) => void
}) {
  const providerType =
    initialProviderType

  const [label, setLabel] =
    useState(
      connectionMethod === 'gateway'
        ? 'OmniRoute local'
        : connectionMethod
            === 'custom-endpoint'
          ? 'Endpoint personalizado'
          : providerType === 'openai'
            ? 'OpenAI'
            : 'Provedor compatível',
    )

  const [apiKey, setApiKey] =
    useState('')

  const [model, setModel] =
    useState(
      providerType === 'openai'
        ? 'gpt-4.1-mini'
        : '',
    )

  const [saving, setSaving] =
    useState(false)

  const [error, setError] =
    useState<string | null>(null)

  const [persistence, setPersistence] =
    useState<Persistence>('secure-vault')

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

  const effectivePersistence:
    Persistence =
      'secure-vault'

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

          AUTH_CANCELLED:
            'A autenticação foi cancelada antes de ser concluída.',

          OAUTH_CONFIGURATION_MISSING:
            'A configuração OAuth do Google não está disponível neste ambiente.',

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
            {connectionMethod === 'gateway'
              ? 'Gateway de IA'
              : connectionMethod
                  === 'custom-endpoint'
                ? 'Endpoint personalizado'
                : providerType === 'openai'
                  ? 'OpenAI API'
                  : 'OpenAI-compatible'}
          </h2>

          <p className="mt-2 text-xs leading-5 text-[#747986]">
            {connectionMethod === 'gateway'
              ? 'Conecte o Coach ao OmniRoute local ou remoto. Outros gateways poderão usar este mesmo caminho no futuro.'
              : connectionMethod
                  === 'custom-endpoint'
                ? 'Conecte uma VPS, servidor próprio ou serviço compatível com endpoints da API da OpenAI.'
                : providerType === 'openai'
                  ? 'Use uma chave da API oficial da OpenAI.'
                  : 'Conecte um serviço compatível com a API da OpenAI.'}
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
                  setApiKey('')
                  setModel('')
                  setPersistence('secure-vault')
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
                  Endpoint próprio; token opcional
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
              : 'Token / chave de API (opcional)'}

          <input
            type="password"
            autoComplete="off"
            required={
              providerType
                !== 'openai-compatible'
            }
            minLength={
              providerType === 'openai'
                ? 20
                : providerType === 'omniroute'
                  ? 1
                  : undefined
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
                  : 'Opcional — deixe vazio se não exigir autenticação'
            }
            className="mt-2 w-full rounded-xl border border-[#30333c] bg-[#0d0e12] px-4 py-3 font-mono text-white outline-none focus:border-[#8c7cff]"
          />

          {providerType === 'openai-compatible' && (
            <span className="mt-2 block text-[10px] font-normal leading-4 text-[#747986]">
              Deixe vazio se o servidor não exigir autenticação.
            </span>
          )}
        </label>

        {providerType === 'openai' && (
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
        )}

        <div className="mt-5">
          <span className="block text-xs font-bold text-[#c8cad0]">
            Armazenamento
          </span>

          <div className={`mt-2 rounded-xl border px-4 py-3 ${
            secureStorageUnavailable
              ? 'border-[#5b2f35] bg-[#241619]'
              : 'border-[#2f4039] bg-[#121c18]'
          }`}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span
                aria-hidden="true"
                className={
                  secureStorageUnavailable
                    ? 'text-[#e99ca1]'
                    : 'text-[#72d7aa]'
                }
              >
                {secureStorageUnavailable
                  ? '!'
                  : '✓'}
              </span>

              <span
                className={
                  secureStorageUnavailable
                    ? 'text-[#e99ca1]'
                    : 'text-[#d8dae0]'
                }
              >
                {secureStorageUnavailable
                  ? 'Cofre seguro indisponível'
                  : 'Persistente no cofre seguro'}
              </span>
            </div>

            <p className="mt-1 text-[10px] leading-4 text-[#747986]">
              {secureStorageUnavailable
                ? 'O Coach precisa do armazenamento seguro do sistema para manter esta IA conectada após fechar o aplicativo.'
                : 'A conta, o modelo e a credencial continuarão disponíveis após reiniciar o Coach.'}
            </p>
          </div>
        </div>

        <button
          disabled={
            saving
            || (
              providerType
                !== 'openai-compatible'
              && !apiKey.trim()
            )
            || secureStorageUnavailable
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
  | 'current'
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


type OmniRouteReasoningEffort =
  | 'auto'
  | 'low'
  | 'medium'
  | 'high'

type OmniRouteLogicalModel = {
  readonly id: string
  readonly label: string
  readonly familyId: string
  readonly familyLabel: string
  readonly familyOrder: number
  readonly variants: Readonly<
    Partial<
      Record<
        OmniRouteReasoningEffort,
        string
      >
    >
  >
}

type OmniRouteModelGroup = {
  readonly id: string
  readonly label: string
  readonly order: number
  readonly models:
    readonly OmniRouteLogicalModel[]
}

type ParsedOmniRouteModel = {
  readonly rawId: string
  readonly logicalId: string
  readonly effort:
    OmniRouteReasoningEffort
  readonly effortSpecificity: number
}


/*
 * IDs anunciados pelo OmniRoute possuem duas informações
 * misturadas:
 *
 * 1. qual é o modelo lógico
 * 2. qual rota/variante deve ser usada
 *
 * Exemplos:
 *
 * codex/gpt-5.6-luna-high
 * no-think/agentrouter/claude-opus-5-low
 * cx/gpt-5.6-sol-medium
 *
 * Para a interface, isso NÃO são modelos diferentes.
 */
function parseOmniRouteModel(
  rawModel: string,
): ParsedOmniRouteModel | null {
  const rawId =
    rawModel.trim()

  if (!rawId) {
    return null
  }

  const lower =
    rawId.toLowerCase()

  /*
   * Rotas automáticas do OmniRoute.
   *
   * São estratégias de roteamento, não modelos.
   */
  if (
    lower.startsWith('auto/')
  ) {
    return null
  }

  let normalized =
    lower

  /*
   * Prefixos de implementação/roteamento.
   *
   * Eles podem continuar existindo no ID físico usado
   * pelo Coach, mas não fazem parte da identidade do
   * modelo exibido para o usuário.
   */
  while (
    normalized.startsWith('no-think/')
    || normalized.startsWith('think/')
    || normalized.startsWith('cx/')
  ) {
    normalized =
      normalized.slice(
        normalized.indexOf('/')
        + 1,
      )
  }

  const pieces =
    normalized.split('/')

  let logicalId =
    pieces[
      pieces.length - 1
    ] ?? normalized

  /*
   * :free é característica da rota, não identidade
   * do modelo.
   */
  logicalId =
    logicalId.replace(
      /:free$/i,
      '',
    )

  /*
   * Ferramentas/modelos especializados que não devem
   * aparecer como IA principal do Tutor.
   *
   * A regra é baseada em categoria/padrão e não em
   * uma lista de IDs específicos.
   */
  const specialized =
    [
      /(?:^|[-_])embedding(?:$|[-_])/i,
      /(?:^|[-_])embed(?:$|[-_])/i,
      /(?:^|[-_])embedqa(?:$|[-_])/i,
      /(?:^|[-_])rerank(?:$|[-_])/i,

      /(?:^|[-_])image(?:$|[-_])/i,
      /(?:^|[-_])imagen(?:$|[-_])/i,
      /image-preview/i,
      /image-generation/i,
      /image-gen/i,

      /(?:^|[-_])video(?:$|[-_])/i,
      /(?:^|[-_])audio(?:$|[-_])/i,
      /(?:^|[-_])speech(?:$|[-_])/i,
      /(?:^|[-_])voice(?:$|[-_])/i,
      /(?:^|[-_])tts(?:$|[-_])/i,
      /tacotron/i,
      /whisper/i,
      /transcrib/i,

      /(?:^|[-_])music(?:$|[-_])/i,
      /lyria/i,

      /moderation/i,
      /content-safety/i,
      /(?:^|[-_])safety(?:$|[-_])/i,

      /auto-review/i,
    ]

  if (
    specialized.some(
      (pattern) =>
        pattern.test(
          logicalId,
        ),
    )
  ) {
    return null
  }

  /*
   * Rotas agregadoras que não representam um modelo
   * específico.
   */
  if (
    logicalId === 'free'
    || logicalId === 'codezone'
  ) {
    return null
  }

  let effort:
    OmniRouteReasoningEffort =
      'auto'

  let effortSpecificity = 0

  /*
   * Variantes de potência/raciocínio.
   *
   * O usuário escolhe isso no campo
   * "Esforço de raciocínio".
   *
   * extra-low é normalizado para low.
   */
  if (
    /-extra-low$/i.test(
      logicalId,
    )
  ) {
    logicalId =
      logicalId.replace(
        /-extra-low$/i,
        '',
      )

    effort = 'low'
    effortSpecificity = 1
  } else {
    const effortMatch =
      logicalId.match(
        /-(low|medium|high|xhigh|max|ultra)$/i,
      )

    if (effortMatch) {
      const value =
        effortMatch[1]
          ?.toLowerCase()

      logicalId =
        logicalId.replace(
          /-(low|medium|high|xhigh|max|ultra)$/i,
          '',
        )

      if (value === 'low') {
        effort = 'low'
        effortSpecificity = 0
      } else if (
        value === 'medium'
      ) {
        effort = 'medium'
        effortSpecificity = 0
      } else {
        /*
         * A UI atual possui Alto como nível máximo.
         *
         * Se uma fonte oferecer apenas xhigh/max/ultra,
         * ela ainda pode ser usada como fallback para
         * Alto, mas uma variante "-high" explícita tem
         * preferência.
         */
        effort = 'high'

        effortSpecificity =
          value === 'high'
            ? 0
            : value === 'xhigh'
              ? 1
              : value === 'max'
                ? 2
                : 3
      }
    }
  }

  /*
   * "thinking" descreve o modo da mesma família de
   * modelo, não outro modelo lógico.
   *
   * Exemplo:
   * claude-opus-4-6-thinking-high
   *      ↓
   * claude-opus-4-6
   */
  logicalId =
    logicalId.replace(
      /-thinking$/i,
      '',
    )

  if (!logicalId) {
    return null
  }

  return {
    rawId,
    logicalId,
    effort,
    effortSpecificity,
  }
}


function omniRoutePhysicalRouteRank(
  rawModel: string,
): number {
  const id =
    rawModel.toLowerCase()

  let rank = 100

  /*
   * Preferimos uma rota explícita e direta quando
   * várias fontes anunciam o mesmo modelo lógico.
   */
  if (
    id.startsWith('codex/')
  ) {
    rank = 0
  } else if (
    id.startsWith('agentrouter/')
  ) {
    rank = 10
  } else if (
    id.startsWith('antigravity/')
  ) {
    rank = 20
  } else if (
    id.startsWith('openrouter/')
  ) {
    rank = 30
  } else if (
    id.startsWith('nvidia/')
  ) {
    rank = 40
  }

  /*
   * Alias interno.
   */
  if (
    id.startsWith('cx/')
  ) {
    rank += 500
  }

  /*
   * no-think não vira outro modelo visível.
   * Só é usado como último fallback caso seja a única
   * rota disponível para aquele modelo.
   */
  if (
    id.startsWith('no-think/')
  ) {
    rank += 1000
  }

  if (
    id.includes(':free')
  ) {
    rank += 20
  }

  return rank
}


function omniRouteFamily(
  logicalId: string,
): {
  readonly id: string
  readonly label: string
  readonly order: number
} {
  const id =
    logicalId.toLowerCase()

  if (
    id.includes('claude')
  ) {
    return {
      id: 'claude',
      label: 'Claude',
      order: 30,
    }
  }

  if (
    id.includes('gemini')
  ) {
    return {
      id: 'gemini',
      label: 'Gemini',
      order: 20,
    }
  }

  if (
    id.startsWith('gpt')
    || id.includes('codex')
  ) {
    return {
      id: 'openai',
      label: 'ChatGPT / OpenAI',
      order: 10,
    }
  }

  if (
    id.includes('deepseek')
  ) {
    return {
      id: 'deepseek',
      label: 'DeepSeek',
      order: 40,
    }
  }

  if (
    id.includes('qwen')
  ) {
    return {
      id: 'qwen',
      label: 'Qwen',
      order: 50,
    }
  }

  if (
    id.includes('glm')
    || id.includes('z-ai')
    || id.includes('zai')
  ) {
    return {
      id: 'zai',
      label: 'GLM / Z.ai',
      order: 60,
    }
  }

  if (
    id.includes('gemma')
  ) {
    return {
      id: 'gemma',
      label: 'Gemma',
      order: 70,
    }
  }

  if (
    id.includes('llama')
  ) {
    return {
      id: 'llama',
      label: 'Llama',
      order: 80,
    }
  }

  if (
    id.includes('mistral')
  ) {
    return {
      id: 'mistral',
      label: 'Mistral',
      order: 90,
    }
  }

  if (
    id.includes('nemotron')
  ) {
    return {
      id: 'nemotron',
      label: 'Nemotron',
      order: 100,
    }
  }

  if (
    id.includes('minimax')
  ) {
    return {
      id: 'minimax',
      label: 'MiniMax',
      order: 110,
    }
  }

  if (
    id.includes('cohere')
  ) {
    return {
      id: 'cohere',
      label: 'Cohere',
      order: 120,
    }
  }

  return {
    id: 'other',
    label: 'Outros modelos',
    order: 999,
  }
}


function omniRouteModelLabel(
  logicalId: string,
): string {
  const special =
    new Map<string, string>([
      ['gpt', 'GPT'],
      ['oss', 'OSS'],
      ['ai', 'AI'],
      ['glm', 'GLM'],
      ['qwen', 'Qwen'],
      ['llama', 'Llama'],
      ['gemini', 'Gemini'],
      ['claude', 'Claude'],
      ['codex', 'Codex'],
      ['opus', 'Opus'],
      ['sonnet', 'Sonnet'],
      ['flash', 'Flash'],
      ['luna', 'Luna'],
      ['terra', 'Terra'],
      ['spark', 'Spark'],
      ['pro', 'Pro'],
      ['lite', 'Lite'],
      ['mini', 'Mini'],
      ['nano', 'Nano'],
    ])


  const versionedId =
    logicalId.replace(
      /(\d+)-(\d+)(?=$|-)/g,
      '$1.$2',
    )

return versionedId
    .split('-')
    .filter(Boolean)
    .map(
      (part) =>
        special.get(
          part.toLowerCase(),
        )
        ?? (
          /^[0-9.]+$/.test(part)
            ? part
            : part.charAt(0)
                .toUpperCase()
              + part.slice(1)
        ),
    )
    .join(' ')
}


function buildOmniRouteLogicalModels(
  models: readonly string[],
): readonly OmniRouteLogicalModel[] {
  type MutableLogicalModel = {
    id: string
    label: string
    familyId: string
    familyLabel: string
    familyOrder: number
    variants:
      Partial<
        Record<
          OmniRouteReasoningEffort,
          {
            id: string
            rank: number
          }
        >
      >
  }

  const logical =
    new Map<
      string,
      MutableLogicalModel
    >()

  for (
    const rawModel
    of models
  ) {
    const parsed =
      parseOmniRouteModel(
        rawModel,
      )

    if (!parsed) {
      continue
    }

    const family =
      omniRouteFamily(
        parsed.logicalId,
      )

    let entry =
      logical.get(
        parsed.logicalId,
      )

    if (!entry) {
      entry = {
        id:
          parsed.logicalId,

        label:
          omniRouteModelLabel(
            parsed.logicalId,
          ),

        familyId:
          family.id,

        familyLabel:
          family.label,

        familyOrder:
          family.order,

        variants: {},
      }

      logical.set(
        parsed.logicalId,
        entry,
      )
    }

    const rank =
      omniRoutePhysicalRouteRank(
        parsed.rawId,
      )
      + parsed.effortSpecificity

    const current =
      entry.variants[
        parsed.effort
      ]

    if (
      !current
      || rank < current.rank
    ) {
      entry.variants[
        parsed.effort
      ] = {
        id:
          parsed.rawId,

        rank,
      }
    }
  }

  return [
    ...logical.values(),
  ]
    .filter(
      (model) =>
        Object.keys(
          model.variants,
        ).length > 0,
    )
    .map(
      (model) => ({
        id:
          model.id,

        label:
          model.label,

        familyId:
          model.familyId,

        familyLabel:
          model.familyLabel,

        familyOrder:
          model.familyOrder,

        variants:
          Object.fromEntries(
            Object.entries(
              model.variants,
            ).map(
              ([effort, value]) => [
                effort,
                value?.id,
              ],
            ),
          ) as Partial<
            Record<
              OmniRouteReasoningEffort,
              string
            >
          >,
      }),
    )
    .sort(
      (left, right) =>
        left.familyOrder
        - right.familyOrder
        || left.label.localeCompare(
          right.label,
          undefined,
          {
            numeric: true,
          },
        ),
    )
}


function groupOmniRouteModels(
  models: readonly string[],
): readonly OmniRouteModelGroup[] {
  const logicalModels =
    buildOmniRouteLogicalModels(
      models,
    )

  const groups =
    new Map<
      string,
      {
        label: string
        order: number
        models:
          OmniRouteLogicalModel[]
      }
    >()

  for (
    const model
    of logicalModels
  ) {
    let group =
      groups.get(
        model.familyId,
      )

    if (!group) {
      group = {
        label:
          model.familyLabel,

        order:
          model.familyOrder,

        models: [],
      }

      groups.set(
        model.familyId,
        group,
      )
    }

    group.models.push(
      model,
    )
  }

  return [
    ...groups.entries(),
  ]
    .map(
      ([id, group]) => ({
        id,

        label:
          group.label,

        order:
          group.order,

        models:
          group.models,
      }),
    )
    .sort(
      (left, right) =>
        left.order
        - right.order,
    )
}


function omniRouteLogicalModelId(
  physicalModel: string,
): string {
  return (
    parseOmniRouteModel(
      physicalModel,
    )?.logicalId
    ?? physicalModel
  )
}


function omniRouteEffortFromPhysicalModel(
  physicalModel: string,
): OmniRouteReasoningEffort | null {
  return (
    parseOmniRouteModel(
      physicalModel,
    )?.effort
    ?? null
  )
}


function resolveOmniRoutePhysicalModel(
  models: readonly string[],
  logicalModelId: string,
  effort:
    OmniRouteReasoningEffort,
): string | null {
  const logical =
    buildOmniRouteLogicalModels(
      models,
    ).find(
      (model) =>
        model.id
        === logicalModelId,
    )

  if (!logical) {
    return null
  }

  /*
   * A escolha do esforço realmente altera o ID físico
   * enviado ao OmniRoute.
   */
  const exact =
    logical.variants[
      effort
    ]

  if (exact) {
    return exact
  }

  /*
   * Fallback seguro caso um modelo não anuncie
   * exatamente aquele nível.
   */
  return (
    logical.variants.auto
    ?? logical.variants.medium
    ?? logical.variants.high
    ?? logical.variants.low
    ?? null
  )
}


function countVisibleOmniRouteModels(
  models: readonly string[],
): number {
  return buildOmniRouteLogicalModels(
    models,
  ).length
}


function OmniRouteModelPicker({
  models,
  value,
  disabled,
  onChange,
}: {
  models: readonly string[]
  value: string
  disabled: boolean
  onChange(model: string): void
}) {
  const [open, setOpen] =
    useState(false)

  const [
    expandedGroups,
    setExpandedGroups,
  ] = useState<string[]>([])

  const groups =
    groupOmniRouteModels(
      models,
    )

  const selected =
    buildOmniRouteLogicalModels(
      models,
    ).find(
      (model) =>
        model.id === value,
    )

  const visibleCount =
    groups.reduce(
      (total, group) =>
        total
        + group.models.length,

      0,
    )

  const togglePicker = () => {
    if (disabled) {
      return
    }

    setOpen(
      (current) => {
        const next =
          !current

        /*
         * Toda abertura começa limpa/recolhida.
         */
        if (next) {
          setExpandedGroups([])
        }

        return next
      },
    )
  }

  const toggleGroup = (
    groupId: string,
  ) => {
    setExpandedGroups(
      (current) =>
        current.includes(
          groupId,
        )
          ? current.filter(
              (id) =>
                id !== groupId,
            )
          : [
              ...current,
              groupId,
            ],
    )
  }

  const selectModel = (
    model: string,
  ) => {
    /*
     * Selecionar um modelo encerra completamente
     * o seletor. O modal Editar IA continua aberto.
     */
    setOpen(false)
    setExpandedGroups([])
    onChange(model)
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={togglePicker}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#30333c] bg-[#17191f] px-4 py-3 text-left text-sm text-white outline-none transition hover:border-[#454956] focus:border-[#8c7cff] disabled:opacity-50"
      >
        <span className="min-w-0 truncate">
          {selected?.label
            ?? omniRouteModelLabel(
              value,
            )}
        </span>

        <span
          aria-hidden="true"
          className={`shrink-0 text-[#747986] transition ${
            open
              ? 'rotate-180'
              : ''
          }`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-[70] max-h-80 overflow-y-auto rounded-xl border border-[#30333c] bg-[#15171d] p-2 shadow-2xl"
        >
          {visibleCount === 0
            ? (
                <div className="px-3 py-4 text-center text-xs text-[#747986]">
                  Nenhum modelo de conversa foi encontrado.
                </div>
              )
            : groups.map(
                (group) => {
                  const expanded =
                    expandedGroups.includes(
                      group.id,
                    )

                  return (
                    <div
                      key={group.id}
                      className="border-b border-[#252831] last:border-b-0"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          toggleGroup(
                            group.id,
                          )
                        }
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition hover:bg-[#1d2028]"
                      >
                        <span
                          aria-hidden="true"
                          className={`text-xs text-[#747986] transition ${
                            expanded
                              ? 'rotate-90'
                              : ''
                          }`}
                        >
                          ›
                        </span>

                        <span className="flex-1 text-xs font-semibold text-[#d8dae0]">
                          {group.label}
                        </span>

                        <span className="rounded-md bg-[#242730] px-2 py-0.5 text-[9px] font-semibold text-[#9297a3]">
                          {group.models.length}
                        </span>
                      </button>

                      {expanded && (
                        <div className="pb-2 pl-5 pr-1">
                          {group.models.map(
                            (model) => {
                              const isSelected =
                                model.id
                                === value

                              return (
                                <button
                                  key={model.id}
                                  type="button"
                                  onClick={(event) => {
                                    /*
                                     * Evita que o clique no modelo
                                     * também acione o botão/grupo pai.
                                     */
                                    event.preventDefault()
                                    event.stopPropagation()

                                    selectModel(
                                      model.id,
                                    )
                                  }}
                                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[11px] transition ${
                                    isSelected
                                      ? 'bg-[#292244] text-[#c8beff]'
                                      : 'text-[#aeb2bd] hover:bg-[#1d2028] hover:text-white'
                                  }`}
                                >
                                  <span className="min-w-0 flex-1">
                                    {model.label}
                                  </span>

                                  {isSelected && (
                                    <span
                                      aria-hidden="true"
                                      className="shrink-0 text-[#aa9cff]"
                                    >
                                      ✓
                                    </span>
                                  )}
                                </button>
                              )
                            },
                          )}
                        </div>
                      )}
                    </div>
                  )
                },
              )}
        </div>
      )}
    </div>
  )
}





function ProviderModelPicker({
  models,
  value,
  disabled,
  onChange,
}: {
  readonly models:
    readonly string[]

  readonly value:
    string

  readonly disabled:
    boolean

  readonly onChange:
    (model: string) => void
}) {
  const [
    open,
    setOpen,
  ] = useState(false)

  const options =
    [
      ...new Set(
        models
          .map(
            (model) =>
              model.trim(),
          )
          .filter(Boolean),
      ),
    ]

  return (
    <div
      className="relative"
      onBlur={(event) => {
        const next =
          event.relatedTarget

        if (
          !(next instanceof Node)
          || !event.currentTarget
            .contains(next)
        ) {
          setOpen(false)
        }
      }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() =>
          setOpen(
            (current) =>
              !current,
          )
        }
        className={`flex w-full items-center gap-3 rounded-xl border bg-[#17191f] px-4 py-3 text-left text-sm text-white outline-none transition disabled:cursor-not-allowed disabled:opacity-50 ${
          open
            ? 'border-[#8c7cff] ring-2 ring-[#8c7cff]/35'
            : 'border-[#30333c] hover:border-[#454956]'
        }`}
      >
        <span className="min-w-0 flex-1 truncate">
          {value
            || 'Selecione um modelo'}
        </span>

        <span
          aria-hidden="true"
          className={`shrink-0 text-xs text-[#9297a3] transition ${
            open
              ? 'rotate-180 text-[#aa9cff]'
              : ''
          }`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Modelos disponíveis"
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-[140] max-h-72 overflow-y-auto rounded-xl border border-[#343743] bg-[#15171d] p-2 shadow-2xl"
        >
          {options.length > 0
            ? options.map(
                (model) => {
                  const selected =
                    model === value

                  return (
                    <button
                      key={model}
                      type="button"
                      role="option"
                      aria-selected={
                        selected
                      }
                      onClick={() => {
                        onChange(
                          model,
                        )

                        setOpen(false)
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs transition ${
                        selected
                          ? 'bg-[#292244] text-[#c8beff]'
                          : 'text-[#c1c4cd] hover:bg-[#1d2028] hover:text-white'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {model}
                      </span>

                      {selected && (
                        <span
                          aria-hidden="true"
                          className="shrink-0 font-semibold text-[#aa9cff]"
                        >
                          ✓
                        </span>
                      )}
                    </button>
                  )
                },
              )
            : (
                <div className="px-3 py-5 text-center text-xs text-[#747986]">
                  Nenhum modelo compatível disponível.
                </div>
              )}
        </div>
      )}
    </div>
  )
}


function currentAIAccountModelLabel(
  account: ProviderAccountSummary,
): string {
  if (!account.model.trim()) {
    return 'Sem modelo'
  }

  if (
    account.providerId === 'omniroute'
  ) {
    return omniRouteModelLabel(
      omniRouteLogicalModelId(
        account.model,
      ),
    )
  }

  return account.model
}



const LOCAL_OMNIROUTE_SELECTION_KEY =
  'coach.ai.omniroute.local.selection.v1'


type StoredOmniRouteSelection = {
  readonly model: string

  readonly reasoningEffort:
    | 'auto'
    | 'low'
    | 'medium'
    | 'high'
}


function isLocalOmniRouteAccount(
  account: ProviderAccountSummary,
): boolean {
  if (
    account.providerId
    !== 'omniroute'
  ) {
    return false
  }

  try {
    const url =
      new URL(
        account.baseUrl ?? '',
      )

    return (
      (
        url.hostname === '127.0.0.1'
        || url.hostname === 'localhost'
        || url.hostname === '[::1]'
      )
      && url.port === '20128'
    )
  } catch {
    return false
  }
}


function readStoredOmniRouteSelection():
  StoredOmniRouteSelection | null {
  try {
    const value =
      window.localStorage.getItem(
        LOCAL_OMNIROUTE_SELECTION_KEY,
      )

    if (!value) {
      return null
    }

    const parsed =
      JSON.parse(value) as
        Partial<StoredOmniRouteSelection>

    if (
      typeof parsed.model
      !== 'string'
      || parsed.model.trim().length
        === 0
    ) {
      return null
    }

    if (
      parsed.reasoningEffort
      !== 'auto'
      && parsed.reasoningEffort
        !== 'low'
      && parsed.reasoningEffort
        !== 'medium'
      && parsed.reasoningEffort
        !== 'high'
    ) {
      return null
    }

    return {
      model:
        parsed.model,

      reasoningEffort:
        parsed.reasoningEffort,
    }
  } catch {
    return null
  }
}


function storeOmniRouteSelection(
  model: string,
  reasoningEffort:
    | 'auto'
    | 'low'
    | 'medium'
    | 'high',
): void {
  try {
    window.localStorage.setItem(
      LOCAL_OMNIROUTE_SELECTION_KEY,
      JSON.stringify({
        model,
        reasoningEffort,
      }),
    )
  } catch {
    /*
     * A preferência é auxiliar.
     * Uma falha no armazenamento local
     * não pode tornar a edição da IA inválida.
     */
  }
}


function ProviderLogo({
  account,
  large = false,
}: {
  readonly account:
    ProviderAccountSummary

  readonly large?: boolean
}) {
  const sizeClass =
    large
      ? 'size-10'
      : 'size-9'

  if (
    account.providerId === 'gemini'
  ) {
    const gradientId =
      `gemini-logo-${account.id}`

    return (
      <span
        className={`${sizeClass} grid shrink-0 place-items-center rounded-xl bg-[#20242d]`}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-[70%]"
        >
          <defs>
            <linearGradient
              id={gradientId}
              x1="3"
              y1="20"
              x2="21"
              y2="4"
              gradientUnits="userSpaceOnUse"
            >
              <stop
                stopColor="#08B962"
              />
              <stop
                offset="0.34"
                stopColor="#3186FF"
              />
              <stop
                offset="0.68"
                stopColor="#A142F4"
              />
              <stop
                offset="1"
                stopColor="#F94543"
              />
            </linearGradient>
          </defs>

          <path
            d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"
            fill={`url(#${gradientId})`}
          />
        </svg>
      </span>
    )
  }

  if (
    account.providerId === 'omniroute'
  ) {
    const gradientId =
      `omniroute-logo-${account.id}`

    return (
      <span
        className={`${sizeClass} shrink-0 overflow-hidden rounded-xl`}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 192 192"
          className="size-full"
        >
          <defs>
            <linearGradient
              id={gradientId}
              x1="0"
              y1="0"
              x2="192"
              y2="192"
              gradientUnits="userSpaceOnUse"
            >
              <stop
                stopColor="#E54D5E"
              />
              <stop
                offset="1"
                stopColor="#C93D4E"
              />
            </linearGradient>
          </defs>

          <rect
            width="192"
            height="192"
            rx="36"
            fill={`url(#${gradientId})`}
          />

          <g
            stroke="white"
            strokeWidth="7"
            strokeLinecap="round"
          >
            <line
              x1="96"
              y1="78"
              x2="48"
              y2="48"
            />
            <line
              x1="96"
              y1="78"
              x2="144"
              y2="48"
            />
            <line
              x1="96"
              y1="114"
              x2="48"
              y2="144"
            />
            <line
              x1="96"
              y1="114"
              x2="144"
              y2="144"
            />
            <line
              x1="96"
              y1="78"
              x2="96"
              y2="30"
            />
            <line
              x1="96"
              y1="114"
              x2="96"
              y2="162"
            />
          </g>

          <g fill="white">
            <circle
              cx="96"
              cy="96"
              r="18"
            />
            <circle
              cx="48"
              cy="48"
              r="12"
            />
            <circle
              cx="144"
              cy="48"
              r="12"
            />
            <circle
              cx="48"
              cy="144"
              r="12"
            />
            <circle
              cx="144"
              cy="144"
              r="12"
            />
            <circle
              cx="96"
              cy="30"
              r="9"
            />
            <circle
              cx="96"
              cy="162"
              r="9"
            />
          </g>
        </svg>
      </span>
    )
  }

  if (
    account.providerId === 'openai'
  ) {
    return (
      <span
        className={`${sizeClass} grid shrink-0 place-items-center rounded-xl bg-[#f1f1f1] text-[#111]`}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-[68%]"
          fill="currentColor"
        >
          <path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" />
        </svg>
      </span>
    )
  }

  return (
    <span
      className={`${sizeClass} grid shrink-0 place-items-center rounded-xl bg-[#20242d] text-[#aa9cff]`}
      aria-hidden="true"
    >
      <Sparkles
        size={large ? 20 : 17}
      />
    </span>
  )
}


function accountRuntimePresentation(
  account: ProviderAccountSummary,
  issue:
    ProviderRuntimeIssue | undefined,
  status: ProviderStatus | null,
  health:
    ProviderAccountHealthSnapshot | undefined,
) {
  if (!account.isEnabled) {
    return {
      label:
        'Desativada',

      detail:
        'Esta IA está desativada no Coach.',

      className:
        'bg-[#202229] text-[#747986]',
    }
  }

  if (
    health?.connectionState
      === 'unreachable'
  ) {
    return {
      label:
        'Sem conexão',

      detail:
        'Não foi possível se comunicar com esta IA.',

      className:
        'bg-[#392b1b] text-[#e8b96d]',
    }
  }

  const effectiveIssue =
    issue
    ?? health?.runtimeIssue
    ?? undefined

  if (
    !effectiveIssue
    && account.isActive
    && account.model.trim()
    && status?.activeAccountId
      === account.id
    && status.connectionState
      !== 'connected'
    && status.connectionState
      !== 'unreachable'
  ) {
    return {
      label:
        'Conectando...',

      detail:
        'Verificando conexão, autenticação e acesso ao modelo.',

      className:
        'bg-[#1f2d35] text-[#82bdd8]',
    }
  }

  switch (effectiveIssue) {
    case 'available':
      return {
        label:
          'Funcionando',

        detail:
          'Esta IA respondeu normalmente na última tentativa.',

        className:
          'bg-[#163329] text-[#72d7aa]',
      }

    case 'usage-limit':
      return {
        label:
          'Limite de uso atingido',

        detail:
          'Esta IA não pode responder agora. Escolha outro modelo ou outra IA.',

        className:
          'bg-[#392b1b] text-[#e8b96d]',
      }

    case 'temporarily-unavailable':
      return {
        label:
          'Indisponível agora',

        detail:
          account.providerId === 'omniroute'
            ? 'O OmniRoute continua acessível, mas o modelo atual não conseguiu responder funcionalmente.'
            : 'A conexão existe, mas esta IA não conseguiu responder funcionalmente agora.',

        className:
          'bg-[#392b1b] text-[#e8b96d]',
      }

    case 'model-unavailable':
      return {
        label:
          'Modelo indisponível',

        detail:
          account.providerId === 'omniroute'
            ? 'O OmniRoute está acessível, mas o modelo selecionado não está disponível para uso pelo Coach.'
            : 'O modelo selecionado não pode ser usado. Escolha outro modelo.',

        className:
          'bg-[#392b1b] text-[#e8b96d]',
      }

    case 'access-restricted':
      return {
        label:
          'Acesso restrito',

        detail:
          'O plano, a organização, a política ou a região não permite usar esta IA.',

        className:
          'bg-[#392b1b] text-[#e8b96d]',
      }

    case 'reauth-required':
      return {
        label:
          'Reconecte a conta',

        detail:
          'O acesso desta conta precisa ser renovado.',

        className:
          'bg-[#392b1b] text-[#e8b96d]',
      }
  }

  const healthConnected =
    health?.connectionState
      === 'connected'

  const activeConnected =
    account.isActive
    && status?.activeAccountId
      === account.id
    && status.connectionState
      === 'connected'

  if (
    healthConnected
    || activeConnected
  ) {
    if (!account.model.trim()) {
      return {
        label:
          'Sem modelo',

        detail:
          'A conexão está funcionando, mas não há um modelo disponível para esta IA.',

        className:
          'bg-[#392b1b] text-[#e8b96d]',
      }
    }

    return {
      label:
        'Conectado',

      detail:
        'Endpoint, autenticação e modelo estão acessíveis. O funcionamento é confirmado após uma resposta real do Coach.',

      className:
        'bg-[#163329] text-[#72d7aa]',
    }
  }

  if (
    account.isActive
    && status?.activeAccountId
      === account.id
  ) {
    if (
      status.quota
      === 'exhausted'
    ) {
      return {
        label:
          'Limite de uso atingido',

        detail:
          'Esta IA não pode responder agora. Escolha outro modelo ou outra IA.',

        className:
          'bg-[#392b1b] text-[#e8b96d]',
      }
    }

    if (
      status.connectionState
      === 'unreachable'
    ) {
      return {
        label:
          'Sem conexão',

        detail:
          'Não foi possível se comunicar com esta IA.',

        className:
          'bg-[#392b1b] text-[#e8b96d]',
      }
    }

    return {
      label:
        'Verificando',

      detail:
        'O Coach está verificando a disponibilidade desta IA.',

      className:
        'bg-[#202229] text-[#8b909c]',
    }
  }

  return {
    label:
      'Verificando',

    detail:
      'O Coach está verificando a disponibilidade desta IA.',

    className:
      'bg-[#202229] text-[#8b909c]',
  }
}


function formatProviderActivityTime(
  timestamp: number,
): string {
  return new Intl.DateTimeFormat(
    'pt-BR',
    {
      dateStyle:
        'short',

      timeStyle:
        'short',
    },
  ).format(
    new Date(timestamp),
  )
}


function CurrentAISelection({
  status,
  accounts,
  runtimeIssues = {},
  healthSnapshots = {},
  lastActivities = {},
  connectingAccountId = null,
  onSelect,
  onSetEnabled,
  onListModels,
  onUpdate,
  onRemove,
  onCompleteGitHubCopilotOAuth,
  onConnect,
}: Pick<
  AIConnectionPageProps,
  | 'status'
  | 'accounts'
  | 'runtimeIssues'
  | 'healthSnapshots'
  | 'lastActivities'
  | 'connectingAccountId'
  | 'onSelect'
  | 'onSetEnabled'
  | 'onListModels'
  | 'onUpdate'
  | 'onRemove'
  | 'onCompleteGitHubCopilotOAuth'
> & {
  onConnect(): void
}) {
  const dropDepth = useRef(0)


  const restoredOmniRouteSelectionRef =
    useRef<string | null>(null)

const [
    draggingAccountId,
    setDraggingAccountId,
  ] = useState<string | null>(null)

  const [
    switchingAccountId,
    setSwitchingAccountId,
  ] = useState<string | null>(null)

  const [
    busyAccountId,
    setBusyAccountId,
  ] = useState<string | null>(null)

  const reconnectAccount = async (
    account: ProviderAccountSummary,
  ) => {
    setBusyAccountId(account.id)
    setManagerError(null)

    try {
      const started =
        await window.coach.provider
          .beginGitHubCopilotOAuth(
          account.id,
        )

      if (!started.ok) {
        throw new Error(started.code)
      }

      const completed =
        await onCompleteGitHubCopilotOAuth(
          started.authorization.flowId,
        )

      if (!completed.ok) {
        throw new Error(completed.code)
      }
    } catch {
      setManagerError(
        'Não foi possível reconectar esta conta do GitHub.',
      )
    } finally {
      setBusyAccountId(null)
    }
  }

  const [
    openMenuAccountId,
    setOpenMenuAccountId,
  ] = useState<string | null>(null)

  const [
    dropActive,
    setDropActive,
  ] = useState(false)

  const [
    managerError,
    setManagerError,
  ] = useState<string | null>(null)

  const [
    editingAccount,
    setEditingAccount,
  ] = useState<
    ProviderAccountSummary | null
  >(null)

  const [
    editLabel,
    setEditLabel,
  ] = useState('')

  const [
    editModel,
    setEditModel,
  ] = useState('')

  const [
    editReasoningEffort,
    setEditReasoningEffort,
  ] = useState<
    'auto'
    | 'low'
    | 'medium'
    | 'high'
  >('auto')

  const [
    availableModels,
    setAvailableModels,
  ] = useState<string[]>([])

  const [
    modelsLoading,
    setModelsLoading,
  ] = useState(false)

  const [
    modelsError,
    setModelsError,
  ] = useState<string | null>(null)

  const [
    editSaving,
    setEditSaving,
  ] = useState(false)

  const [
    editError,
    setEditError,
  ] = useState<string | null>(null)

  const activeAccount =
    accounts.find(
      (account) =>
        account.isActive,
    ) ?? null

  const activePresentation =
    activeAccount
      ? (
          connectingAccountId
            === activeAccount.id
            ? {
                label:
                  'Conectando...',

                detail:
                  'Verificando conexão, autenticação e acesso ao modelo.',

                className:
                  'bg-[#1f2d35] text-[#82bdd8]',
              }
            : accountRuntimePresentation(
                activeAccount,
                runtimeIssues[
                  activeAccount.id
                ],
                status,
                healthSnapshots[
                  activeAccount.id
                ],
              )
        )
      : null

  const activeActivity =
    activeAccount
      ? lastActivities[
          activeAccount.id
        ]
      : undefined

  const otherAccounts =
    accounts.filter(
      (account) =>
        !account.isActive,
    )

  useEffect(
    function restoreStoredOmniRouteSelection() {
      const stored =
        readStoredOmniRouteSelection()

      if (!stored) {
        return
      }

      const account =
        accounts.find(
          isLocalOmniRouteAccount,
        )

      if (!account) {
        return
      }

      /*
       * Uma conexão OmniRoute nova deve
       * permanecer sem modelo.
       *
       * Não restauramos silenciosamente uma
       * seleção antiga de outra conexão salva
       * no localStorage.
       */
      if (!account.model.trim()) {
        return
      }

      const restorationKey =
        [
          account.id,
          stored.model,
          stored.reasoningEffort,
        ].join(':')

      if (
        restoredOmniRouteSelectionRef.current
        === restorationKey
      ) {
        return
      }

      if (
        account.model
          === stored.model
        && account.reasoningEffort
          === stored.reasoningEffort
      ) {
        restoredOmniRouteSelectionRef.current =
          restorationKey

        return
      }

      restoredOmniRouteSelectionRef.current =
        restorationKey

      void onUpdate(
        account.id,
        account.label,
        stored.model,
        stored.reasoningEffort,
      ).catch(() => {
        /*
         * Permite uma nova tentativa caso
         * a conta ainda não esteja pronta.
         */
        restoredOmniRouteSelectionRef.current =
          null
      })
    },
    [
      accounts,
      onUpdate,
    ],
  )




  const useAccount = async (
    accountId: string,
  ) => {
    const account =
      accounts.find(
        (item) =>
          item.id === accountId,
      )

    if (
      !account
      || !account.isEnabled
      || account.isActive
    ) {
      return
    }

    setSwitchingAccountId(
      accountId,
    )

    setManagerError(null)

    try {
      await onSelect(
        accountId,
      )
    } catch {
      setManagerError(
        'Não foi possível definir esta IA como ativa.',
      )
    } finally {
      setSwitchingAccountId(null)
      setDraggingAccountId(null)
      setDropActive(false)
    }
  }


  const toggleAccount = async (
    account: ProviderAccountSummary,
  ) => {
    if (busyAccountId) {
      return
    }

    setBusyAccountId(
      account.id,
    )

    setManagerError(null)

    try {
      await onSetEnabled(
        account.id,
        !account.isEnabled,
      )
    } catch {
      setManagerError(
        account.isEnabled
          ? 'Não foi possível desativar esta IA.'
          : 'Não foi possível ativar esta IA.',
      )
    } finally {
      setBusyAccountId(null)
    }
  }


  const removeAccount = async (
    account: ProviderAccountSummary,
  ) => {
    setOpenMenuAccountId(null)

    const confirmed =
      window.confirm(
        `Apagar "${account.label}" do Coach?`,
      )

    if (!confirmed) {
      return
    }

    setBusyAccountId(
      account.id,
    )

    setManagerError(null)

    try {
      await onRemove(
        account.id,
      )
    } catch {
      setManagerError(
        'Não foi possível apagar esta IA.',
      )
    } finally {
      setBusyAccountId(null)
    }
  }


  const loadAvailableModels = async (
    account: ProviderAccountSummary,
  ) => {
    const currentModel =
      account.model.trim()

    setModelsLoading(true)
    setModelsError(null)

    try {
      const models =
        await onListModels(
          account.id,
        )

      setAvailableModels(
        [
          ...new Set([
            ...(
              currentModel
                ? [currentModel]
                : []
            ),
            ...models,
          ]),
        ],
      )
    } catch {
      setAvailableModels(
        currentModel
          ? [currentModel]
          : [],
      )

      setModelsError(
        'Não foi possível carregar os modelos deste provedor.',
      )
    } finally {
      setModelsLoading(false)
    }
  }


  const openEditor = (
    account: ProviderAccountSummary,
  ) => {
    setOpenMenuAccountId(null)
    setEditingAccount(account)
    setEditLabel(account.label)
    setEditError(null)
    setModelsError(null)

    if (
      account.providerId
      === 'omniroute'
    ) {
      setEditModel(
        account.model.trim()
          ? omniRouteLogicalModelId(
              account.model,
            )
          : '',
      )

      const physicalEffort =
        account.model.trim()
          ? omniRouteEffortFromPhysicalModel(
              account.model,
            )
          : null

      setEditReasoningEffort(
        physicalEffort
        && physicalEffort !== 'auto'
          ? physicalEffort
          : account.reasoningEffort,
      )

      setAvailableModels(
        account.model.trim()
          ? [account.model]
          : [],
      )

      void loadAvailableModels(
        account,
      )
    } else {
      setEditModel(
        account.model,
      )

      setEditReasoningEffort(
        account.reasoningEffort,
      )

      /*
       * Todas as IAs usam seletor de modelos.
       * Começamos pelo modelo atualmente salvo para que
       * o campo nunca fique vazio enquanto a descoberta
       * remota está em andamento.
       */
      setAvailableModels(
        account.model.trim()
          ? [account.model]
          : [],
      )

      void loadAvailableModels(
        account,
      )
    }
  }


  const closeEditor = () => {
    if (editSaving) {
      return
    }

    setEditingAccount(null)
    setEditError(null)
    setModelsError(null)
    setAvailableModels([])
  }


  const saveEditedAccount =
    async () => {
      if (!editingAccount) {
        return
      }

      const label =
        editLabel.trim()

      if (
        label.length < 1
        || label.length > 60
      ) {
        setEditError(
          'O nome deve ter entre 1 e 60 caracteres.',
        )
        return
      }

      const model =
        editingAccount.providerId
        === 'omniroute'
          ? resolveOmniRoutePhysicalModel(
              availableModels,
              editModel,
              editReasoningEffort,
            )
          : editModel.trim()

      if (!model) {
        setEditError(
          editModel.trim()
            ? 'Não existe uma variante compatível com esse esforço de raciocínio.'
            : 'Selecione um modelo antes de salvar.',
        )
        return
      }

      setEditSaving(true)
      setEditError(null)

      try {
        await onUpdate(
          editingAccount.id,
          label,
          model,
          editReasoningEffort,
        )

        if (
          isLocalOmniRouteAccount(
            editingAccount,
          )
        ) {
          storeOmniRouteSelection(
            model,
            editReasoningEffort,
          )
        }


        setEditingAccount(null)
      } catch {
        setEditError(
          'Não foi possível salvar as alterações.',
        )
      } finally {
        setEditSaving(false)
      }
    }


  const accountMenu = (
    account: ProviderAccountSummary,
  ) => (
    <div className="relative">
      <button
        type="button"
        aria-label={`Opções de ${account.label}`}
        onClick={() =>
          setOpenMenuAccountId(
            (current) =>
              current === account.id
                ? null
                : account.id,
          )
        }
        className="grid size-8 place-items-center rounded-lg text-lg text-[#747986] transition hover:bg-[#242730] hover:text-white"
      >
        •••
      </button>

      {openMenuAccountId
        === account.id && (
        <div className="absolute right-0 top-10 z-40 w-44 rounded-xl border border-[#343743] bg-[#17191f] p-2 shadow-2xl">
          {account.providerId === 'github-copilot'
            && (
              runtimeIssues[account.id]
                === 'reauth-required'
              || healthSnapshots[account.id]
                ?.runtimeIssue
                === 'reauth-required'
            ) && (
            <button
              type="button"
              onClick={() => {
                setOpenMenuAccountId(null)
                void reconnectAccount(account)
              }}
              className="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-semibold text-[#8fd5b5] transition hover:bg-[#173126] hover:text-white"
            >
              ↻ Reconectar GitHub
            </button>
          )}

          <button
            type="button"
            onClick={() =>
              openEditor(account)
            }
            className="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-semibold text-[#d7d9df] transition hover:bg-[#292244] hover:text-white"
          >
            ✎ Editar
          </button>

          <button
            type="button"
            onClick={() =>
              void removeAccount(
                account,
              )
            }
            className="mt-1 flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-semibold text-[#e99ca1] transition hover:bg-[#2b181c]"
          >
            ♲ Apagar
          </button>
        </div>
      )}
    </div>
  )


  const accessToggle = (
    account: ProviderAccountSummary,
  ) => (
    <button
      type="button"
      role="switch"
      aria-checked={
        account.isEnabled
      }
      aria-label={
        account.isEnabled
          ? `Desativar ${account.label}`
          : `Ativar ${account.label}`
      }
      disabled={
        busyAccountId !== null
      }
      onClick={() =>
        void toggleAccount(
          account,
        )
      }
      className={`relative h-6 w-11 shrink-0 rounded-full border transition disabled:opacity-50 ${
        account.isEnabled
          ? 'border-[#8c7cff] bg-[#6f5de7]'
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
  )


  if (accounts.length === 0) {
    return (
      <section className="mt-6">
        <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-[#292c35] bg-[#111217] px-6 py-12 text-center">
          <span className="grid size-16 place-items-center rounded-2xl bg-[#292244] text-2xl text-[#8c7cff]">
            ✦
          </span>

          <h2 className="mt-6 text-xl font-semibold text-white">
            Nenhuma IA conectada
          </h2>

          <p className="mt-2 max-w-md text-sm leading-6 text-[#9297a3]">
            Conecte uma IA para escolher o modelo que o Coach deve usar.
          </p>

          <button
            type="button"
            onClick={onConnect}
            className="mt-6 rounded-xl bg-[#8c7cff] px-5 py-3 text-xs font-bold text-[#0c0d10] transition hover:bg-[#aa9cff]"
          >
            + Conectar IA
          </button>
        </div>
      </section>
    )
  }


  return (
    <section className="mt-6">
      {managerError && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-[#55353a] bg-[#211417] px-4 py-3 text-xs text-[#e99ca1]"
        >
          {managerError}
        </div>
      )}

      <div
        onDragEnter={(event) => {
          if (!draggingAccountId) {
            return
          }

          event.preventDefault()

          dropDepth.current += 1

          if (
            dropDepth.current === 1
          ) {
            setDropActive(true)
          }
        }}
        onDragOver={(event) => {
          if (!draggingAccountId) {
            return
          }

          event.preventDefault()

          event.dataTransfer.dropEffect =
            'move'
        }}
        onDragLeave={(event) => {
          if (!draggingAccountId) {
            return
          }

          event.preventDefault()

          dropDepth.current =
            Math.max(
              0,
              dropDepth.current - 1,
            )

          if (
            dropDepth.current === 0
          ) {
            setDropActive(false)
          }
        }}
        onDrop={(event) => {
          event.preventDefault()

          dropDepth.current = 0

          const accountId =
            event.dataTransfer.getData(
              'application/x-coach-provider-account',
            )
            || draggingAccountId

          setDropActive(false)

          if (accountId) {
            void useAccount(
              accountId,
            )
          }
        }}
        className={`rounded-2xl border p-5 transition ${
          dropActive
            ? 'border-[#aa9cff] bg-[#181622]'
            : 'border-[#554c91] bg-[#111217]'
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-lg bg-[#211d3d] text-[#aa9cff]">
                ✦
              </span>

              <strong className="text-sm text-white">
                Ativo agora
              </strong>
            </div>

            <p className="mt-1 pl-9 text-xs text-[#747986]">
              As próximas conversas usarão esta configuração
            </p>
          </div>

          {activeAccount && activePresentation && (
            <span
              title={activePresentation.detail}
              className={`rounded-full px-3 py-1 text-[10px] font-bold transition-all duration-300 ease-out ${activePresentation.label === 'Conectando...' ? 'animate-pulse' : ''} ${activePresentation.className}`}
            >
              ● {activePresentation.label}
            </span>
          )}
        </div>

        <div className="mt-4">
          {activeAccount
            ? (
                <article className="relative flex items-center gap-4 rounded-xl border border-[#30333c] bg-[#191b22] px-5 py-4">


                  <ProviderLogo
                    account={activeAccount}
                    large
                  />

                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-sm text-white">
                      {activeAccount.label}
                    </strong>

                    <span className="mt-1 block truncate text-[11px] text-[#747986]">
                      {providerDisplayName(
                        activeAccount,
                      )}

                      {activeAccount.identityLabel
                        ? ` • ${activeAccount.identityLabel}`
                        : ''}
                    </span>
                  </div>

                  <span className="max-w-[32%] truncate rounded-lg bg-[#242730] px-3 py-1.5 text-[10px] font-semibold text-[#b7bbc5]">
                    {currentAIAccountModelLabel(
                      activeAccount,
                    )}
                  </span>

                  {accessToggle(
                    activeAccount,
                  )}

                  {accountMenu(
                    activeAccount,
                  )}
                </article>
              )
            : (
                <div className="rounded-xl border border-dashed border-[#3b3e49] bg-[#15161b] px-5 py-8 text-center">
                  <strong className="text-sm text-white">
                    Nenhuma IA ativa
                  </strong>

                  <p className="mt-1 text-xs text-[#747986]">
                    Ative uma IA e arraste o bloco dela para cá.
                  </p>
                </div>
              )}
        </div>

        {activeAccount && activeActivity && (
          <div className="mt-3 rounded-xl border border-[#2d3039] bg-[#15161b] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#747986]">
                Última utilização
              </span>

              <strong
                className={`text-[10px] ${
                  activeActivity.outcome === 'success'
                    ? 'text-[#72d7aa]'
                    : 'text-[#e8b96d]'
                }`}
              >
                {activeActivity.outcome === 'success'
                  ? 'Funcionou'
                  : 'Falhou'}
                {' · '}
                {formatProviderActivityTime(
                  activeActivity.at,
                )}
              </strong>
            </div>

            <p className="mt-2 text-[11px] leading-5 text-[#a5a9b3]">
              {activeActivity.detail}
            </p>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-[#626773]">
              <span>
                Modelo:{' '}
                {activeActivity.model || 'não informado'}
              </span>

              <span className="font-mono">
                Código:{' '}
                {activeActivity.code ?? '—'}
              </span>
            </div>
          </div>
        )}

        {dropActive && (
          <p className="mt-3 text-center text-xs font-semibold text-[#aa9cff]">
            Solte para tornar esta a IA atual
          </p>
        )}
      </div>


      <div className="mt-6 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">
            Suas IAs
          </h2>

          <p className="mt-1 text-xs text-[#747986]">
            Ative, configure ou arraste uma IA para trocar a configuração atual.
          </p>
        </div>

        <button
          type="button"
          onClick={onConnect}
          className="rounded-lg border border-[#343743] px-3 py-2 text-[10px] font-semibold text-[#b7bbc5] transition hover:border-[#8c7cff] hover:text-white"
        >
          + Conectar IA
        </button>
      </div>


      {otherAccounts.length > 0
        ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {otherAccounts.map(
                (account) => {
                  const canDrag =
                    account.isEnabled
                    && switchingAccountId
                      === null

                  const dragging =
                    draggingAccountId
                    === account.id

                  const accountPresentation =
                    accountRuntimePresentation(
                      account,
                      runtimeIssues[
                        account.id
                      ],
                      status,
                      healthSnapshots[
                        account.id
                      ],
                    )

                  const accountActivity =
                    lastActivities[
                      account.id
                    ]

                  return (
                    <article
                      key={account.id}
                      className={`relative rounded-xl border bg-[#13151a] p-4 transition ${
                        account.isEnabled
                          ? 'border-[#2d3039]'
                          : 'border-[#262830] opacity-60'
                      } ${
                        dragging
                          ? 'opacity-60'
                          : ''
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          draggable={
                            account.isEnabled
                            && switchingAccountId === null
                          }
                          disabled={
                            !account.isEnabled
                            || switchingAccountId !== null
                          }
                          aria-label={`Arrastar ${account.label}`}
                          title={
                            account.isEnabled
                              ? 'Arraste para trocar a IA atual'
                              : 'Ative esta IA para poder arrastar'
                          }
                          onDragStart={(event) => {
                            if (
                              !account.isEnabled
                              || switchingAccountId !== null
                            ) {
                              event.preventDefault()
                              return
                            }

                            setDraggingAccountId(
                              account.id,
                            )

                            event.dataTransfer.effectAllowed =
                              'move'

                            event.dataTransfer.setData(
                              'application/x-coach-provider-account',
                              account.id,
                            )
                          }}
                          onDragEnd={() => {
                            setDraggingAccountId(
                              null,
                            )

                            setDropActive(
                              false,
                            )
                          }}
                          className={`mt-0.5 grid h-8 w-7 shrink-0 place-items-center rounded-md text-base transition ${
                            account.isEnabled
                            && switchingAccountId === null
                              ? 'cursor-grab text-[#747986] hover:bg-[#242730] hover:text-[#aa9cff] active:cursor-grabbing'
                              : 'cursor-not-allowed text-[#383b45]'
                          }`}
                        >
                          ⠿
                        </button>

                        <ProviderLogo
                          account={account}
                        />

                        <div className="min-w-0 flex-1">
                          <strong className="block truncate text-sm text-[#e7e8eb]">
                            {account.label}
                          </strong>

                          <span className="mt-1 block truncate text-[10px] text-[#747986]">
                            {providerDisplayName(
                              account,
                            )}

                            {account.identityLabel
                              ? ` • ${account.identityLabel}`
                              : ''}
                          </span>
                        </div>

                        {accessToggle(
                          account,
                        )}

                        {accountMenu(
                          account,
                        )}
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-3">
                        <span className="max-w-[75%] truncate rounded-lg bg-[#202229] px-3 py-1.5 text-[10px] font-semibold text-[#969ba7]">
                          {currentAIAccountModelLabel(
                            account,
                          )}
                        </span>

                        <span
                          title={accountPresentation.detail}
                          className={`rounded-full px-2.5 py-1 text-[9px] font-semibold transition-all duration-300 ease-out ${accountPresentation.className}`}
                        >
                          ● {accountPresentation.label}
                        </span>
                      </div>

                      {accountActivity && (
                        <div className="mt-3 border-t border-[#252831] pt-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#626773]">
                              Última utilização
                            </span>

                            <span
                              className={`text-[9px] font-semibold ${
                                accountActivity.outcome === 'success'
                                  ? 'text-[#72d7aa]'
                                  : 'text-[#e8b96d]'
                              }`}
                            >
                              {accountActivity.outcome === 'success'
                                ? 'Funcionou'
                                : 'Falhou'}
                              {' · '}
                              {formatProviderActivityTime(
                                accountActivity.at,
                              )}
                            </span>
                          </div>

                          <p className="mt-1 text-[10px] leading-4 text-[#898e99]">
                            {accountActivity.detail}
                          </p>

                          <span className="mt-1 block font-mono text-[8px] text-[#555a66]">
                            {accountActivity.code ?? '—'}
                          </span>
                        </div>
                      )}
                    </article>
                  )
                },
              )}
            </div>
          )
        : (
            <div className="mt-4 rounded-xl border border-dashed border-[#292c35] px-5 py-8 text-center text-xs text-[#747986]">
              Todas as IAs conectadas já estão representadas acima.
            </div>
          )}


      <div className="mt-8 rounded-xl border border-[#2e2948] bg-[#12111b] px-4 py-3 text-[11px] text-[#898e99]">
        Desativar uma IA apenas remove temporariamente o acesso do Coach.
        A conta continua configurada e pode ser ativada novamente.
      </div>


      {editingAccount && (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target
              === event.currentTarget
            ) {
              closeEditor()
            }
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-current-ai-title"
            onSubmit={(event) => {
              event.preventDefault()
              void saveEditedAccount()
            }}
            className="w-full max-w-lg rounded-2xl border border-[#30333c] bg-[#111217] shadow-2xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-[#292c35] px-6 py-5">
              <div>
                <h2
                  id="edit-current-ai-title"
                  className="text-lg font-semibold text-white"
                >
                  Editar IA
                </h2>

                <p className="mt-1 text-xs text-[#747986]">
                  {providerDisplayName(
                    editingAccount,
                  )}
                </p>
              </div>

              <button
                type="button"
                onClick={closeEditor}
                className="grid size-8 place-items-center rounded-lg text-[#747986] transition hover:bg-[#242730] hover:text-white"
              >
                ×
              </button>
            </header>

            <div className="space-y-5 px-6 py-5">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-[#c6c9d1]">
                  Nome
                </span>

                <input
                  type="text"
                  value={editLabel}
                  maxLength={60}
                  disabled={editSaving}
                  onChange={(event) =>
                    setEditLabel(
                      event.target.value,
                    )
                  }
                  className="w-full rounded-xl border border-[#30333c] bg-[#17191f] px-4 py-3 text-sm text-white outline-none transition focus:border-[#8c7cff] disabled:opacity-50"
                />
              </label>


              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-[#c6c9d1]">
                  Modelo
                </span>

                {editingAccount.providerId
                  === 'omniroute'
                  ? (
                      <>
                        <OmniRouteModelPicker
                          key={`${availableModels.join('|')}::${editModel}`}
                          models={
                            availableModels
                          }
                          value={editModel}
                          disabled={
                            editSaving
                          }
                          onChange={
                            setEditModel
                          }
                        />

                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[10px] text-[#626773]">
                            {countVisibleOmniRouteModels(
                              availableModels,
                            )}
                            {' '}
                            modelos
                          </span>

                          <button
                            type="button"
                            disabled={
                              editSaving
                              || modelsLoading
                            }
                            onClick={() =>
                              void loadAvailableModels(
                                editingAccount,
                              )
                            }
                            className="text-[11px] font-semibold text-[#aa9cff] transition hover:text-white disabled:opacity-50"
                          >
                            {modelsLoading
                              ? 'Atualizando...'
                              : '↻ Atualizar modelos'}
                          </button>
                        </div>

                        {modelsError && (
                          <p className="mt-2 text-[11px] text-[#e99ca1]">
                            {modelsError}
                          </p>
                        )}
                      </>
                    )
                  : (
                      <>
                        <ProviderModelPicker
                          key={`${editingAccount.id}::${availableModels.join('|')}::${editModel}`}
                          models={
                            availableModels
                          }
                          value={
                            editModel
                          }
                          disabled={
                            editSaving
                            || modelsLoading
                          }
                          onChange={
                            setEditModel
                          }
                        />

                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[10px] text-[#626773]">
                            {availableModels.length}
                            {' '}
                            {availableModels.length === 1
                              ? 'modelo'
                              : 'modelos'}
                          </span>

                          <button
                            type="button"
                            disabled={
                              editSaving
                              || modelsLoading
                            }
                            onClick={() =>
                              void loadAvailableModels(
                                editingAccount,
                              )
                            }
                            className="text-[11px] font-semibold text-[#aa9cff] transition hover:text-white disabled:opacity-50"
                          >
                            {modelsLoading
                              ? 'Atualizando...'
                              : '↻ Atualizar modelos'}
                          </button>
                        </div>

                        {modelsError && (
                          <p className="mt-2 text-[11px] text-[#e99ca1]">
                            {modelsError}
                          </p>
                        )}
                      </>
                    )}
              </label>


              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-[#c6c9d1]">
                  Esforço de raciocínio
                </span>

                <select
                  value={
                    editReasoningEffort
                  }
                  disabled={editSaving}
                  onChange={(event) =>
                    setEditReasoningEffort(
                      event.target.value as
                        | 'auto'
                        | 'low'
                        | 'medium'
                        | 'high',
                    )
                  }
                  className="w-full rounded-xl border border-[#30333c] bg-[#17191f] px-4 py-3 text-sm text-white outline-none transition focus:border-[#8c7cff] disabled:opacity-50"
                >
                  <option value="auto">
                    Automático
                  </option>

                  <option value="low">
                    Baixo
                  </option>

                  <option value="medium">
                    Médio
                  </option>

                  <option value="high">
                    Alto
                  </option>
                </select>
              </label>


              {editError && (
                <div
                  role="alert"
                  className="rounded-xl border border-[#55353a] bg-[#211417] px-4 py-3 text-xs text-[#e99ca1]"
                >
                  {editError}
                </div>
              )}
            </div>

            <footer className="flex justify-end gap-3 border-t border-[#292c35] px-6 py-4">
              <button
                type="button"
                disabled={editSaving}
                onClick={closeEditor}
                className="rounded-xl border border-[#343743] px-4 py-2.5 text-xs font-semibold text-[#c6c9d1] transition hover:border-[#454956] hover:text-white disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="submit"
                disabled={
                  editSaving
                  || editLabel.trim().length
                    === 0
                  || editModel.trim().length
                    === 0
                }
                className="rounded-xl bg-[#8c7cff] px-4 py-2.5 text-xs font-bold text-[#0c0d10] transition hover:bg-[#aa9cff] disabled:opacity-50"
              >
                {editSaving
                  ? 'Salvando...'
                  : 'Salvar alterações'}
              </button>
            </footer>
          </form>
        </div>
      )}
    </section>
  )
}






function geminiOAuthErrorMessage(
  code: string,
): string {
  switch (code) {
    case 'AUTH_CANCELLED':
      return 'O login com Google foi cancelado.'

    case 'OAUTH_CONFIGURATION_MISSING':
      return 'A configuração OAuth do Google não está disponível neste ambiente.'

    case 'SECURE_STORAGE_UNAVAILABLE':
      return 'O armazenamento seguro do sistema não está disponível.'

    case 'INVALID_CREDENTIAL':
      return 'O Google não retornou uma autorização válida. Tente conectar novamente.'

    case 'ACCESS_RESTRICTED':
      return 'Esta conta Google não possui permissão para acessar o Gemini por esta configuração.'

    case 'MODEL_UNAVAILABLE':
      return 'A conta foi autorizada, mas nenhum modelo Gemini compatível ficou disponível.'

    case 'NETWORK_UNAVAILABLE':
      return 'Não foi possível comunicar com o Google. Verifique sua conexão.'

    case 'RATE_LIMITED':
      return 'O Google limitou temporariamente as solicitações. Tente novamente em instantes.'

    case 'INSUFFICIENT_QUOTA':
      return 'O projeto ou conta não possui cota disponível para usar o Gemini.'

    case 'ACCOUNT_LIMIT_REACHED':
      return 'O limite de contas de IA configuradas no Coach foi atingido.'

    case 'INVALID_CONFIGURATION':
      return 'A configuração do login Google é inválida.'

    case 'ACCOUNT_DISABLED':
      return 'Esta conta está desativada.'

    case 'ACCOUNT_NOT_FOUND':
      return 'A conta não foi encontrada.'

    default:
      return 'Não foi possível concluir o login com Google.'
  }
}


function GeminiOAuthPanel({
  onConnect,
  onConnected,
}: {
  onConnect:
    () => Promise<ConfigureProviderResult>

  onConnected:
    () => void
}) {
  const [connecting, setConnecting] =
    useState(false)

  const [error, setError] =
    useState<string | null>(null)

  async function connect() {
    if (connecting) {
      return
    }

    setConnecting(true)
    setError(null)

    try {
      const result =
        await onConnect()

      if (!result.ok) {
        setError(
          geminiOAuthErrorMessage(
            result.code,
          ),
        )

        return
      }

      onConnected()
    } catch {
      setError(
        'Não foi possível concluir o login com Google.',
      )
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#292244] text-[#8c7cff]">
            <Sparkles
              size={21}
              aria-hidden="true"
            />
          </span>

          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white">
              Google Gemini
            </h2>

            <p className="mt-0.5 text-[11px] text-[#9297a3]">
              OAuth oficial
            </p>
          </div>
        </div>

        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#10251c] px-3 py-1.5 text-[10px] font-medium text-[#55d69a]">
          <span aria-hidden="true">
            ◉
          </span>
          Seguro
        </span>
      </div>

      <p className="mt-5 text-sm leading-6 text-[#9297a3]">
        Conecte sua conta Google para autorizar o Coach a usar
        os modelos Gemini disponíveis para sua conta e projeto.
        Você poderá revisar e revogar o acesso quando quiser.
      </p>

      <section className="mt-4 rounded-xl bg-[#0d0e12] p-4">
        <h3 className="text-xs font-medium text-white">
          O que será compartilhado
        </h3>

        <div className="mt-4 space-y-3 text-[11px] text-[#9297a3]">
          <div className="flex items-center gap-3">
            <span className="text-[#55d69a]">
              ✓
            </span>
            <span>
              Seu e-mail e perfil básico
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[#55d69a]">
              ✓
            </span>
            <span>
              Acesso aos modelos Gemini autorizados pela conta
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[#55d69a]">
              ✓
            </span>
            <span>
              Nenhuma senha é armazenada pelo Coach
            </span>
          </div>
        </div>
      </section>

      <section className="mt-4">
        <h3 className="text-xs font-semibold text-white">
          Como funciona
        </h3>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-[#292c35] bg-[#101116] p-3">
            <div className="flex items-center gap-2">
              <span className="grid size-5 place-items-center rounded-full bg-[#302951] text-[9px] font-bold text-[#b5aaff]">
                1
              </span>

              <strong className="text-[10px] font-medium text-white">
                Entrar no Google
              </strong>
            </div>

            <p className="mt-2 text-[9px] leading-4 text-[#626773]">
              Você acessa a página oficial
            </p>
          </div>

          <div className="rounded-xl border border-[#292c35] bg-[#101116] p-3">
            <div className="flex items-center gap-2">
              <span className="grid size-5 place-items-center rounded-full bg-[#302951] text-[9px] font-bold text-[#b5aaff]">
                2
              </span>

              <strong className="text-[10px] font-medium text-white">
                Autorizar
              </strong>
            </div>

            <p className="mt-2 text-[9px] leading-4 text-[#626773]">
              Revise as permissões
            </p>
          </div>

          <div className="rounded-xl border border-[#292c35] bg-[#101116] p-3">
            <div className="flex items-center gap-2">
              <span className="grid size-5 place-items-center rounded-full bg-[#302951] text-[9px] font-bold text-[#b5aaff]">
                3
              </span>

              <strong className="text-[10px] font-medium text-white">
                Começar a usar
              </strong>
            </div>

            <p className="mt-2 text-[9px] leading-4 text-[#626773]">
              Modelos ficam disponíveis
            </p>
          </div>
        </div>
      </section>

      <section className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold text-white">
            Modelos disponíveis após conectar
          </h3>

          <span className="text-[9px] text-[#626773]">
            Conforme sua conta/projeto Google
          </span>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="flex items-center gap-2 rounded-lg bg-[#171820] px-3 py-2 text-[10px] text-[#9297a3]">
            <Sparkles
              size={12}
              className="text-[#8c7cff]"
              aria-hidden="true"
            />
            Gemini 2.5 Pro
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-[#171820] px-3 py-2 text-[10px] text-[#9297a3]">
            <span className="text-[#8c7cff]">
              ϟ
            </span>
            Gemini 2.5 Flash
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-[#171820] px-3 py-2 text-[10px] text-[#9297a3]">
            <span className="text-[#8c7cff]">
              ◔
            </span>
            Gemini 2.0 Flash
          </div>
        </div>
      </section>

      <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#2c244b] px-4 py-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[#3a3062] text-[#b8adff]">
          ◇
        </span>

        <div>
          <strong className="block text-[10px] text-white">
            Você mantém o controle
          </strong>

          <p className="mt-0.5 text-[9px] leading-4 text-[#aaa4bd]">
            Desative ou revogue esta conexão a qualquer momento
            em Gerenciar contas.
          </p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-[#5a3035] bg-[#241517] px-4 py-3 text-[11px] leading-5 text-[#f0a5ad]"
        >
          {error}
        </div>
      )}

      <button
        type="button"
        disabled={connecting}
        onClick={() => {
          void connect()
        }}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#8070f2] px-4 py-3 text-xs font-bold text-white transition hover:bg-[#8c7cff] disabled:cursor-wait disabled:opacity-60"
      >
        <span aria-hidden="true">
          ↪
        </span>

        {connecting
          ? 'Aguardando autorização...'
          : 'Continuar com Google'}
      </button>

      <p className="mt-3 text-center text-[9px] text-[#626773]">
        Uma nova janela segura será aberta para concluir o login.
      </p>
    </div>
  )
}



function GitHubCopilotConnection({
  status,
  onBeginGitHubCopilotOAuth,
  onCompleteGitHubCopilotOAuth,
  onConnected,
}: {
  status: ProviderStatus | null
  onBeginGitHubCopilotOAuth:
    () => Promise<BeginGitHubCopilotOAuthResult>
  onCompleteGitHubCopilotOAuth:
    (flowId: string) => Promise<ConfigureProviderResult>
  onConnected: () => void
}) {
  const [authorization, setAuthorization] =
    useState<GitHubCopilotOAuthAuthorization | null>(null)
  const [connecting, setConnecting] =
    useState(false)
  const [error, setError] =
    useState<string | null>(null)

  const messages: Record<
    ProviderConnectionErrorCode,
    string
  > = {
    INVALID_CREDENTIAL:
      'O GitHub recusou a credencial do Copilot. Entre novamente.',
    INSUFFICIENT_QUOTA:
      'A conta está sem quota disponível para o GitHub Copilot.',
    MODEL_UNAVAILABLE:
      'A conta foi autenticada, mas nenhum modelo do Copilot está disponível.',
    ACCESS_RESTRICTED:
      'O Copilot está bloqueado por plano, organização, política ou região.',
    RATE_LIMITED:
      'O GitHub está limitando temporariamente as tentativas.',
    NETWORK_UNAVAILABLE:
      'Não foi possível alcançar o GitHub. Verifique sua rede.',
    SECURE_STORAGE_UNAVAILABLE:
      'O cofre seguro do sistema não está disponível.',
    INVALID_CONFIGURATION:
      'A configuração do GitHub Copilot é inválida.',
    ACCOUNT_DISABLED:
      'Esta conta de IA está desativada.',
    ACCOUNT_NOT_FOUND:
      'A conta de IA não foi encontrada.',
    ACCOUNT_LIMIT_REACHED:
      'O limite de 10 contas de IA foi atingido.',
    OAUTH_CONFIGURATION_MISSING:
      'Configure COACH_GITHUB_OAUTH_CLIENT_ID antes de iniciar o Coach.',
    AUTH_CANCELLED:
      'A autorização do GitHub foi cancelada ou expirou.',
    UNKNOWN:
      'Não foi possível concluir a conexão com o GitHub Copilot.',
  }

  async function connect() {
    setConnecting(true)
    setError(null)
    setAuthorization(null)

    try {
      const started =
        await onBeginGitHubCopilotOAuth()

      if (!started.ok) {
        setError(messages[started.code])
        return
      }

      setAuthorization(
        started.authorization,
      )

      const result =
        await onCompleteGitHubCopilotOAuth(
          started.authorization.flowId,
        )

      if (!result.ok) {
        setError(messages[result.code])
        return
      }

      onConnected()
    } catch {
      setError(messages.UNKNOWN)
    } finally {
      setConnecting(false)
    }
  }

  const secureStorageUnavailable =
    status?.secureStorageAvailable
    === false

  return (
    <div className="p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#292244] text-[#8c7cff]">
          <Code2 size={21} aria-hidden="true" />
        </span>

        <div>
          <h2 className="text-xl font-semibold text-white">
            GitHub Copilot
          </h2>
          <p className="mt-1 text-sm leading-6 text-[#9297a3]">
            Entre com GitHub sem colar token. O Coach usa a credencial
            desta autorização e não reutiliza gh auth nem o Copilot CLI.
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-[#292c35] bg-[#0d0e12] p-4 text-xs leading-5 text-[#9297a3]">
        O navegador será aberto no GitHub. Confirme o código e o Coach
        descobrirá os modelos liberados para sua conta.
      </div>

      {authorization && (
        <div className="mt-4 rounded-xl border border-[#4a416b] bg-[#181622] p-4 text-center">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8f849f]">
            Código de autorização
          </span>
          <strong className="mt-2 block font-mono text-2xl tracking-[0.16em] text-white">
            {authorization.userCode}
          </strong>
          <span className="mt-2 block text-[11px] text-[#9297a3]">
            Aguardando sua confirmação no navegador…
          </span>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-[#593136] bg-[#231416] p-3 text-xs leading-5 text-[#ef9a9a]">
          {error}
        </div>
      )}

      {secureStorageUnavailable && (
        <p className="mt-4 text-xs text-[#e8c878]">
          O cofre seguro precisa estar disponível para guardar o OAuth.
        </p>
      )}

      <button
        type="button"
        onClick={() => void connect()}
        disabled={
          connecting
          || secureStorageUnavailable
        }
        className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#8c7cff] px-5 text-sm font-bold text-[#0c0d10] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <LogIn size={16} aria-hidden="true" />
        {connecting
          ? authorization
            ? 'Aguardando GitHub…'
            : 'Abrindo GitHub…'
          : 'Entrar com GitHub'}
      </button>
    </div>
  )
}


export function AIConnectionPage(
  props: AIConnectionPageProps,
) {
  const [activeTab, setActiveTab] =
    useState<AIHubTab>('connect')

  const [selectedMethod, setSelectedMethod] =
    useState<ConnectionMethod | null>(null)


  useEffect(() => {
    if (
      (props.openCurrentRequest ?? 0)
      <= 0
    ) {
      return
    }

    setSelectedMethod(null)
    setActiveTab('current')
  }, [props.openCurrentRequest])


  useEffect(() => {
    if (
      activeTab !== 'current'
      || !props.onRefreshHealth
    ) {
      return
    }

    let running = false

    const refresh =
      async () => {
        if (running) {
          return
        }

        running = true

        try {
          await props.onRefreshHealth?.()
        } finally {
          running = false
        }
      }

    /*
     * Entrou em "Suas IAs":
     * verifica imediatamente.
     */
    void refresh()

  }, [
    activeTab,
    props.onRefreshHealth,
  ])

  const [connectionSuccess, setConnectionSuccess] =
    useState<string | null>(null)

  const secureStorageAvailable =
    props.status?.secureStorageAvailable

  const selectedProvider =
    selectedMethod === 'gateway'
      ? {
          method:
            'gateway' as const,

          providerType:
            'omniroute' as const,
        }
      : selectedMethod
          === 'custom-endpoint'
        ? {
            method:
              'custom-endpoint' as const,

            providerType:
              'openai-compatible' as const,
          }
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
              : 'Suas IAs'}
          </h1>

          <p className="mt-2 text-sm text-[#9297a3]">
            {activeTab === 'connect'
              ? 'Adicione provedores e escolha como o Coach acessa seus modelos.'
              : 'Escolha a IA atual e gerencie modelos, raciocínio e acesso do Coach.'}
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
            setActiveTab('current')
          }
          aria-current={
            activeTab === 'current'
              ? 'page'
              : undefined
          }
          className={`flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-semibold ${
            activeTab === 'current'
              ? 'border-[#8c7cff] text-white'
              : 'border-transparent text-[#747986] hover:text-white'
          }`}
        >
          <Users
            size={15}
            className={
              activeTab === 'current'
                ? 'text-[#8c7cff]'
                : undefined
            }
            aria-hidden="true"
          />

          Suas IAs
        </button>

</nav>

      {activeTab === 'current' && (
        <CurrentAISelection
          status={props.status}
          accounts={
            props.accounts.filter(
              (account) =>
                account.providerId
                !== 'gemini',
            )
          }
          runtimeIssues={
            props.runtimeIssues ?? {}
          }
          healthSnapshots={
            props.healthSnapshots ?? {}
          }
          connectingAccountId={
            props.connectingAccountId
            ?? null
          }
          onSelect={props.onSelect}
          onSetEnabled={props.onSetEnabled}
          onListModels={props.onListModels}
          onUpdate={props.onUpdate}
          onRemove={props.onRemove}
          onCompleteGitHubCopilotOAuth={
            props.onCompleteGitHubCopilotOAuth
          }
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
              Recomendado
            </h2>

            <p className="mt-1 text-xs text-[#747986]">
              A forma principal de conectar uma conta pessoal ao Coach.
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
              Outras formas
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
          ) : selectedMethod === 'copilot-oauth' ? (
            <GitHubCopilotConnection
              status={props.status}
              onBeginGitHubCopilotOAuth={
                props.onBeginGitHubCopilotOAuth
              }
              onCompleteGitHubCopilotOAuth={
                props.onCompleteGitHubCopilotOAuth
              }
              onConnected={() => {
                setConnectionSuccess(
                  'GitHub Copilot',
                )
                setSelectedMethod(null)
              }}
            />
          ) : selectedProvider ? (
            <div className="p-5 sm:p-6">
              <ProviderConnectionForm
                key={
                  selectedProvider.method
                }
                {...props}
                initialProviderType={
                  selectedProvider.providerType
                }
                connectionMethod={
                  selectedProvider.method
                }
                onConnected={() => {
                  setConnectionSuccess(
                    selectedProvider.method
                      === 'gateway'
                      ? 'Gateway de IA'
                      : 'Endpoint personalizado',
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
                    {selectedMethod === 'local-ai'
                      ? 'Aqui o Coach encontrará e conectará serviços locais como Ollama e LM Studio. A integração automática com IA local ainda será implementada.'
                      : 'Esta integração ainda não está disponível.'}
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
                  setActiveTab('current')
                }}
                className="rounded-xl bg-[#8c7cff] px-4 py-2.5 text-xs font-bold text-[#0c0d10]"
              >
                Ver minhas IAs
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
