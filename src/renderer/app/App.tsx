import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Brain, CalendarDays, MoreHorizontal, Plus, Send, Sparkles, X } from 'lucide-react'
import type { ApplicationInfo } from '../../shared/contracts/application-contract'
import type { CreateWorkspaceInput, Workspace, WorkspaceSummary } from '../../shared/contracts/workspace-contract'
import type { ConversationMessage } from '../../shared/contracts/conversation-contract'
import type { ConfigureProviderResult, ProviderAccountSummary, ProviderStatus } from '../../shared/contracts/provider-contract'
import type { StudySessionSummary, StudyWorkspaceState } from '../../shared/contracts/study-workspace-contract'
import type { CodeExecutionResult } from '../../shared/contracts/code-execution-contract'
import { ProjectWorkspace } from './ProjectWorkspace'
import { RoadmapPanel } from './RoadmapPanel'
import type { PlannerAction } from '../../shared/contracts/planner-action-contract'
import type { ObserverState } from '../../shared/contracts/observer-contract'
import type { StudyScheduleItem, WorkspacePriority } from '../../shared/contracts/planning-contract'
import type { MaterialSearchResult, MaterialSummary } from '../../shared/contracts/material-contract'
import type { SavedForLaterItem, SessionOutlineItem } from '../../shared/contracts/session-navigation-contract'

function relativeDate(timestamp: number | null): string {
  if (!timestamp) return 'Ainda não aberto'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(timestamp)
}

function WorkspaceCard({ workspace, priority, onOpen, onArchive }: {
  workspace: WorkspaceSummary
  priority: WorkspacePriority | undefined
  onOpen: (id: string) => void
  onArchive: (id: string) => void
}) {
  return (
    <article className="group rounded-[1.6rem] border border-coach-line bg-white/70 p-6 shadow-soft backdrop-blur-xl transition hover:-translate-y-1">
      <div className="flex items-start justify-between gap-4">
        <div className="grid size-11 place-items-center rounded-2xl bg-coach-green/10 text-coach-green">
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
  return <div className="fixed inset-0 z-30 grid place-items-center bg-black/35 p-5" onMouseDown={onClose}><form className="w-full max-w-lg rounded-[2rem] bg-coach-paper p-7 shadow-2xl" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); if (!selectedId || !dueDate || saving) return; setSaving(true); setSaveError(null); void onSubmit({ workspaceId: selectedId, title, dueAt: new Date(`${dueDate}T23:59:59`).getTime(), estimatedMinutes, masteryPercent }).catch(() => setSaveError('Não foi possível salvar este prazo.')).finally(() => setSaving(false)) }}><div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-wider text-coach-green">Planejamento local</p><h2 className="font-display text-2xl font-black">Adicionar prazo</h2></div><button type="button" onClick={onClose}><X /></button></div><label className="mt-6 block text-xs font-black uppercase text-coach-muted">Workspace<select value={selectedId} onChange={(event) => setWorkspaceId(event.target.value)} className="mt-2 w-full rounded-xl border border-coach-line bg-white p-3 text-sm normal-case text-coach-ink">{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label><label className="mt-4 block text-xs font-black uppercase text-coach-muted">Título<input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} className="mt-2 w-full rounded-xl border border-coach-line bg-white p-3 text-sm normal-case text-coach-ink" /></label><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-xs font-black uppercase text-coach-muted">Data<input required type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="mt-2 w-full rounded-xl border border-coach-line bg-white p-3 text-sm text-coach-ink" /></label><label className="text-xs font-black uppercase text-coach-muted">Carga estimada (min)<input type="number" min="1" max="100000" value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-coach-line bg-white p-3 text-sm text-coach-ink" /></label></div><label className="mt-4 block text-xs font-black uppercase text-coach-muted">Domínio atual: {masteryPercent}%<input type="range" min="0" max="100" value={masteryPercent} onChange={(event) => setMasteryPercent(Number(event.target.value))} className="mt-3 w-full accent-coach-green" /></label>{saveError && <p className="mt-4 text-sm text-red-700">{saveError}</p>}<button disabled={saving} className="mt-6 w-full rounded-xl bg-coach-orange px-5 py-3 font-black text-white disabled:opacity-50">{saving ? 'Salvando…' : 'Salvar e recalcular prioridades'}</button></form></div>
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
          <input autoFocus required minLength={1} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Estrutura de Dados" className="mt-2 w-full rounded-xl border border-coach-line bg-white px-4 py-3 outline-none focus:border-coach-green" />
        </label>
        <label className="mt-5 block text-sm font-bold">Objetivo
          <textarea maxLength={500} value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Ex.: Preparar a prova do dia 16" className="mt-2 min-h-28 w-full resize-none rounded-xl border border-coach-line bg-white px-4 py-3 outline-none focus:border-coach-green" />
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
        {accounts.length > 0 && <div className="mt-6 space-y-2">{accounts.map((account) => <div key={account.id} className={`flex items-center justify-between rounded-xl border p-3 ${account.isActive ? 'border-emerald-300 bg-emerald-50' : 'border-coach-line bg-white'}`}><div><p className="font-bold">{account.label}</p><p className="text-xs text-coach-muted">{account.providerName} · {account.model}</p></div><div className="flex gap-2">{!account.isActive && <button type="button" disabled={saving} onClick={() => { setSaving(true); setError(null); void onSelect(account.id).catch(() => setError('Não foi possível ativar esta conta. Verifique a credencial e a conexão.')).finally(() => setSaving(false)) }} className="rounded-lg border border-coach-line px-3 py-2 text-xs font-bold">Usar</button>}<button type="button" disabled={saving} onClick={() => { setSaving(true); setError(null); void onRemove(account.id).catch(() => setError('Não foi possível remover a conta com segurança.')).finally(() => setSaving(false)) }} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700">Remover</button></div></div>)}</div>}
          <form className="mt-6" onSubmit={(event) => { event.preventDefault(); void configure() }}>
            {secureStorageUnavailable && <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">O cofre seguro persistente não está disponível neste Linux. Você ainda pode usar a chave somente nesta sessão; ela será esquecida ao fechar o Coach.</div>}
            {error && <div className="mb-5 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
            <label className="block text-sm font-bold">Tipo de conexão<select value={providerType} onChange={(event) => { const type = event.target.value as 'openai' | 'omniroute'; setProviderType(type); if (type === 'omniroute') { setLabel('OmniRoute local'); setBaseUrl('http://127.0.0.1:20128/v1'); setApiKey('omniroute'); setModel('codex/gpt-5.6-sol'); setPersistence('session') } }} className="mt-2 w-full rounded-xl border border-coach-line bg-white px-4 py-3"><option value="omniroute">OmniRoute / OpenAI-compatible</option><option value="openai">OpenAI direta</option></select></label>
            <label className="mt-5 block text-sm font-bold">Nome desta conta<input required maxLength={60} value={label} onChange={(event) => setLabel(event.target.value)} className="mt-2 w-full rounded-xl border border-coach-line bg-white px-4 py-3 outline-none focus:border-coach-green" /></label>
            {providerType === 'omniroute' && <label className="mt-5 block text-sm font-bold">Endpoint<input required value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} className="mt-2 w-full rounded-xl border border-coach-line bg-white px-4 py-3 font-mono text-sm outline-none focus:border-coach-green" /></label>}
            <label className="mt-5 block text-sm font-bold">{providerType === 'openai' ? 'Chave de API OpenAI' : 'Token do serviço'}<input type="password" autoComplete="off" required minLength={providerType === 'openai' ? 20 : 1} maxLength={512} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={providerType === 'openai' ? 'sk-…' : 'Token local'} className="mt-2 w-full rounded-xl border border-coach-line bg-white px-4 py-3 font-mono outline-none focus:border-coach-green" /></label>
            <label className="mt-5 block text-sm font-bold">Modelo<input required maxLength={100} value={model} onChange={(event) => setModel(event.target.value)} className="mt-2 w-full rounded-xl border border-coach-line bg-white px-4 py-3 outline-none focus:border-coach-green" /></label>
            <label className="mt-5 block text-sm font-bold">Armazenamento<select value={effectivePersistence} onChange={(event) => setPersistence(event.target.value as 'secure-vault' | 'session')} className="mt-2 w-full rounded-xl border border-coach-line bg-white px-4 py-3 outline-none"><option value="session">Somente nesta sessão</option>{!secureStorageUnavailable && <option value="secure-vault">Cofre seguro do sistema</option>}</select></label>
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
  const [sessionHistory, setSessionHistory] = useState<StudySessionSummary[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [priorities, setPriorities] = useState<WorkspacePriority[]>([])
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
    void window.coach.application.getInfo().then(setApplicationInfo).catch(() => setError('A integração desktop está indisponível.'))
    void loadWorkspaces()
    void window.coach.conversation.listHomeMessages().then(setMessages).catch(() => setPlannerError('Não foi possível carregar a conversa do Planner.')).finally(() => setPlannerLoading(false))
    void window.coach.planning.listPriorities().then(setPriorities)
    void window.coach.provider.getStatus().then(setProviderStatus).catch(() => setError('Não foi possível consultar a configuração de IA.'))
    void window.coach.provider.listAccounts().then(setProviderAccounts).catch(() => setError('Não foi possível listar as contas de IA.'))
    void window.coach.plannerAction.listPending().then(setPlannerActions)
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
    workspaceMessageEnd.current?.scrollIntoView({ block: 'end' })
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
    return (
      <main className="min-h-screen bg-[#f5f3ec] text-coach-ink">
        <header className="flex min-h-16 flex-wrap items-center justify-between gap-4 border-b border-coach-line bg-white/85 px-5 py-3"><div className="flex items-center gap-4"><button onClick={() => { setSelected(null); void window.coach.planning.listPriorities().then(setPriorities) }} className="grid size-10 place-items-center rounded-xl bg-coach-ink text-white" aria-label="Voltar à Home"><ArrowLeft size={18} /></button><div><h1 className="font-display text-lg font-black">{selected.name}</h1><p className="text-xs text-coach-muted">{selected.objective || 'Workspace de estudos'}</p></div></div><div className="flex items-center gap-3"><span className="hidden text-xs font-bold text-coach-muted sm:block">Sessão ativa · {studyState ? new Date(studyState.sessionStartedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '...'}</span><button onClick={() => { setOutlineOpen(true); void Promise.all([window.coach.sessionNavigation.listOutline(selected.id), window.coach.sessionNavigation.listSavedForLater(selected.id)]).then(([items, saved]) => { setOutline(items); setSavedForLater(saved) }) }} className="rounded-xl border border-coach-line px-4 py-2 text-sm font-bold">Estrutura</button><button onClick={() => { setMaterialsOpen(true); setMaterialResults([]); void window.coach.material.list(selected.id).then(setMaterials) }} className="rounded-xl border border-coach-line px-4 py-2 text-sm font-bold">Materiais</button><button onClick={() => { setHistoryOpen(true); void window.coach.studyWorkspace.listSessionHistory(selected.id).then(setSessionHistory).catch(() => setWorkspaceError('Não foi possível carregar o histórico.')) }} className="rounded-xl border border-coach-line px-4 py-2 text-sm font-bold">Histórico</button><button onClick={() => setNotesOpen((open) => !open)} className="rounded-xl border border-coach-line px-4 py-2 text-sm font-bold">Anotações</button><button disabled={!studyState || sessionCompleting || executing || planUpdating || timerUpdating} onClick={() => { if (!studyState || !window.confirm('Finalizar esta sessão e iniciar uma nova?')) return; if (!flushStudyDrafts(selected.id)) return; const workspaceId = selected.id; const epoch = workspaceLoadEpoch.current; setSessionCompleting(true); void window.coach.studyWorkspace.completeSession(workspaceId).then((state) => { if (workspaceLoadEpoch.current !== epoch) return; setStudyState(state); setObserverState({ active: true, repeatedErrorCount: 0, interventionSuggested: false, focusExitCount: 0, timeAwaySeconds: 0 }); setTimerNow(Date.now()) }).catch(() => { if (workspaceLoadEpoch.current === epoch) setWorkspaceError('Não foi possível finalizar a sessão.') }).finally(() => { if (workspaceLoadEpoch.current === epoch) setSessionCompleting(false) }) }} className="rounded-xl bg-coach-orange px-4 py-2 text-sm font-black text-white disabled:opacity-40">{sessionCompleting ? 'Finalizando…' : 'Finalizar sessão'}</button></div></header>
        {workspaceError && <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800">{workspaceError}</div>}
        <section className="grid min-h-[calc(100dvh-4rem)] xl:grid-cols-[285px_minmax(480px,1fr)_350px]">
          <aside className="overflow-y-auto border-r border-coach-line bg-[#faf9f4] p-6"><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Seu roteiro</p><div className="mt-5 flex items-center justify-between"><h2 className="font-display text-xl font-black">Plano de hoje</h2><span className="text-xs font-bold text-coach-muted">{completedItems} de {studyState?.plan.length ?? 0}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-coach-line"><div className="h-full bg-coach-green transition-all" style={{ width: `${studyState?.plan.length ? completedItems / studyState.plan.length * 100 : 0}%` }} /></div><div className="mt-7 space-y-2">{studyState?.plan.map((item) => <button disabled={planUpdating || sessionCompleting} key={item.id} onClick={() => { const workspaceId = selected.id; const epoch = workspaceLoadEpoch.current; setPlanUpdating(true); void window.coach.studyWorkspace.togglePlanItem({ workspaceId, itemId: item.id }).then(applyStudyState(workspaceId, epoch)).finally(() => { if (workspaceLoadEpoch.current === epoch) setPlanUpdating(false) }) }} className={`flex w-full gap-3 rounded-2xl p-3 text-left ${item.status === 'active' ? 'bg-coach-yellow/25' : 'hover:bg-black/4'}`}><span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border ${item.status === 'completed' ? 'border-coach-green bg-coach-green text-white' : 'border-coach-line'}`}>{item.status === 'completed' ? '✓' : ''}</span><span><strong className={`block text-sm ${item.status === 'completed' ? 'line-through opacity-50' : ''}`}>{item.title}</strong><small className="text-coach-muted">{item.durationMinutes} min</small></span></button>)}</div><RoadmapPanel workspaceId={selected.id} onError={setWorkspaceError} /></aside>
          <ProjectWorkspace workspaceId={selected.id} workspaceName={selected.name} onError={setWorkspaceError} />
          <aside className="flex min-h-[620px] flex-col border-l border-coach-line bg-white"><div className="border-b border-coach-line p-5"><div className="flex items-center justify-between"><p className="text-xs font-black uppercase tracking-[0.16em] text-coach-green">Sprint de foco</p><span className="text-xs font-bold text-coach-muted">{completedItems}/{studyState?.plan.length ?? 0}</span></div><div className="mt-4 flex items-end justify-between"><strong className="font-display text-4xl">{timerLabel}</strong><button disabled={sessionCompleting || timerUpdating} onClick={() => { if (!studyState || sessionCompleting || timerUpdating) return; const workspaceId = selected.id; const epoch = workspaceLoadEpoch.current; setTimerUpdating(true); void window.coach.studyWorkspace.updateTimer({ workspaceId, action: studyState.timerStatus === 'running' ? 'pause' : timerRemaining === 0 ? 'reset' : 'start' }).then((state) => { applyStudyState(workspaceId, epoch)(state); if (workspaceLoadEpoch.current === epoch) setTimerNow(Date.now()) }).catch(() => { if (workspaceLoadEpoch.current === epoch) setWorkspaceError('Não foi possível atualizar o cronômetro.') }).finally(() => { if (workspaceLoadEpoch.current === epoch) setTimerUpdating(false) }) }} className="rounded-xl border border-coach-line px-4 py-2 text-xs font-black">{studyState?.timerStatus === 'running' ? 'Pausar' : timerRemaining === 0 ? 'Reiniciar' : 'Iniciar'}</button></div>{studyState?.timerStatus !== 'running' && studyState?.timerDurationSeconds !== adaptiveMinutes * 60 && <button disabled={timerUpdating} onClick={() => { setTimerUpdating(true); void window.coach.studyWorkspace.setTimerDuration({ workspaceId: selected.id, durationSeconds: adaptiveMinutes * 60 }).then(setStudyState).finally(() => setTimerUpdating(false)) }} className="mt-3 text-left text-[11px] font-bold text-coach-green">Usar recomendação adaptativa: {adaptiveMinutes} min</button>}</div><div className="flex min-h-0 flex-1 flex-col bg-coach-ink text-white"><div className="border-b border-white/10 p-5"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-coach-yellow text-coach-ink"><Sparkles size={17} /></div><div className="min-w-0 flex-1"><p className="font-display font-black">Coach IA</p><p className="text-[11px] text-white/45">{providerStatus?.configured ? `Online · contexto ${studyState?.shareContextWithAi ? 'compartilhado' : 'privado'}` : 'Desconectado'}</p><p className="mt-1 text-[10px] font-bold text-coach-mint">Observer: {observerState?.active ? 'ATIVO' : 'inativo'}</p></div><label className="flex cursor-pointer items-center gap-2 text-[10px] text-white/55"><input type="checkbox" checked={studyState?.shareContextWithAi ?? false} onChange={(event) => studyState && void window.coach.studyWorkspace.updateContextSharing({ workspaceId: selected.id, enabled: event.target.checked }).then(applyStudyState(selected.id, workspaceLoadEpoch.current))} /> Enviar código/notas</label></div></div><div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">{observerState?.interventionSuggested && <div className="rounded-2xl border border-coach-yellow/40 bg-coach-yellow/15 p-4 text-sm leading-6 text-coach-yellow"><strong>Possível loop detectado.</strong><br />O mesmo erro apareceu {observerState.repeatedErrorCount} vezes. Quer analisar a causa comigo?<button onClick={() => setWorkspaceInput('Estou repetindo o mesmo erro. Analise a causa provável e comece com uma pergunta, sem entregar a solução.')} className="mt-3 block rounded-lg bg-coach-yellow px-3 py-2 text-xs font-black text-coach-ink">Analisar comigo</button></div>}{workspaceLoading && <p className="text-sm text-white/45">Carregando contexto…</p>}{!workspaceLoading && workspaceMessages.length === 0 && <div className="rounded-2xl bg-white/7 p-4 text-sm leading-6 text-white/65">Posso acompanhar seu roteiro. Ative “Enviar código/notas” para permitir análise do editor e das anotações pelo provedor externo.</div>}{workspaceMessages.map((message) => <div key={message.id} className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'ml-auto bg-coach-green' : 'bg-white/8 text-white/80'}`}>{message.content}</div>)}{workspaceSending && workspaceStreamedContent && <div className="rounded-2xl bg-white/8 px-4 py-3 text-sm leading-6 text-white/80">{workspaceStreamedContent}</div>}<div ref={workspaceMessageEnd} /></div><form className="border-t border-white/10 p-3" onSubmit={(event) => { event.preventDefault(); sendWorkspaceMessage() }}><textarea disabled={!providerStatus?.configured} value={workspaceInput} onChange={(event) => setWorkspaceInput(event.target.value)} placeholder="Pergunte sobre seu estudo..." className="min-h-20 w-full resize-none rounded-xl bg-white/8 p-3 text-sm outline-none placeholder:text-white/30" /><div className="mt-2 flex justify-between">{workspaceSending ? <button type="button" onClick={() => workspaceStreamHandle.current?.cancel()} className="text-xs font-bold text-coach-yellow">Cancelar</button> : <span />}<button disabled={!workspaceInput.trim() || workspaceSending || !providerStatus?.configured} className="grid size-10 place-items-center rounded-xl bg-coach-yellow text-coach-ink disabled:opacity-30"><Send size={17} /></button></div></form></div></aside>
        </section>
        {outlineOpen && <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onMouseDown={() => setOutlineOpen(false)}><section className="h-full w-full max-w-md overflow-y-auto bg-coach-paper p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-wider text-coach-green">Sessão ativa</p><h2 className="font-display text-2xl font-black">Estrutura da sessão</h2></div><button onClick={() => setOutlineOpen(false)}><X /></button></div><div className="mt-6 space-y-2">{outline.map((item, index) => <div key={item.id} className="rounded-xl bg-white/70 p-3 text-sm"><span className="mr-2 font-black text-coach-green">{index + 1}.</span>{item.title}<span className="block pl-6 text-[10px] text-coach-muted">{new Date(item.occurredAt).toLocaleTimeString('pt-BR')}</span></div>)}{!outline.length && <p className="text-sm text-coach-muted">A estrutura aparece conforme você executa, erra e retoma o foco.</p>}</div><div className="mt-8 border-t border-coach-line pt-6"><h3 className="font-display text-xl font-black">Ver depois</h3><form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); const content = laterInput.trim(); if (!content) return; void window.coach.sessionNavigation.addSavedForLater({ workspaceId: selected.id, content }).then((item) => { setSavedForLater((current) => [item, ...current]); setLaterInput('') }) }}><input maxLength={500} value={laterInput} onChange={(event) => setLaterInput(event.target.value)} placeholder="Pesquisar SSD…" className="min-w-0 flex-1 rounded-xl border border-coach-line bg-white p-3" /><button className="rounded-xl bg-coach-ink px-4 text-white"><Plus /></button></form><div className="mt-3 space-y-2">{savedForLater.map((item) => <p key={item.id} className="rounded-xl bg-coach-yellow/15 p-3 text-sm">{item.content}</p>)}</div></div></section></div>}
        {materialsOpen && <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onMouseDown={() => setMaterialsOpen(false)}><section className="h-full w-full max-w-xl overflow-y-auto bg-coach-paper p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-wider text-coach-green">Biblioteca local</p><h2 className="font-display text-2xl font-black">Materiais PDF</h2></div><button onClick={() => setMaterialsOpen(false)}><X /></button></div><button onClick={() => void window.coach.material.importPdf(selected.id).then((material) => { if (material) setMaterials((current) => [material, ...current]) }).catch(() => setWorkspaceError('Não foi possível importar este PDF.'))} className="mt-6 rounded-xl bg-coach-orange px-4 py-3 text-sm font-black text-white">Importar PDF</button><form className="mt-6 flex gap-2" onSubmit={(event) => { event.preventDefault(); void window.coach.material.search({ workspaceId: selected.id, query: materialQuery }).then(setMaterialResults) }}><input minLength={2} value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} placeholder="Buscar nos materiais" className="min-w-0 flex-1 rounded-xl border border-coach-line bg-white p-3" /><button className="rounded-xl bg-coach-ink px-4 font-black text-white">Buscar</button></form><div className="mt-6 space-y-3">{materialResults.map((result) => <article key={`${result.materialId}-${result.pageNumber}`} className="rounded-2xl border border-coach-line bg-white/70 p-4"><strong>{result.materialName} · pág. {result.pageNumber}</strong><p className="mt-2 text-sm leading-6 text-coach-muted">{result.content}</p><button onClick={() => { setWorkspaceInput(`Não entendi esta parte de ${result.materialName}, página ${result.pageNumber}: ${result.content.slice(0, 800)}`); setMaterialsOpen(false) }} className="mt-3 text-xs font-black text-coach-green">Perguntar ao Coach</button></article>)}{!materialResults.length && materials.map((material) => <div key={material.id} className="rounded-xl bg-white/70 p-4"><div className="flex justify-between"><strong>{material.name}</strong><span className="text-xs font-black text-coach-green">{material.relevance}% relevante</span></div><p className="text-xs text-coach-muted">{material.pageCount} páginas · {material.status}</p><input aria-label={`Relevância de ${material.name}`} type="range" min="0" max="100" step="10" value={material.relevance} onChange={(event) => { const relevance = Number(event.target.value); setMaterials((current) => current.map((item) => item.id === material.id ? { ...item, relevance } : item)); void window.coach.material.updateRelevance({ workspaceId: selected.id, materialId: material.id, relevance }) }} className="mt-3 w-full accent-emerald-700" /></div>)}</div></section></div>}
        {historyOpen && <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onMouseDown={() => setHistoryOpen(false)}><section className="h-full w-full max-w-xl overflow-y-auto bg-coach-paper p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-wider text-coach-green">Memória do Workspace</p><h2 className="mt-1 font-display text-2xl font-black">Sessões anteriores</h2></div><button onClick={() => setHistoryOpen(false)} aria-label="Fechar histórico"><X /></button></div><div className="mt-7 space-y-4">{sessionHistory.length === 0 && <p className="rounded-2xl bg-white/70 p-5 text-sm text-coach-muted">Finalize sua primeira sessão para ver o relatório aqui.</p>}{sessionHistory.map((session) => <article key={session.id} className="rounded-2xl border border-coach-line bg-white/75 p-5"><div className="flex items-center justify-between"><div><strong>{new Date(session.startedAt).toLocaleDateString('pt-BR')}</strong><p className="text-xs text-coach-muted">{new Date(session.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}–{new Date(session.endedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p></div><span className="rounded-full bg-coach-green/10 px-3 py-1 text-xs font-black text-coach-green">{Math.floor(session.focusSeconds / 60)} min focados</span></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{[['Execuções', session.executions], ['Erros', session.errors], ['Intervenções', session.interventions], ['Saídas', session.focusExits]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-coach-paper p-3"><strong className="block text-xl">{value}</strong><span className="text-[11px] text-coach-muted">{label}</span></div>)}</div><p className="mt-4 text-xs text-coach-muted">{session.completedPlanItems} tarefas · {session.successRate ?? 0}% sucesso · {session.focusRetentionPercent ?? 0}% retenção</p><p className="mt-2 rounded-lg bg-coach-green/5 p-2 text-xs text-coach-green">{session.recommendation}</p></article>)}</div></section></div>}
        {notesOpen && <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onMouseDown={() => setNotesOpen(false)}><section className="h-full w-full max-w-md bg-coach-paper p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-wider text-coach-green">Caderno local</p><h2 className="mt-1 font-display text-2xl font-black">Anotações</h2></div><button onClick={() => setNotesOpen(false)} aria-label="Fechar anotações"><X /></button></div><textarea autoFocus maxLength={100000} value={studyNotes} onChange={(event) => { studyNotesRef.current = event.target.value; setStudyNotes(event.target.value) }} placeholder="Registre conceitos, dúvidas e aprendizados..." className="mt-6 h-[calc(100dvh-9rem)] w-full resize-none rounded-2xl border border-coach-line bg-white/70 p-4 leading-7 outline-none focus:border-coach-green" /></section></div>}
      </main>
    )
  }

  return (
    <main className="min-h-screen px-6 py-8 text-coach-ink md:px-10 lg:px-16">
      <header className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-2xl rounded-bl-md bg-coach-ink font-display text-sm font-black text-white">CO</div><div><p className="font-display text-lg font-extrabold leading-none">Coach</p><p className="mt-1 text-xs text-coach-muted">Seu sistema de estudos</p></div></div>
        <div className="flex items-center gap-3"><button onClick={() => { setPlanningOpen(true); void Promise.all([window.coach.planning.listRoutineNotes(), window.coach.planning.getSchedule()]).then(([notes, items]) => { setRoutineNotes(notes); setSchedule(items) }) }} className="rounded-xl border border-coach-line bg-white/60 px-4 py-2.5 text-sm font-bold">Plano</button><button onClick={() => { if (!window.confirm('Restaurar um backup substituirá os dados locais atuais e reiniciará o Coach. Continuar?')) return; void window.coach.backup.restoreBackup().catch(() => setPlannerError('Não foi possível restaurar o backup.')) }} className="rounded-xl border border-coach-line bg-white/60 px-4 py-2.5 text-sm font-bold">Restaurar</button><button onClick={() => void window.coach.backup.exportBackup().then((path) => { if (path) setPlannerError(`Backup salvo em ${path}`) }).catch(() => setPlannerError('Não foi possível exportar o backup.'))} className="rounded-xl border border-coach-line bg-white/60 px-4 py-2.5 text-sm font-bold">Backup</button><button disabled={!workspaces.length} onClick={() => setDeadlineOpen(true)} className="rounded-xl border border-coach-line bg-white/60 px-4 py-2.5 text-sm font-bold disabled:opacity-40">Adicionar prazo</button><button onClick={() => setProviderDialogOpen(true)} className="rounded-xl border border-coach-line bg-white/60 px-4 py-2.5 text-sm font-bold">{providerStatus?.configured ? 'IA conectada' : 'Conectar IA'}</button><button onClick={() => setDialogOpen(true)} className="flex items-center gap-2 rounded-xl bg-coach-orange px-4 py-2.5 text-sm font-extrabold text-white"><Plus size={18} /> Novo Workspace</button></div>
      </header>

      <section className="mx-auto mt-20 max-w-7xl">
        <div className="max-w-3xl"><p className="mb-3 text-xs font-black uppercase tracking-[0.22em] text-coach-green">Visão acadêmica</p><h1 className="font-display text-5xl font-black leading-[0.95] tracking-tight md:text-7xl">O que merece sua<span className="block text-coach-orange">atenção agora?</span></h1><p className="mt-6 max-w-2xl text-lg leading-8 text-coach-muted">Organize cada matéria em um ambiente próprio. Prioridades inteligentes chegarão quando tivermos dados reais de prazos, domínio e disponibilidade.</p></div>
        {error && <div role="alert" className="mt-7 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
        <div className="mt-12 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div>{loading ? <p className="text-coach-muted">Carregando Workspaces…</p> : workspaces.length ? (
          <div className="grid gap-5 md:grid-cols-2">{workspaces.map((workspace) => <WorkspaceCard key={workspace.id} workspace={workspace} priority={priorities.find((priority) => priority.workspaceId === workspace.id)} onOpen={(id) => void openWorkspace(id)} onArchive={(id) => void archiveWorkspace(id)} />)}</div>
        ) : (
          <div className="grid gap-5">
            <section className="relative overflow-hidden rounded-[2rem] border border-coach-line bg-white/70 p-8 shadow-soft backdrop-blur-xl"><div className="absolute -right-16 -top-16 size-52 rounded-full bg-coach-yellow/25 blur-2xl" /><div className="relative"><div className="grid size-12 place-items-center rounded-2xl bg-coach-green/10 text-coach-green"><BookOpen size={23} /></div><h2 className="mt-7 font-display text-3xl font-extrabold">Ainda não há Workspaces</h2><p className="mt-3 max-w-xl leading-7 text-coach-muted">Crie um ambiente para uma matéria, informe seu objetivo e o Coach manterá esse contexto separado dos demais estudos.</p><button onClick={() => setDialogOpen(true)} className="mt-8 inline-flex items-center gap-3 rounded-xl bg-coach-orange px-5 py-3 font-extrabold text-white"><Plus size={18} /> Criar primeiro Workspace</button></div></section>
          </div>
        )}</div>
          <aside className="sticky top-6 overflow-hidden rounded-[2rem] bg-coach-ink text-white shadow-soft">
            <div className="border-b border-white/10 p-6"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-coach-yellow text-coach-ink"><Sparkles size={20} /></div><div><p className="font-display font-extrabold">Planner acadêmico</p><p className="text-xs text-white/50">Organiza sua visão geral</p></div></div></div>
            <div className="max-h-[390px] min-h-64 space-y-4 overflow-y-auto p-5">
              {plannerError && <div className="rounded-2xl bg-red-400/15 p-4 text-sm text-red-100">{plannerError}</div>}
              {plannerLoading && <div className="text-sm text-white/45">Carregando conversa…</div>}
              {!plannerLoading && messages.length === 0 && <div className="rounded-2xl bg-white/7 p-4 text-sm leading-6 text-white/65">Conte sobre provas, horários, trabalhos ou dificuldades. Esta conversa pertence à Home e fica salva localmente.</div>}
              {messages.map((message) => <div key={message.id} className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'ml-auto bg-coach-green text-white' : 'bg-white/8 text-white/75'}`}>{message.content}</div>)}
              {plannerActions.map((action) => <div key={action.id} className="rounded-2xl border border-coach-yellow/40 bg-coach-yellow/10 p-4 text-sm"><strong className="block text-coach-yellow">Ação sugerida</strong><p className="mt-1 text-white/70">{action.type === 'workspace.create' ? `Criar Workspace “${String((action.payload as { name: string }).name)}”` : action.type === 'routine.add' ? 'Registrar esta rotina' : 'Adicionar prazo ao planejamento'}</p><div className="mt-3 flex gap-2"><button onClick={() => { void window.coach.plannerAction.resolve({ actionId: action.id, decision: 'apply' }).then(async () => { setPlannerActions((current) => current.filter((item) => item.id !== action.id)); await loadWorkspaces() }) }} className="rounded-lg bg-coach-yellow px-3 py-2 text-xs font-black text-coach-ink">Aplicar</button><button onClick={() => { void window.coach.plannerAction.resolve({ actionId: action.id, decision: 'reject' }).then(() => setPlannerActions((current) => current.filter((item) => item.id !== action.id))) }} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-black">Descartar</button></div></div>)}
              {plannerSending && streamedContent && <div className="max-w-[90%] rounded-2xl bg-white/8 px-4 py-3 text-sm leading-6 text-white/75">{streamedContent}<span className="ml-1 inline-block h-4 w-1 animate-pulse bg-coach-yellow" /></div>}
            </div>
            <form className="border-t border-white/10 p-4" onSubmit={(event) => { event.preventDefault(); void sendPlannerMessage() }}>
              <div className="flex items-end gap-2 rounded-2xl bg-white/8 p-2"><textarea disabled={plannerLoading} aria-label="Mensagem para o Planner" value={plannerInput} onChange={(event) => setPlannerInput(event.target.value)} maxLength={4000} placeholder="Ex.: Tenho prova de C dia 16…" className="max-h-32 min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-white/35 disabled:opacity-40" /><button disabled={!plannerInput.trim() || plannerSending || plannerLoading} aria-label="Enviar" className="grid size-11 shrink-0 place-items-center rounded-xl bg-coach-yellow text-coach-ink disabled:opacity-35"><Send size={18} /></button></div>
              <p className="mt-2 px-1 text-[11px] text-white/35">{providerStatus?.configured ? `Conectado a ${providerStatus.providerName} · ${providerStatus.model}` : 'Modo local · nenhuma mensagem é enviada para uma IA externa'}</p>
              {plannerSending && <button type="button" onClick={() => streamHandle.current?.cancel()} className="mt-2 px-1 text-xs font-bold text-coach-yellow">Cancelar resposta</button>}
            </form>
          </aside>
        </div>
      </section>
      <footer className="mx-auto mt-20 flex max-w-7xl justify-between border-t border-coach-line py-5 text-xs text-coach-muted"><span>Dados locais por padrão</span><span>{applicationInfo ? `${applicationInfo.name} ${applicationInfo.version} · API ${applicationInfo.apiVersion}` : 'Conectando…'}</span></footer>
      <CreateWorkspaceDialog open={dialogOpen} submitting={submitting} onClose={() => setDialogOpen(false)} onSubmit={createWorkspace} />
      {planningOpen && <div className="fixed inset-0 z-30 grid place-items-center bg-black/35 p-5" onMouseDown={() => setPlanningOpen(false)}><section className="max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-[2rem] bg-coach-paper p-7 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-wider text-coach-green">Agenda local</p><h2 className="font-display text-2xl font-black">Plano sugerido</h2></div><button onClick={() => setPlanningOpen(false)}><X /></button></div><div className="mt-6 grid gap-3">{schedule.map((item) => <article key={item.workspaceId} className="rounded-2xl bg-white/75 p-4"><div className="flex justify-between"><strong>{item.workspaceName}</strong><span className="font-black text-coach-orange">{item.suggestedMinutes} min</span></div><p className="mt-1 text-xs text-coach-muted">{item.reason}</p></article>)}{!schedule.length && <p className="text-sm text-coach-muted">Adicione prazos para gerar um plano priorizado.</p>}</div><form className="mt-7 border-t border-coach-line pt-6" onSubmit={(event) => { event.preventDefault(); const content = routineInput.trim(); if (!content) return; void window.coach.planning.addRoutineNote(content).then(() => { setRoutineNotes((current) => [content, ...current]); setRoutineInput('') }) }}><label className="text-xs font-black uppercase text-coach-muted">Rotina e disponibilidade<textarea maxLength={2000} value={routineInput} onChange={(event) => setRoutineInput(event.target.value)} placeholder="Trabalho das 8h às 17h; sexta não consigo estudar…" className="mt-2 min-h-24 w-full rounded-xl border border-coach-line bg-white p-3 text-sm normal-case text-coach-ink" /></label><button className="mt-3 rounded-xl bg-coach-ink px-4 py-2 text-sm font-black text-white">Registrar rotina</button></form><div className="mt-5 space-y-2">{routineNotes.map((note, index) => <p key={`${note}-${index}`} className="rounded-xl bg-coach-mint/25 p-3 text-sm">{note}</p>)}</div></section></div>}
      <DeadlineDialog open={deadlineOpen} workspaces={workspaces} onClose={() => setDeadlineOpen(false)} onSubmit={async (input) => { await window.coach.planning.createDeadline(input); setPriorities(await window.coach.planning.listPriorities()); setDeadlineOpen(false) }} />
      {providerDialogOpen && <ProviderSettingsDialog status={providerStatus} accounts={providerAccounts} onClose={() => setProviderDialogOpen(false)} onConfigured={async (label, apiKey, model, persistence) => { const result = await window.coach.provider.configureOpenAI({ label, apiKey, model, persistence }); if (result.ok) { setProviderStatus(result.status); setProviderAccounts(await window.coach.provider.listAccounts()) } return result }} onConfiguredCompatible={async (label, baseUrl, apiKey, model, persistence) => { const result = await window.coach.provider.configureCompatible({ label, baseUrl, apiKey, model, persistence }); if (result.ok) { setProviderStatus(result.status); setProviderAccounts(await window.coach.provider.listAccounts()) } return result }} onSelect={async (accountId) => { setProviderStatus(await window.coach.provider.selectAccount(accountId)); setProviderAccounts(await window.coach.provider.listAccounts()) }} onRemove={async (accountId) => { setProviderStatus(await window.coach.provider.removeAccount(accountId)); setProviderAccounts(await window.coach.provider.listAccounts()) }} />}
    </main>
  )
}
