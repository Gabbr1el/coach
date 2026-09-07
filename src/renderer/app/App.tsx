import { useCallback, useEffect, useRef, useState } from 'react'
import { BarChart3, BookOpen, Brain, CalendarDays, Clock3, FolderKanban, Home, MoreHorizontal, Plus, Send, Settings, Sparkles, X } from 'lucide-react'
import type { ApplicationInfo } from '../../shared/contracts/application-contract'
import type { CreateWorkspaceInput, Workspace, WorkspaceSummary } from '../../shared/contracts/workspace-contract'
import type { ConversationMessage } from '../../shared/contracts/conversation-contract'
import type { ConfigureProviderResult, ProviderAccountSummary, ProviderStatus } from '../../shared/contracts/provider-contract'
import type { DailyStudyReport, StudyWorkspaceState } from '../../shared/contracts/study-workspace-contract'
import type { GlobalReportOverview } from '../../shared/contracts/report-contract'
import type { CodeExecutionResult } from '../../shared/contracts/code-execution-contract'
import { ProjectWorkspace } from './ProjectWorkspace'
import { RoadmapPanel } from './RoadmapPanel'
import type { PlannerAction } from '../../shared/contracts/planner-action-contract'
import { WorkspaceShell, type WorkspacePage } from './WorkspaceShell'
import { HomeScreen, type HomeSection } from './HomeScreen'
import type { ObserverState } from '../../shared/contracts/observer-contract'
import type { StudyScheduleItem, WorkspacePriority } from '../../shared/contracts/planning-contract'
import type { MaterialSearchResult, MaterialSummary } from '../../shared/contracts/material-contract'
import type { SavedForLaterItem, SessionOutlineItem } from '../../shared/contracts/session-navigation-contract'

function relativeDate(timestamp: number | null): string {
  if (!timestamp) return 'Ainda não aberto'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(timestamp)
}

function AppRail({ active, onHome, onWorkspaces, onHistory, onReports, onSettings }: { active: 'home' | 'workspaces' | 'history' | 'reports' | 'settings'; onHome(): void; onWorkspaces(): void; onHistory(): void; onReports(): void; onSettings(): void }) {
  const items = [
    { id: 'home' as const, label: 'Home', icon: Home, action: onHome },
    { id: 'workspaces' as const, label: 'Workspaces', icon: FolderKanban, action: onWorkspaces },
    { id: 'history' as const, label: 'Histórico', icon: Clock3, action: onHistory },
    { id: 'reports' as const, label: 'Relatórios', icon: BarChart3, action: onReports },
  ]
  return <aside className="flex h-full min-h-0 w-[76px] shrink-0 flex-col bg-[#12372f] px-3 py-5 text-white lg:w-[190px]"><button onClick={onHome} className="flex items-center gap-3 px-2 font-display text-xl font-black"><span className="grid size-9 place-items-center rounded-xl bg-coach-yellow text-coach-ink"><Brain size={19} /></span><span className="hidden lg:inline">Coach</span></button><nav className="mt-10 space-y-2">{items.map(({ id, label, icon: Icon, action }) => <button key={id} onClick={action} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold transition ${active === id ? 'bg-[#111217] text-coach-ink shadow-sm' : 'text-white/65 hover:bg-[#111217]/10 hover:text-white'}`}><Icon size={18} /><span className="hidden lg:inline">{label}</span></button>)}</nav><button onClick={onSettings} className={`mt-auto flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold ${active === 'settings' ? 'bg-[#111217] text-coach-ink' : 'text-white/65 hover:bg-[#111217]/10 hover:text-white'}`}><Settings size={18} /><span className="hidden lg:inline">Configurações</span></button></aside>
}

function WorkspaceCard({ workspace, priority, onOpen, onArchive }: {
  workspace: WorkspaceSummary
  priority: WorkspacePriority | undefined
  onOpen: (id: string) => void
  onArchive: (id: string) => void
}) {
  return (
    <article className="group rounded-[1.6rem] border border-coach-line bg-[#111217]/70 p-6 shadow-soft backdrop-blur-xl transition hover:-translate-y-1">
      <div className="flex items-start justify-between gap-4">
        <div className="grid size-11 place-items-center rounded-lg bg-coach-green/10 text-coach-green">
          <BookOpen size={21} />
        </div>
        <button onClick={() => onArchive(workspace.id)} title="Arquivar Workspace" className="rounded-full p-2 text-coach-muted hover:bg-black/5 hover:text-coach-ink">
          <MoreHorizontal size={19} />
        </button>
      </div>
      <div className="mt-5 flex items-center justify-between"><span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${priority?.level === 'urgent' ? 'bg-red-100 text-red-700' : priority?.level === 'attention' ? 'bg-coach-yellow/30 text-amber-800' : priority ? 'bg-coach-green/10 text-coach-green' : 'bg-black/5 text-coach-muted'}`}>{priority?.level === 'urgent' ? 'Urgente' : priority?.level === 'attention' ? 'Atenção' : priority ? 'Em dia' : 'Sem dados'}</span>{priority && <span className="text-xs font-black text-coach-muted">prioridade {priority.score}</span>}</div>
      <h2 className="mt-7 font-display text-2xl font-extrabold">{workspace.name}</h2>
      <p className="mt-2 min-h-12 text-sm leading-6 text-coach-muted">{priority?.reason ?? workspace.objective ?? 'Objetivo ainda não definido.'}</p>
      <div className="mt-7 flex items-center justify-between border-t border-coach-line pt-4">
        <span className="text-xs text-coach-muted">Último acesso: {relativeDate(workspace.lastOpenedAt)}</span>
        <button onClick={() => onOpen(workspace.id)} className="rounded-xl bg-coach-ink px-4 py-2 text-sm font-extrabold text-white hover:bg-coach-green">Abrir</button>
      </div>
    </article>
  )
}

function DeadlineDialog({ open, workspaces, onClose, onSubmit }: { open: boolean; workspaces: WorkspaceSummary[]; onClose(): void; onSubmit(input: { workspaceId: string; title: string; dueAt: number; estimatedMinutes: number; masteryPercent: number }): Promise<void> }) {
  const [workspaceId, setWorkspaceId] = useState('')
  const [title, setTitle] = useState('Prova')
  const [dueDate, setDueDate] = useState('')
  const [estimatedMinutes, setEstimatedMinutes] = useState(120)
  const [masteryPercent, setMasteryPercent] = useState(50)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  if (!open) return null
  const selectedId = workspaceId || workspaces[0]?.id || ''
  return <div className="fixed inset-0 z-30 grid place-items-center bg-black/35 p-5" onMouseDown={onClose}><form className="w-full max-w-lg rounded-[2rem] bg-coach-paper p-7 shadow-2xl" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); if (!selectedId || !dueDate || saving) return; setSaving(true); setSaveError(null); void onSubmit({ workspaceId: selectedId, title, dueAt: new Date(`${dueDate}T23:59:59`).getTime(), estimatedMinutes, masteryPercent }).catch(() => setSaveError('Não foi possível salvar este prazo.')).finally(() => setSaving(false)) }}><div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-wider text-coach-green">Planejamento local</p><h2 className="font-display text-2xl font-black">Adicionar prazo</h2></div><button type="button" onClick={onClose}><X /></button></div><label className="mt-6 block text-xs font-black uppercase text-coach-muted">Workspace<select value={selectedId} onChange={(event) => setWorkspaceId(event.target.value)} className="mt-2 w-full rounded-xl border border-coach-line bg-[#111217] p-3 text-sm normal-case text-coach-ink">{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label><label className="mt-4 block text-xs font-black uppercase text-coach-muted">Título<input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} className="mt-2 w-full rounded-xl border border-coach-line bg-[#111217] p-3 text-sm normal-case text-coach-ink" /></label><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-xs font-black uppercase text-coach-muted">Data<input required type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="mt-2 w-full rounded-xl border border-coach-line bg-[#111217] p-3 text-sm text-coach-ink" /></label><label className="text-xs font-black uppercase text-coach-muted">Carga estimada (min)<input type="number" min="1" max="100000" value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-coach-line bg-[#111217] p-3 text-sm text-coach-ink" /></label></div><label className="mt-4 block text-xs font-black uppercase text-coach-muted">Domínio atual: {masteryPercent}%<input type="range" min="0" max="100" value={masteryPercent} onChange={(event) => setMasteryPercent(Number(event.target.value))} className="mt-3 w-full accent-coach-green" /></label>{saveError && <p className="mt-4 text-sm text-red-700">{saveError}</p>}<button disabled={saving} className="mt-6 w-full rounded-xl bg-coach-orange px-5 py-3 font-black text-white disabled:opacity-50">{saving ? 'Salvando…' : 'Salvar e recalcular prioridades'}</button></form></div>
}

function CreateWorkspaceDialog({ open, submitting, onClose, onSubmit }: {
  open: boolean
  submitting: boolean
  onClose: () => void
  onSubmit: (input: CreateWorkspaceInput) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [objective, setObjective] = useState('')

  if (!open) return null

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-coach-ink/45 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="create-workspace-title">
      <form
        className="w-full max-w-lg rounded-[2rem] bg-coach-paper p-7 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault()
          void onSubmit({ name, objective })
        }}
      >
        <div className="flex items-start justify-between">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Novo ambiente</p><h2 id="create-workspace-title" className="mt-2 font-display text-3xl font-black">Criar Workspace</h2></div>
          <button type="button" aria-label="Fechar" disabled={submitting} onClick={onClose} className="rounded-full p-2 hover:bg-black/5 disabled:opacity-50"><X /></button>
        </div>
        <label className="mt-7 block text-sm font-bold">Nome
          <input autoFocus required minLength={1} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Estrutura de Dados" className="mt-2 w-full rounded-xl border border-coach-line bg-[#111217] px-4 py-3 outline-none focus:border-coach-green" />
        </label>
        <label className="mt-5 block text-sm font-bold">Objetivo
          <textarea maxLength={500} value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Ex.: Preparar a prova do dia 16" className="mt-2 min-h-28 w-full resize-none rounded-xl border border-coach-line bg-[#111217] px-4 py-3 outline-none focus:border-coach-green" />
        </label>
        <div className="mt-7 flex justify-end gap-3">
          <button type="button" disabled={submitting} onClick={onClose} className="rounded-xl border border-coach-line px-5 py-3 font-bold disabled:opacity-50">Cancelar</button>
          <button disabled={submitting} className="rounded-xl bg-coach-orange px-5 py-3 font-extrabold text-white disabled:opacity-50">{submitting ? 'Criando…' : 'Criar Workspace'}</button>
        </div>
      </form>
    </div>
  )
}

function ProviderSettingsDialog({ status, accounts, onClose, onConfigured, onConfiguredCompatible, onSelect, onRemove }: {
  status: ProviderStatus | null
  accounts: ProviderAccountSummary[]
  onClose: () => void
  onConfigured: (label: string, apiKey: string, model: string, persistence: 'secure-vault' | 'session') => Promise<ConfigureProviderResult>
  onConfiguredCompatible: (label: string, baseUrl: string, apiKey: string, model: string, persistence: 'secure-vault' | 'session') => Promise<ConfigureProviderResult>
  onSelect: (accountId: string) => Promise<void>
  onRemove: (accountId: string) => Promise<void>
}) {
  const [label, setLabel] = useState('OmniRoute local')
  const [apiKey, setApiKey] = useState('omniroute')
  const [model, setModel] = useState('codex/gpt-5.6-sol')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [persistence, setPersistence] = useState<'secure-vault' | 'session'>('session')
  const [providerType, setProviderType] = useState<'openai' | 'omniroute'>('omniroute')
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:20128/v1')

  const secureStorageUnavailable = status?.secureStorageAvailable === false
  const effectivePersistence = secureStorageUnavailable ? 'session' : persistence

  async function configure() {
    setSaving(true)
    setError(null)
    try {
      const result = providerType === 'openai'
        ? await onConfigured(label, apiKey, model, effectivePersistence)
        : await onConfiguredCompatible(label, baseUrl, apiKey, model, effectivePersistence)
      if (!result.ok) {
        const providerLabel = providerType === 'openai' ? 'A OpenAI' : 'O provedor compatível'
        const messages = {
          INVALID_CREDENTIAL: `${providerLabel} recusou a credencial. Verifique a chave ou token configurado.`,
          INSUFFICIENT_QUOTA: 'A conta de API está sem créditos ou faturamento ativo. ChatGPT Plus não inclui créditos da API.',
          MODEL_UNAVAILABLE: `A chave é válida, mas não possui acesso ao modelo “${model}”. Tente gpt-4.1-mini ou outro modelo disponível na conta.`,
          ACCESS_RESTRICTED: `${providerLabel} bloqueou o acesso por permissão, política ou região.`,
          RATE_LIMITED: `${providerLabel} está limitando temporariamente as requisições. Aguarde um pouco e tente novamente.`,
          NETWORK_UNAVAILABLE: `Não foi possível alcançar ${providerType === 'openai' ? 'a OpenAI' : 'o provedor configurado'}. Verifique o serviço, rede ou firewall.`,
          SECURE_STORAGE_UNAVAILABLE: 'O cofre seguro não está disponível. Escolha “Somente nesta sessão”.',
          INVALID_CONFIGURATION: 'A configuração enviada é inválida. Revise nome, chave, modelo e armazenamento.',
          UNKNOWN: 'A OpenAI retornou uma resposta inesperada. Confira a conta e tente novamente.',
        } as const
        setError(messages[result.code])
        return
      }
      setApiKey('')
    } catch {
      setError('A conexão falhou. Verifique a chave, o modelo e o acesso de API da conta.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-coach-ink/55 p-3 backdrop-blur-sm sm:p-5" role="dialog" aria-modal="true" aria-labelledby="provider-settings-title">
      <div className="flex min-h-full items-center justify-center">
      <section className="my-3 w-full max-w-lg rounded-[2rem] bg-coach-paper p-5 shadow-2xl sm:my-5 sm:p-7">
        <div className="flex items-start justify-between"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">BYOK · sua chave</p><h2 id="provider-settings-title" className="mt-2 font-display text-3xl font-black">Provedor de IA</h2></div><button aria-label="Fechar" disabled={saving} onClick={() => { setApiKey(''); onClose() }} className="rounded-full p-2 hover:bg-black/5"><X /></button></div>
        <p className="mt-4 text-sm leading-6 text-coach-muted">As mensagens recentes necessárias serão enviadas ao provedor escolhido. Na OpenAI direta, o Coach desativa o armazenamento remoto na requisição; em endpoints compatíveis, retenção e privacidade dependem do serviço conectado.</p>
        {accounts.length > 0 && <div className="mt-6 space-y-2">{accounts.map((account) => <div key={account.id} className={`flex items-center justify-between rounded-xl border p-3 ${account.isActive ? 'border-emerald-300 bg-emerald-50' : 'border-coach-line bg-[#111217]'}`}><div><p className="font-bold">{account.label}</p><p className="text-xs text-coach-muted">{account.providerName} · {account.model}</p></div><div className="flex gap-2">{!account.isActive && <button type="button" disabled={saving} onClick={() => { setSaving(true); setError(null); void onSelect(account.id).catch(() => setError('Não foi possível ativar esta conta. Verifique a credencial e a conexão.')).finally(() => setSaving(false)) }} className="rounded-lg border border-coach-line px-3 py-2 text-xs font-bold">Usar</button>}<button type="button" disabled={saving} onClick={() => { setSaving(true); setError(null); void onRemove(account.id).catch(() => setError('Não foi possível remover a conta com segurança.')).finally(() => setSaving(false)) }} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700">Remover</button></div></div>)}</div>}
          <form className="mt-6" onSubmit={(event) => { event.preventDefault(); void configure() }}>
            {secureStorageUnavailable && <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">O cofre seguro persistente não está disponível neste Linux. Você ainda pode usar a chave somente nesta sessão; ela será esquecida ao fechar o Coach.</div>}
            {error && <div className="mb-5 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
            <label className="block text-sm font-bold">Tipo de conexão<select value={providerType} onChange={(event) => { const type = event.target.value as 'openai' | 'omniroute'; setProviderType(type); if (type === 'omniroute') { setLabel('OmniRoute local'); setBaseUrl('http://127.0.0.1:20128/v1'); setApiKey('omniroute'); setModel('codex/gpt-5.6-sol'); setPersistence('session') } }} className="mt-2 w-full rounded-xl border border-coach-line bg-[#111217] px-4 py-3"><option value="omniroute">OmniRoute / OpenAI-compatible</option><option value="openai">OpenAI direta</option></select></label>
            <label className="mt-5 block text-sm font-bold">Nome desta conta<input required maxLength={60} value={label} onChange={(event) => setLabel(event.target.value)} className="mt-2 w-full rounded-xl border border-coach-line bg-[#111217] px-4 py-3 outline-none focus:border-coach-green" /></label>
            {providerType === 'omniroute' && <label className="mt-5 block text-sm font-bold">Endpoint<input required value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} className="mt-2 w-full rounded-xl border border-coach-line bg-[#111217] px-4 py-3 font-mono text-sm outline-none focus:border-coach-green" /></label>}
            <label className="mt-5 block text-sm font-bold">{providerType === 'openai' ? 'Chave de API OpenAI' : 'Token do serviço'}<input type="password" autoComplete="off" required minLength={providerType === 'openai' ? 20 : 1} maxLength={512} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={providerType === 'openai' ? 'sk-…' : 'Token local'} className="mt-2 w-full rounded-xl border border-coach-line bg-[#111217] px-4 py-3 font-mono outline-none focus:border-coach-green" /></label>
            <label className="mt-5 block text-sm font-bold">Modelo<input required maxLength={100} value={model} onChange={(event) => setModel(event.target.value)} className="mt-2 w-full rounded-xl border border-coach-line bg-[#111217] px-4 py-3 outline-none focus:border-coach-green" /></label>
            <label className="mt-5 block text-sm font-bold">Armazenamento<select value={effectivePersistence} onChange={(event) => setPersistence(event.target.value as 'secure-vault' | 'session')} className="mt-2 w-full rounded-xl border border-coach-line bg-[#111217] px-4 py-3 outline-none"><option value="session">Somente nesta sessão</option>{!secureStorageUnavailable && <option value="secure-vault">Cofre seguro do sistema</option>}</select></label>
            <button disabled={saving || !apiKey.trim()} className="mt-6 w-full rounded-xl bg-coach-orange px-5 py-3 font-extrabold text-white disabled:opacity-45">{saving ? 'Testando conexão…' : accounts.length ? 'Adicionar e usar conta' : 'Testar e conectar'}</button>
          </form>
      </section>
      </div>
    </div>
  )
}

export function App() {
  const [applicationInfo, setApplicationInfo] = useState<ApplicationInfo | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [selected, setSelected] = useState<Workspace | null>(null)
  const [workspacePage, setWorkspacePage] = useState<WorkspacePage>('overview')
  const [homeSection, setHomeSection] = useState<HomeSection>('home')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [plannerInput, setPlannerInput] = useState('')
  const [plannerSending, setPlannerSending] = useState(false)
  const [streamedContent, setStreamedContent] = useState('')
  const streamHandle = useRef<{ cancel(): void; dispose(): void } | null>(null)
  const [plannerLoading, setPlannerLoading] = useState(true)
  const [plannerError, setPlannerError] = useState<string | null>(null)
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const [providerAccounts, setProviderAccounts] = useState<ProviderAccountSummary[]>([])
  const [workspaceMessages, setWorkspaceMessages] = useState<ConversationMessage[]>([])
  const [workspaceInput, setWorkspaceInput] = useState('')
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceSending, setWorkspaceSending] = useState(false)
  const [workspaceStreamedContent, setWorkspaceStreamedContent] = useState('')
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const workspaceStreamHandle = useRef<{ cancel(): void; dispose(): void } | null>(null)
  const workspaceLoadEpoch = useRef(0)
  const workspaceDrafts = useRef(new Map<string, string>())
  const workspaceMessageEnd = useRef<HTMLDivElement | null>(null)
  const workspaceConversationPane = useRef<HTMLDivElement | null>(null)
  const [studyState, setStudyState] = useState<StudyWorkspaceState | null>(null)
  const [editorContent, setEditorContent] = useState('')
  const [studyNotes, setStudyNotes] = useState('')
  const [documentSavedAt, setDocumentSavedAt] = useState<number | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [timerNow, setTimerNow] = useState(Date.now())
  const [planUpdating, setPlanUpdating] = useState(false)
  const [execution, setExecution] = useState<CodeExecutionResult | null>(null)
  const [executing, setExecuting] = useState(false)
  const [observerState, setObserverState] = useState<ObserverState | null>(null)
  const [sessionCompleting, setSessionCompleting] = useState(false)
  const [timerUpdating, setTimerUpdating] = useState(false)
  const [sessionHistory, setSessionHistory] = useState<DailyStudyReport[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [priorities, setPriorities] = useState<WorkspacePriority[]>([])
  const [globalReport, setGlobalReport] = useState<GlobalReportOverview | null>(null)
  const [deadlineOpen, setDeadlineOpen] = useState(false)
  const [planningOpen, setPlanningOpen] = useState(false)
  const [routineInput, setRoutineInput] = useState('')
  const [routineNotes, setRoutineNotes] = useState<string[]>([])
  const [schedule, setSchedule] = useState<StudyScheduleItem[]>([])
  const [materialsOpen, setMaterialsOpen] = useState(false)
  const [materials, setMaterials] = useState<MaterialSummary[]>([])
  const [materialQuery, setMaterialQuery] = useState('')
  const [materialResults, setMaterialResults] = useState<MaterialSearchResult[]>([])
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [outline, setOutline] = useState<SessionOutlineItem[]>([])
  const [savedForLater, setSavedForLater] = useState<SavedForLaterItem[]>([])
  const [laterInput, setLaterInput] = useState('')
  const [plannerActions, setPlannerActions] = useState<PlannerAction[]>([])
  const studyStateRef = useRef<StudyWorkspaceState | null>(null)
  const editorContentRef = useRef('')
  const studyNotesRef = useRef('')
  const documentRevision = useRef(0)
  const notesRevision = useRef(0)

  const loadWorkspaces = useCallback(async () => {
    try {
      setWorkspaces(await window.coach.workspace.list())
      setError(null)
    } catch {
      setError('Não foi possível carregar seus Workspaces.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void window.coach.application.getInfo().then(setApplicationInfo).catch(() => setPlannerError('A integração desktop está indisponível.'))
    void loadWorkspaces()
    void window.coach.conversation.listHomeMessages().then(setMessages).catch(() => setPlannerError('Não foi possível carregar a conversa do Planner.')).finally(() => setPlannerLoading(false))
    void window.coach.planning.listPriorities().then(setPriorities)
    void window.coach.provider.getStatus().then(setProviderStatus).catch(() => setPlannerError('Não foi possível consultar a configuração de IA.'))
    void window.coach.provider.listAccounts().then(setProviderAccounts).catch(() => setPlannerError('Não foi possível listar as contas de IA.'))
    void window.coach.plannerAction.listPending().then(setPlannerActions)
    void window.coach.report.getGlobalOverview().then(setGlobalReport).catch(() => setPlannerError('Não foi possível carregar o panorama geral.'))
  }, [loadWorkspaces])

  useEffect(() => () => {
    streamHandle.current?.cancel()
    streamHandle.current?.dispose()
    workspaceStreamHandle.current?.cancel()
    workspaceStreamHandle.current?.dispose()
  }, [])

  useEffect(() => {
    const epoch = ++workspaceLoadEpoch.current
    workspaceStreamHandle.current?.cancel()
    workspaceStreamHandle.current?.dispose()
    workspaceStreamHandle.current = null
    setWorkspaceSending(false)
    setPlanUpdating(false)
    setSessionCompleting(false)
    setTimerUpdating(false)
    setWorkspaceInput(selected ? workspaceDrafts.current.get(selected.id) ?? '' : '')
    setWorkspaceMessages([])
    setWorkspaceStreamedContent('')
    setWorkspaceError(null)
    setStudyState(null)
    setObserverState(null)
    setExecuting(false)
    if (!selected) return
    setWorkspaceLoading(true)
    void Promise.all([window.coach.conversation.listWorkspaceMessages(selected.id), window.coach.studyWorkspace.getState(selected.id), window.coach.observer.getState(selected.id)])
      .then(([loaded, state, observer]) => { if (workspaceLoadEpoch.current === epoch) { setWorkspaceMessages(loaded); setStudyState(state); setObserverState(observer); setEditorContent(state.editorContent); setStudyNotes(state.notes); documentRevision.current = state.documentRevision; notesRevision.current = state.notesRevision } })
      .catch(() => { if (workspaceLoadEpoch.current === epoch) setWorkspaceError('Não foi possível carregar a conversa deste Workspace.') })
      .finally(() => { if (workspaceLoadEpoch.current === epoch) setWorkspaceLoading(false) })
    return () => { workspaceLoadEpoch.current += 1 }
  }, [selected?.id])

  useEffect(() => { studyStateRef.current = studyState }, [studyState])
  useEffect(() => { editorContentRef.current = editorContent }, [editorContent])
  useEffect(() => { studyNotesRef.current = studyNotes }, [studyNotes])

  const flushStudyDrafts = useCallback((workspaceId: string) => {
    const state = studyStateRef.current
    if (!state || state.workspaceId !== workspaceId) return
    const documentChanged = editorContentRef.current !== state.editorContent
    const notesChanged = studyNotesRef.current !== state.notes
    if (!documentChanged && !notesChanged) return true
    const saved = window.coach.studyWorkspace.flushDrafts({ workspaceId, fileName: state.fileName, language: state.language, content: editorContentRef.current, notes: studyNotesRef.current, documentRevision: documentChanged ? ++documentRevision.current : documentRevision.current, notesRevision: notesChanged ? ++notesRevision.current : notesRevision.current })
    if (!saved) setWorkspaceError('Não foi possível salvar as últimas alterações localmente.')
    return saved
  }, [])

  useEffect(() => {
    if (!selected) return
    const workspaceId = selected.id
    const flush = () => flushStudyDrafts(workspaceId)
    window.addEventListener('beforeunload', flush)
    return () => { window.removeEventListener('beforeunload', flush); flush() }
  }, [selected?.id, flushStudyDrafts])

  useEffect(() => {
    if (!selected || !studyState || editorContent === studyState.editorContent) return
    const timeout = window.setTimeout(() => {
      const epoch = workspaceLoadEpoch.current
      const content = editorContent
      void window.coach.studyWorkspace.saveDocument({ workspaceId: selected.id, fileName: studyState.fileName, language: studyState.language, content, revision: ++documentRevision.current }).then((state) => { if (workspaceLoadEpoch.current === epoch) { setStudyState(state); setDocumentSavedAt(Date.now()) } }).catch(() => { if (workspaceLoadEpoch.current === epoch) setWorkspaceError('Não foi possível salvar o código localmente.') })
    }, 700)
    return () => window.clearTimeout(timeout)
  }, [editorContent, selected?.id, studyState?.editorContent, studyState?.fileName, studyState?.language])

  useEffect(() => {
    if (!selected || !studyState || studyNotes === studyState.notes) return
    const timeout = window.setTimeout(() => {
      const epoch = workspaceLoadEpoch.current
      const notes = studyNotes
      void window.coach.studyWorkspace.saveNotes({ workspaceId: selected.id, notes, revision: ++notesRevision.current }).then((state) => { if (workspaceLoadEpoch.current === epoch) setStudyState(state) }).catch(() => { if (workspaceLoadEpoch.current === epoch) setWorkspaceError('Não foi possível salvar as anotações.') })
    }, 700)
    return () => window.clearTimeout(timeout)
  }, [studyNotes, selected?.id, studyState?.notes])

  useEffect(() => {
    if (studyState?.timerStatus !== 'running') return
    const interval = window.setInterval(() => setTimerNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [studyState?.timerStatus])

  useEffect(() => {
    if (!selected || !observerState?.active) return
    const workspaceId = selected.id
    const reportBlur = () => { void window.coach.observer.recordFocus({ workspaceId, focused: false }) }
    const epoch = workspaceLoadEpoch.current
    const reportFocus = () => { void window.coach.observer.recordFocus({ workspaceId, focused: true }).then((state) => { if (workspaceLoadEpoch.current === epoch) setObserverState(state) }) }
    window.addEventListener('blur', reportBlur)
    window.addEventListener('focus', reportFocus)
    return () => { window.removeEventListener('blur', reportBlur); window.removeEventListener('focus', reportFocus) }
  }, [selected?.id, observerState?.active])

  useEffect(() => {
    if (!selected || !studyState || studyState.timerStatus !== 'running' || timerUpdating || sessionCompleting) return
    const remaining = Math.max(0, studyState.timerRemainingSeconds - (studyState.timerStartedAt ? Math.floor((timerNow - studyState.timerStartedAt) / 1000) : 0))
    if (remaining !== 0) return
    const workspaceId = selected.id
    const epoch = workspaceLoadEpoch.current
    setTimerUpdating(true)
    void window.coach.studyWorkspace.updateTimer({ workspaceId, action: 'pause' }).then((state) => {
      if (workspaceLoadEpoch.current === epoch && state.workspaceId === workspaceId) setStudyState(state)
    }).catch(() => { if (workspaceLoadEpoch.current === epoch) setWorkspaceError('Não foi possível pausar o cronômetro concluído.') }).finally(() => { if (workspaceLoadEpoch.current === epoch) setTimerUpdating(false) })
  }, [timerNow, selected?.id, studyState?.timerRemainingSeconds, studyState?.timerStartedAt, studyState?.timerStatus, timerUpdating, sessionCompleting])

  useEffect(() => {
    const pane = workspaceConversationPane.current
    if (pane) pane.scrollTop = pane.scrollHeight
  }, [workspaceMessages, workspaceStreamedContent])

  async function sendPlannerMessage() {
    const content = plannerInput.trim()
    if (!content || plannerSending || plannerLoading) return
    setPlannerSending(true)
    setPlannerInput('')
    void window.coach.plannerAction.proposeFromText(content).then((actions) => setPlannerActions((current) => [...actions, ...current.filter((item) => !actions.some((action) => action.id === item.id))]))
    setStreamedContent('')
    try {
      const requestId = crypto.randomUUID()
      streamHandle.current = window.coach.conversation.streamHomeMessage({ requestId, content }, (event) => {
        if (event.type === 'text-delta') setStreamedContent((current) => current + event.content)
        if (event.type === 'completed') {
          setMessages(event.messages)
          setStreamedContent('')
          setPlannerSending(false)
          streamHandle.current = null
          setPlannerError(null)
        }
        if (event.type === 'cancelled') {
          setStreamedContent('')
          setPlannerSending(false)
          streamHandle.current = null
          setPlannerInput(content)
        }
        if (event.type === 'error') {
          setStreamedContent('')
          setPlannerSending(false)
          streamHandle.current = null
          setPlannerError('A IA conectada não respondeu. Tente novamente ou troque de conta.')
          void window.coach.conversation.listHomeMessages().then(setMessages)
        }
      })
    } catch {
      setPlannerInput(content)
      setPlannerError('Não foi possível iniciar a resposta do Planner.')
      setPlannerSending(false)
    }
  }

  async function createWorkspace(input: CreateWorkspaceInput) {
    setSubmitting(true)
    try {
      const workspace = await window.coach.workspace.create(input)
      setDialogOpen(false)
      setWorkspacePage('overview')
      setSelected(workspace)
      void loadWorkspaces()
    } catch {
      setError('Não foi possível criar o Workspace. Verifique os campos e tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  async function openWorkspace(id: string) {
    try {
      const workspace = await window.coach.workspace.open(id)
      if (!workspace) throw new Error('Workspace not found')
      setWorkspacePage('overview')
      setSelected(workspace)
      await loadWorkspaces()
    } catch {
      setError('Este Workspace não está mais disponível.')
    }
  }

  async function archiveWorkspace(id: string) {
    if (!window.confirm('Arquivar este Workspace? Você poderá restaurá-lo em uma versão futura.')) return
    try {
      await window.coach.workspace.archive(id)
      await loadWorkspaces()
    } catch {
      setError('Não foi possível arquivar o Workspace.')
    }
  }

  function sendWorkspaceMessage() {
    const content = workspaceInput.trim()
    if (!selected || !content || workspaceSending || workspaceLoading) return
    if (!providerStatus?.configured) {
      setWorkspaceError('Conecte um provedor de IA na Home antes de conversar neste Workspace.')
      return
    }
    setWorkspaceSending(true)
    workspaceDrafts.current.set(selected.id, content)
    setWorkspaceInput('')
    setWorkspaceStreamedContent('')
    setWorkspaceError(null)
    const requestId = crypto.randomUUID()
    const workspaceId = selected.id
    const epoch = workspaceLoadEpoch.current
    const isCurrentRequest = () => workspaceLoadEpoch.current === epoch
    workspaceStreamHandle.current = window.coach.conversation.streamWorkspaceMessage({ requestId, workspaceId, content }, (event) => {
      if (!isCurrentRequest()) return
      if (event.type === 'text-delta') setWorkspaceStreamedContent((current) => current + event.content)
      if (event.type === 'completed') {
        setWorkspaceMessages(event.messages)
        setWorkspaceStreamedContent('')
        setWorkspaceSending(false)
        workspaceDrafts.current.delete(workspaceId)
        workspaceStreamHandle.current = null
      }
      if (event.type === 'cancelled') {
        setWorkspaceStreamedContent('')
        setWorkspaceSending(false)
        workspaceDrafts.current.set(workspaceId, content)
        setWorkspaceInput(content)
        workspaceStreamHandle.current = null
      }
      if (event.type === 'error') {
        setWorkspaceStreamedContent('')
        setWorkspaceSending(false)
        workspaceDrafts.current.set(workspaceId, content)
        setWorkspaceInput(content)
        setWorkspaceError('A IA não conseguiu responder. Sua pergunta foi preservada localmente quando possível.')
        workspaceStreamHandle.current = null
        void window.coach.conversation.listWorkspaceMessages(workspaceId).then((loaded) => { if (isCurrentRequest()) setWorkspaceMessages(loaded) })
      }
    })
  }

  if (selected) {
    const completedItems = studyState?.plan.filter((item) => item.status === 'completed').length ?? 0
    const timerRemaining = studyState ? Math.max(0, studyState.timerRemainingSeconds - (studyState.timerStatus === 'running' && studyState.timerStartedAt ? Math.floor((timerNow - studyState.timerStartedAt) / 1000) : 0)) : 0
    const timerLabel = `${String(Math.floor(timerRemaining / 60)).padStart(2, '0')}:${String(timerRemaining % 60).padStart(2, '0')}`
    const activeDuration = studyState?.plan.find((item) => item.status === 'active')?.durationMinutes
    const adaptiveMinutes = Math.max(10, Math.min(60, activeDuration ?? (observerState?.focusExitCount && observerState.focusExitCount >= 3 ? 15 : 25)))
    const applyStudyState = (workspaceId: string, epoch: number) => (state: StudyWorkspaceState) => {
      if (workspaceLoadEpoch.current === epoch && state.workspaceId === workspaceId) setStudyState(state)
    }
    const activePlan = studyState?.plan.find((item) => item.status === 'active')
    const openMaterials = () => { setWorkspacePage('materials'); setMaterialResults([]); void window.coach.material.list(selected.id).then(setMaterials) }
    const openReports = () => { setWorkspacePage('reports'); void window.coach.studyWorkspace.listSessionHistory(selected.id).then(setSessionHistory).catch(() => setWorkspaceError('Não foi possível carregar o histórico.')) }
    const selectPage = (page: WorkspacePage) => page === 'materials' ? openMaterials() : page === 'reports' ? openReports() : setWorkspacePage(page)
    return (
      <WorkspaceShell name={selected.name} objective={selected.objective} page={workspacePage} timerLabel={timerLabel} timerRunning={studyState?.timerStatus === 'running'} shareContext={studyState?.shareContextWithAi ?? false} coachMessages={workspaceMessages} streamedMessage={workspaceStreamedContent} coachInput={workspaceInput} coachBusy={workspaceSending || workspaceLoading} coachError={workspaceError} conversationRef={workspaceConversationPane} messageEndRef={workspaceMessageEnd} onPage={selectPage} onHome={() => { setSelected(null); setHomeSection('home'); void window.coach.planning.listPriorities().then(setPriorities) }} onSettings={() => setProviderDialogOpen(true)} onToggleTimer={() => { if (!studyState || timerUpdating) return; setTimerUpdating(true); void window.coach.studyWorkspace.updateTimer({ workspaceId: selected.id, action: studyState.timerStatus === 'running' ? 'pause' : timerRemaining === 0 ? 'reset' : 'start' }).then(setStudyState).finally(() => setTimerUpdating(false)) }} onFinish={() => { setSessionCompleting(true); void window.coach.studyWorkspace.completeSession(selected.id).then(setStudyState).finally(() => setSessionCompleting(false)) }} onShareContext={(enabled) => { void window.coach.studyWorkspace.updateContextSharing({ workspaceId: selected.id, enabled }).then(setStudyState).catch(() => setWorkspaceError('Não foi possível atualizar o compartilhamento de contexto.')) }} onCoachInput={setWorkspaceInput} onCoachSend={sendWorkspaceMessage} onNotes={() => setNotesOpen(true)}>
        {workspacePage === 'overview' && <div className="coach-scroll-pane h-full p-5 lg:p-8"><div className="mx-auto max-w-5xl"><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Visão geral</p><h2 className="mt-2 font-display text-3xl font-black">Continue de onde parou.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-coach-muted">Objetivo, progresso, foco e próximo passo reunidos em um único lugar.</p><div className="mt-7 grid gap-4 md:grid-cols-3"><article className="rounded-lg border border-coach-line bg-[#111217] p-5"><span className="text-xs font-black text-coach-muted">Módulo atual</span><strong className="mt-2 block font-display text-xl">{activePlan?.title ?? 'Plano concluído'}</strong><p className="mt-2 text-xs text-coach-muted">{activePlan?.durationMinutes ?? 0} minutos sugeridos</p></article><article className="rounded-lg border border-coach-line bg-[#111217] p-5"><span className="text-xs font-black text-coach-muted">Progresso de hoje</span><strong className="mt-2 block font-display text-3xl">{studyState?.plan.length ? Math.round(completedItems / studyState.plan.length * 100) : 0}%</strong><div className="mt-3 h-2 overflow-hidden rounded-full bg-coach-line"><div className="h-full bg-coach-green" style={{ width: `${studyState?.plan.length ? completedItems / studyState.plan.length * 100 : 0}%` }} /></div></article><article className="rounded-lg bg-[#12372f] p-5 text-white"><span className="text-xs font-black text-white/55">Observer</span><strong className="mt-2 block font-display text-xl">{observerState?.interventionSuggested ? 'Atenção necessária' : 'Progresso estável'}</strong><p className="mt-2 text-xs text-white/55">{observerState?.focusExitCount ?? 0} saídas de foco</p></article></div><div className="mt-5 rounded-xl bg-[#181622] p-6"><p className="text-xs font-black uppercase text-coach-orange">Próximo passo</p><div className="mt-2 flex flex-wrap items-center justify-between gap-4"><div><strong className="font-display text-2xl">{activePlan?.title ?? 'Revisar aprendizados'}</strong><p className="mt-1 text-sm text-coach-muted">Abra a prática para trabalhar com arquivos reais.</p></div><button onClick={() => setWorkspacePage('practice')} className="rounded-xl bg-coach-orange px-5 py-3 text-sm font-black text-white">Começar prática</button></div></div></div></div>}
        {workspacePage === 'plan' && <div className="coach-scroll-pane h-full p-5 lg:p-8"><div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_330px]"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Plano de hoje</p><h2 className="mt-2 font-display text-3xl font-black">Seu roteiro de estudo</h2><div className="mt-6 space-y-3">{studyState?.plan.map((item) => <button disabled={planUpdating} key={item.id} onClick={() => { setPlanUpdating(true); void window.coach.studyWorkspace.togglePlanItem({ workspaceId: selected.id, itemId: item.id }).then(setStudyState).finally(() => setPlanUpdating(false)) }} className={`flex w-full items-center gap-4 rounded-lg border p-4 text-left ${item.status === 'active' ? 'border-coach-yellow bg-[#181622]' : 'border-coach-line bg-[#111217]'}`}><span className={`grid size-7 place-items-center rounded-full border ${item.status === 'completed' ? 'border-coach-green bg-coach-green text-white' : 'border-coach-line'}`}>{item.status === 'completed' ? '✓' : item.position}</span><span className="min-w-0"><strong className="block truncate">{item.title}</strong><small className="text-coach-muted">{item.durationMinutes} min · {item.status}</small></span></button>)}</div></div><RoadmapPanel workspaceId={selected.id} onError={setWorkspaceError} /></div></div>}
        {workspacePage === 'materials' && <div className="coach-scroll-pane h-full p-5 lg:p-8"><div className="mx-auto max-w-5xl"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Biblioteca</p><h2 className="mt-2 font-display text-3xl font-black">Materiais do Workspace</h2></div><button onClick={() => void window.coach.material.importPdf(selected.id).then((material) => { if (material) setMaterials((current) => [material, ...current]) }).catch(() => setWorkspaceError('Não foi possível importar este PDF.'))} className="rounded-xl bg-coach-orange px-5 py-3 text-sm font-black text-white">Importar PDF</button></div><form className="mt-6 flex gap-2" onSubmit={(event) => { event.preventDefault(); void window.coach.material.search({ workspaceId: selected.id, query: materialQuery }).then(setMaterialResults) }}><input minLength={2} value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} placeholder="Buscar nos PDFs" className="min-w-0 flex-1 rounded-xl border border-coach-line bg-[#111217] p-3" /><button className="rounded-xl bg-coach-ink px-5 font-black text-white">Buscar</button></form><div className="mt-6 grid gap-4 md:grid-cols-2">{materialResults.map((item) => <article key={`${item.materialId}-${item.pageNumber}`} className="rounded-lg border border-coach-line bg-[#111217] p-5"><strong>{item.materialName} · pág. {item.pageNumber}</strong><p className="mt-3 text-sm leading-6 text-coach-muted">{item.content}</p><button onClick={() => setWorkspaceInput(`Explique o trecho de ${item.materialName}, página ${item.pageNumber}: ${item.content.slice(0, 800)}`)} className="mt-3 text-xs font-black text-coach-green">Perguntar ao Coach</button></article>)}{!materialResults.length && materials.map((item) => <article key={item.id} className="rounded-lg border border-coach-line bg-[#111217] p-5"><strong className="block break-words">{item.name}</strong><p className="mt-1 text-xs text-coach-muted">{item.pageCount} páginas · {item.relevance}% relevante</p></article>)}</div></div></div>}
        {workspacePage === 'practice' && <div className="h-full min-h-0 overflow-hidden"><ProjectWorkspace workspaceId={selected.id} workspaceName={selected.name} onError={setWorkspaceError} /></div>}
        {workspacePage === 'videos' && <div className="coach-scroll-pane h-full p-5 lg:p-8"><div className="mx-auto max-w-5xl"><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Vídeos focados</p><h2 className="mt-2 font-display text-3xl font-black">Aprenda sem sair do contexto</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-coach-muted">Use uma busca direcionada ao objetivo deste Workspace. O Coach mantém a conversa e o plano visíveis sem abrir o feed tradicional.</p><div className="mt-7 rounded-xl border border-coach-line bg-[#111217] p-6"><label className="text-xs font-black uppercase text-coach-muted">Buscar no YouTube</label><div className="mt-3 flex gap-2"><input value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} placeholder={`Ex.: ${activePlan?.title ?? selected.name}`} className="min-w-0 flex-1 rounded-xl border border-coach-line bg-coach-paper p-3" /><button onClick={() => { const query = encodeURIComponent(`${materialQuery || activePlan?.title || selected.name} aula`); window.open(`https://www.youtube.com/results?search_query=${query}`, '_blank', 'noopener,noreferrer') }} className="rounded-xl bg-coach-orange px-5 text-sm font-black text-[#0c0d10]">Pesquisar</button></div><p className="mt-3 text-xs text-coach-muted">Links externos abrem somente após sua ação. Nenhum vídeo é enviado automaticamente ao provedor de IA.</p></div></div></div>}
        {workspacePage === 'reports' && <div className="coach-scroll-pane h-full p-5 lg:p-8"><div className="mx-auto max-w-5xl"><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Evolução</p><h2 className="mt-2 font-display text-3xl font-black">Relatórios de aprendizagem</h2><div className="mt-6 grid gap-4 md:grid-cols-2">{sessionHistory.length === 0 && <p className="rounded-lg bg-[#111217] p-5 text-sm text-coach-muted">Finalize sua primeira sessão para gerar um relatório.</p>}{sessionHistory.map((session) => <article key={session.date} className="rounded-lg border border-coach-line bg-[#111217] p-5"><div className="flex justify-between"><strong>{new Date(`${session.date}T12:00:00`).toLocaleDateString('pt-BR')} · {session.sessionCount} {session.sessionCount === 1 ? 'sessão' : 'sessões'}</strong><span className="rounded-full bg-coach-green/10 px-3 py-1 text-xs font-black text-coach-green">{Math.floor(session.focusSeconds / 60)} min</span></div><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl bg-coach-paper p-3"><strong className="text-xl">{session.successRate ?? 0}%</strong><span className="block text-[10px] text-coach-muted">Sucesso</span></div><div className="rounded-xl bg-coach-paper p-3"><strong className="text-xl">{session.focusRetentionPercent ?? 0}%</strong><span className="block text-[10px] text-coach-muted">Retenção</span></div></div><p className="mt-4 text-xs leading-5 text-coach-muted">{session.recommendation}</p></article>)}</div></div></div>}
        {notesOpen && <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onMouseDown={() => setNotesOpen(false)}><section className="flex h-full w-full max-w-md flex-col bg-coach-paper p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><h2 className="font-display text-2xl font-black">Notas rápidas</h2><button onClick={() => setNotesOpen(false)}><X /></button></div><textarea value={studyNotes} onChange={(event) => setStudyNotes(event.target.value)} className="mt-6 min-h-0 flex-1 resize-none rounded-lg border border-coach-line bg-[#111217] p-4" /></section></div>}
        {providerDialogOpen && <ProviderSettingsDialog status={providerStatus} accounts={providerAccounts} onClose={() => setProviderDialogOpen(false)} onConfigured={async (label, apiKey, model, persistence) => { const result = await window.coach.provider.configureOpenAI({ label, apiKey, model, persistence }); setProviderStatus(await window.coach.provider.getStatus()); setProviderAccounts(await window.coach.provider.listAccounts()); return result }} onConfiguredCompatible={async (label, baseUrl, apiKey, model, persistence) => { const result = await window.coach.provider.configureCompatible({ label, baseUrl, apiKey, model, persistence }); setProviderStatus(await window.coach.provider.getStatus()); setProviderAccounts(await window.coach.provider.listAccounts()); return result }} onSelect={async (accountId) => { await window.coach.provider.selectAccount(accountId); setProviderStatus(await window.coach.provider.getStatus()); setProviderAccounts(await window.coach.provider.listAccounts()) }} onRemove={async (accountId) => { await window.coach.provider.removeAccount(accountId); setProviderStatus(await window.coach.provider.getStatus()); setProviderAccounts(await window.coach.provider.listAccounts()) }} />}
      </WorkspaceShell>
    )
  }

  return <>
    <HomeScreen section={homeSection} loading={loading} error={error} report={globalReport} workspaces={workspaces} priorities={priorities} messages={messages} streamedContent={streamedContent} plannerActions={plannerActions} plannerInput={plannerInput} plannerBusy={plannerSending || plannerLoading} plannerError={plannerError} providerLabel={providerAccounts.find((account) => account.isActive)?.label ?? 'IA desconectada'} onSection={setHomeSection} onSettings={() => setProviderDialogOpen(true)} onCreate={() => setDialogOpen(true)} onOpen={(id) => void openWorkspace(id)} onArchive={(id) => void archiveWorkspace(id)} onPlannerInput={setPlannerInput} onPlannerSend={() => void sendPlannerMessage()} onResolveAction={(actionId, decision) => { void window.coach.plannerAction.resolve({ actionId, decision }).then(async () => { setPlannerActions((current) => current.filter((item) => item.id !== actionId)); await loadWorkspaces() }) }} />
    {dialogOpen && <CreateWorkspaceDialog open={dialogOpen} submitting={submitting} onClose={() => setDialogOpen(false)} onSubmit={createWorkspace} />}
    {providerDialogOpen && <ProviderSettingsDialog status={providerStatus} accounts={providerAccounts} onClose={() => setProviderDialogOpen(false)} onConfigured={async (label, apiKey, model, persistence) => { const result = await window.coach.provider.configureOpenAI({ label, apiKey, model, persistence }); setProviderStatus(await window.coach.provider.getStatus()); setProviderAccounts(await window.coach.provider.listAccounts()); return result }} onConfiguredCompatible={async (label, baseUrl, apiKey, model, persistence) => { const result = await window.coach.provider.configureCompatible({ label, baseUrl, apiKey, model, persistence }); setProviderStatus(await window.coach.provider.getStatus()); setProviderAccounts(await window.coach.provider.listAccounts()); return result }} onSelect={async (accountId) => { await window.coach.provider.selectAccount(accountId); setProviderStatus(await window.coach.provider.getStatus()); setProviderAccounts(await window.coach.provider.listAccounts()) }} onRemove={async (accountId) => { await window.coach.provider.removeAccount(accountId); setProviderStatus(await window.coach.provider.getStatus()); setProviderAccounts(await window.coach.provider.listAccounts()) }} />}
  </>
}
