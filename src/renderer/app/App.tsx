import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Brain, CalendarDays, MoreHorizontal, Plus, Send, Sparkles, X } from 'lucide-react'
import type { ApplicationInfo } from '../../shared/contracts/application-contract'
import type { CreateWorkspaceInput, Workspace, WorkspaceSummary } from '../../shared/contracts/workspace-contract'
import type { ConversationMessage } from '../../shared/contracts/conversation-contract'
import type { ConfigureProviderResult, ProviderAccountSummary, ProviderStatus } from '../../shared/contracts/provider-contract'
import type { StudyWorkspaceState } from '../../shared/contracts/study-workspace-contract'

function relativeDate(timestamp: number | null): string {
  if (!timestamp) return 'Ainda não aberto'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(timestamp)
}

function WorkspaceCard({ workspace, onOpen, onArchive }: {
  workspace: WorkspaceSummary
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
      <h2 className="mt-7 font-display text-2xl font-extrabold">{workspace.name}</h2>
      <p className="mt-2 min-h-12 text-sm leading-6 text-coach-muted">{workspace.objective || 'Objetivo ainda não definido.'}</p>
      <div className="mt-7 flex items-center justify-between border-t border-coach-line pt-4">
        <span className="text-xs text-coach-muted">Último acesso: {relativeDate(workspace.lastOpenedAt)}</span>
        <button onClick={() => onOpen(workspace.id)} className="rounded-xl bg-coach-ink px-4 py-2 text-sm font-extrabold text-white hover:bg-coach-green">Abrir</button>
      </div>
    </article>
  )
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
    void window.coach.provider.getStatus().then(setProviderStatus).catch(() => setError('Não foi possível consultar a configuração de IA.'))
    void window.coach.provider.listAccounts().then(setProviderAccounts).catch(() => setError('Não foi possível listar as contas de IA.'))
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
    setWorkspaceInput(selected ? workspaceDrafts.current.get(selected.id) ?? '' : '')
    setWorkspaceMessages([])
    setWorkspaceStreamedContent('')
    setWorkspaceError(null)
    setStudyState(null)
    if (!selected) return
    setWorkspaceLoading(true)
    void Promise.all([window.coach.conversation.listWorkspaceMessages(selected.id), window.coach.studyWorkspace.getState(selected.id)])
      .then(([loaded, state]) => { if (workspaceLoadEpoch.current === epoch) { setWorkspaceMessages(loaded); setStudyState(state); setEditorContent(state.editorContent); setStudyNotes(state.notes); documentRevision.current = state.documentRevision; notesRevision.current = state.notesRevision } })
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
    if (!documentChanged && !notesChanged) return
    const saved = window.coach.studyWorkspace.flushDrafts({ workspaceId, fileName: state.fileName, language: state.language, content: editorContentRef.current, notes: studyNotesRef.current, documentRevision: documentChanged ? ++documentRevision.current : documentRevision.current, notesRevision: notesChanged ? ++notesRevision.current : notesRevision.current })
    if (!saved) setWorkspaceError('Não foi possível salvar as últimas alterações localmente.')
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
    if (!selected || !studyState || studyState.timerStatus !== 'running') return
    const remaining = Math.max(0, studyState.timerRemainingSeconds - (studyState.timerStartedAt ? Math.floor((timerNow - studyState.timerStartedAt) / 1000) : 0))
    if (remaining !== 0) return
    const workspaceId = selected.id
    const epoch = workspaceLoadEpoch.current
    void window.coach.studyWorkspace.updateTimer({ workspaceId, action: 'pause' }).then((state) => {
      if (workspaceLoadEpoch.current === epoch && state.workspaceId === workspaceId) setStudyState(state)
    })
  }, [timerNow, selected?.id, studyState?.timerRemainingSeconds, studyState?.timerStartedAt, studyState?.timerStatus])

  useEffect(() => {
    workspaceMessageEnd.current?.scrollIntoView({ block: 'end' })
  }, [workspaceMessages, workspaceStreamedContent])

  async function sendPlannerMessage() {
    const content = plannerInput.trim()
    if (!content || plannerSending || plannerLoading) return
    setPlannerSending(true)
    setPlannerInput('')
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
    workspaceStreamHandle.current = window.coach.conversation.streamWorkspaceMessage({ requestId, workspaceId, content, studyContext: studyState?.workspaceId === workspaceId && studyState.shareContextWithAi ? { fileName: studyState.fileName, editorContent: editorContent.slice(0, 50_000), notes: studyNotes.slice(0, 20_000), activePlanItem: studyState.plan.find((item) => item.status === 'active')?.title ?? null } : undefined }, (event) => {
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
    const applyStudyState = (workspaceId: string, epoch: number) => (state: StudyWorkspaceState) => {
      if (workspaceLoadEpoch.current === epoch && state.workspaceId === workspaceId) setStudyState(state)
    }
    return (
      <main className="min-h-screen bg-[#f5f3ec] text-coach-ink">
        <header className="flex min-h-16 flex-wrap items-center justify-between gap-4 border-b border-coach-line bg-white/85 px-5 py-3"><div className="flex items-center gap-4"><button onClick={() => setSelected(null)} className="grid size-10 place-items-center rounded-xl bg-coach-ink text-white" aria-label="Voltar à Home"><ArrowLeft size={18} /></button><div><h1 className="font-display text-lg font-black">{selected.name}</h1><p className="text-xs text-coach-muted">{selected.objective || 'Workspace de estudos'}</p></div></div><div className="flex items-center gap-3"><span className="hidden text-xs font-bold text-coach-muted sm:block">Sessão ativa · {studyState ? new Date(studyState.sessionStartedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '...'}</span><button onClick={() => setNotesOpen((open) => !open)} className="rounded-xl border border-coach-line px-4 py-2 text-sm font-bold">Anotações</button></div></header>
        {workspaceError && <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800">{workspaceError}</div>}
        <section className="grid min-h-[calc(100dvh-4rem)] xl:grid-cols-[285px_minmax(480px,1fr)_350px]">
          <aside className="border-r border-coach-line bg-[#faf9f4] p-6"><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Seu roteiro</p><div className="mt-5 flex items-center justify-between"><h2 className="font-display text-xl font-black">Plano de hoje</h2><span className="text-xs font-bold text-coach-muted">{completedItems} de {studyState?.plan.length ?? 0}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-coach-line"><div className="h-full bg-coach-green transition-all" style={{ width: `${studyState?.plan.length ? completedItems / studyState.plan.length * 100 : 0}%` }} /></div><div className="mt-7 space-y-2">{studyState?.plan.map((item) => <button disabled={planUpdating} key={item.id} onClick={() => { const workspaceId = selected.id; const epoch = workspaceLoadEpoch.current; setPlanUpdating(true); void window.coach.studyWorkspace.togglePlanItem({ workspaceId, itemId: item.id }).then(applyStudyState(workspaceId, epoch)).finally(() => { if (workspaceLoadEpoch.current === epoch) setPlanUpdating(false) }) }} className={`flex w-full gap-3 rounded-2xl p-3 text-left ${item.status === 'active' ? 'bg-coach-yellow/25' : 'hover:bg-black/4'}`}><span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border ${item.status === 'completed' ? 'border-coach-green bg-coach-green text-white' : 'border-coach-line'}`}>{item.status === 'completed' ? '✓' : ''}</span><span><strong className={`block text-sm ${item.status === 'completed' ? 'line-through opacity-50' : ''}`}>{item.title}</strong><small className="text-coach-muted">{item.durationMinutes} min</small></span></button>)}</div><div className="mt-8 rounded-2xl border border-coach-yellow/50 bg-coach-yellow/15 p-4"><p className="text-sm font-black">Dica do Coach</p><p className="mt-2 text-xs leading-5 text-coach-muted">Tente explicar sua estratégia antes de pedir a solução. O Coach intervém quando detectar um desvio ou erro provável.</p></div></aside>
          <section className="flex min-h-[560px] flex-col bg-[#102724] text-white"><div className="flex items-center justify-between border-b border-white/10 px-5 py-3"><div><p className="font-mono text-sm font-bold">{studyState?.fileName ?? 'main.py'}</p><p className="text-[10px] uppercase tracking-wider text-white/35">Editor local persistente</p></div><button type="button" onClick={() => setWorkspaceInput('Analise meu código atual. Identifique primeiro o possível erro ou desvio e me dê apenas uma dica progressiva.')} className="rounded-lg bg-coach-green px-4 py-2 text-xs font-black">Preparar revisão</button></div><div className="relative min-h-0 flex-1"><div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-12 border-r border-white/8 bg-black/10 py-5 text-right font-mono text-xs leading-6 text-white/25">{editorContent.split('\n').map((_, index) => <div key={index} className="pr-3">{index + 1}</div>)}</div><textarea aria-label="Editor do Workspace" spellCheck={false} maxLength={200000} value={editorContent} onChange={(event) => { editorContentRef.current = event.target.value; setEditorContent(event.target.value) }} className="h-full min-h-[500px] w-full resize-none bg-transparent py-5 pl-16 pr-5 font-mono text-sm leading-6 text-[#dce9df] outline-none" /></div><div className="flex items-center justify-between border-t border-white/10 px-5 py-2 text-[11px] text-white/40"><span>{studyState?.language ?? 'python'} · UTF-8</span><span>{documentSavedAt ? 'Salvo agora' : 'Salvamento automático'}</span></div></section>
          <aside className="flex min-h-[620px] flex-col border-l border-coach-line bg-white"><div className="border-b border-coach-line p-5"><div className="flex items-center justify-between"><p className="text-xs font-black uppercase tracking-[0.16em] text-coach-green">Sprint de foco</p><span className="text-xs font-bold text-coach-muted">{completedItems}/{studyState?.plan.length ?? 0}</span></div><div className="mt-4 flex items-end justify-between"><strong className="font-display text-4xl">{timerLabel}</strong><button onClick={() => { if (!studyState) return; const workspaceId = selected.id; const epoch = workspaceLoadEpoch.current; void window.coach.studyWorkspace.updateTimer({ workspaceId, action: studyState.timerStatus === 'running' ? 'pause' : timerRemaining === 0 ? 'reset' : 'start' }).then((state) => { applyStudyState(workspaceId, epoch)(state); if (workspaceLoadEpoch.current === epoch) setTimerNow(Date.now()) }) }} className="rounded-xl border border-coach-line px-4 py-2 text-xs font-black">{studyState?.timerStatus === 'running' ? 'Pausar' : timerRemaining === 0 ? 'Reiniciar' : 'Iniciar'}</button></div></div><div className="flex min-h-0 flex-1 flex-col bg-coach-ink text-white"><div className="border-b border-white/10 p-5"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-coach-yellow text-coach-ink"><Sparkles size={17} /></div><div className="min-w-0 flex-1"><p className="font-display font-black">Coach IA</p><p className="text-[11px] text-white/45">{providerStatus?.configured ? `Online · contexto ${studyState?.shareContextWithAi ? 'compartilhado' : 'privado'}` : 'Desconectado'}</p></div><label className="flex cursor-pointer items-center gap-2 text-[10px] text-white/55"><input type="checkbox" checked={studyState?.shareContextWithAi ?? false} onChange={(event) => studyState && void window.coach.studyWorkspace.updateContextSharing({ workspaceId: selected.id, enabled: event.target.checked }).then(applyStudyState(selected.id, workspaceLoadEpoch.current))} /> Enviar código/notas</label></div></div><div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">{workspaceLoading && <p className="text-sm text-white/45">Carregando contexto…</p>}{!workspaceLoading && workspaceMessages.length === 0 && <div className="rounded-2xl bg-white/7 p-4 text-sm leading-6 text-white/65">Posso acompanhar seu roteiro. Ative “Enviar código/notas” para permitir análise do editor e das anotações pelo provedor externo.</div>}{workspaceMessages.map((message) => <div key={message.id} className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'ml-auto bg-coach-green' : 'bg-white/8 text-white/80'}`}>{message.content}</div>)}{workspaceSending && workspaceStreamedContent && <div className="rounded-2xl bg-white/8 px-4 py-3 text-sm leading-6 text-white/80">{workspaceStreamedContent}</div>}<div ref={workspaceMessageEnd} /></div><form className="border-t border-white/10 p-3" onSubmit={(event) => { event.preventDefault(); sendWorkspaceMessage() }}><textarea disabled={!providerStatus?.configured} value={workspaceInput} onChange={(event) => setWorkspaceInput(event.target.value)} placeholder="Pergunte sobre seu estudo..." className="min-h-20 w-full resize-none rounded-xl bg-white/8 p-3 text-sm outline-none placeholder:text-white/30" /><div className="mt-2 flex justify-between">{workspaceSending ? <button type="button" onClick={() => workspaceStreamHandle.current?.cancel()} className="text-xs font-bold text-coach-yellow">Cancelar</button> : <span />}<button disabled={!workspaceInput.trim() || workspaceSending || !providerStatus?.configured} className="grid size-10 place-items-center rounded-xl bg-coach-yellow text-coach-ink disabled:opacity-30"><Send size={17} /></button></div></form></div></aside>
        </section>
        {notesOpen && <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onMouseDown={() => setNotesOpen(false)}><section className="h-full w-full max-w-md bg-coach-paper p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-wider text-coach-green">Caderno local</p><h2 className="mt-1 font-display text-2xl font-black">Anotações</h2></div><button onClick={() => setNotesOpen(false)} aria-label="Fechar anotações"><X /></button></div><textarea autoFocus maxLength={100000} value={studyNotes} onChange={(event) => { studyNotesRef.current = event.target.value; setStudyNotes(event.target.value) }} placeholder="Registre conceitos, dúvidas e aprendizados..." className="mt-6 h-[calc(100dvh-9rem)] w-full resize-none rounded-2xl border border-coach-line bg-white/70 p-4 leading-7 outline-none focus:border-coach-green" /></section></div>}
      </main>
    )
  }

  return (
    <main className="min-h-screen px-6 py-8 text-coach-ink md:px-10 lg:px-16">
      <header className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-2xl rounded-bl-md bg-coach-ink font-display text-sm font-black text-white">CO</div><div><p className="font-display text-lg font-extrabold leading-none">Coach</p><p className="mt-1 text-xs text-coach-muted">Seu sistema de estudos</p></div></div>
        <div className="flex items-center gap-3"><button onClick={() => setProviderDialogOpen(true)} className="rounded-xl border border-coach-line bg-white/60 px-4 py-2.5 text-sm font-bold">{providerStatus?.configured ? 'IA conectada' : 'Conectar IA'}</button><button onClick={() => setDialogOpen(true)} className="flex items-center gap-2 rounded-xl bg-coach-orange px-4 py-2.5 text-sm font-extrabold text-white"><Plus size={18} /> Novo Workspace</button></div>
      </header>

      <section className="mx-auto mt-20 max-w-7xl">
        <div className="max-w-3xl"><p className="mb-3 text-xs font-black uppercase tracking-[0.22em] text-coach-green">Visão acadêmica</p><h1 className="font-display text-5xl font-black leading-[0.95] tracking-tight md:text-7xl">O que merece sua<span className="block text-coach-orange">atenção agora?</span></h1><p className="mt-6 max-w-2xl text-lg leading-8 text-coach-muted">Organize cada matéria em um ambiente próprio. Prioridades inteligentes chegarão quando tivermos dados reais de prazos, domínio e disponibilidade.</p></div>
        {error && <div role="alert" className="mt-7 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
        <div className="mt-12 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div>{loading ? <p className="text-coach-muted">Carregando Workspaces…</p> : workspaces.length ? (
          <div className="grid gap-5 md:grid-cols-2">{workspaces.map((workspace) => <WorkspaceCard key={workspace.id} workspace={workspace} onOpen={(id) => void openWorkspace(id)} onArchive={(id) => void archiveWorkspace(id)} />)}</div>
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
      {providerDialogOpen && <ProviderSettingsDialog status={providerStatus} accounts={providerAccounts} onClose={() => setProviderDialogOpen(false)} onConfigured={async (label, apiKey, model, persistence) => { const result = await window.coach.provider.configureOpenAI({ label, apiKey, model, persistence }); if (result.ok) { setProviderStatus(result.status); setProviderAccounts(await window.coach.provider.listAccounts()) } return result }} onConfiguredCompatible={async (label, baseUrl, apiKey, model, persistence) => { const result = await window.coach.provider.configureCompatible({ label, baseUrl, apiKey, model, persistence }); if (result.ok) { setProviderStatus(result.status); setProviderAccounts(await window.coach.provider.listAccounts()) } return result }} onSelect={async (accountId) => { setProviderStatus(await window.coach.provider.selectAccount(accountId)); setProviderAccounts(await window.coach.provider.listAccounts()) }} onRemove={async (accountId) => { setProviderStatus(await window.coach.provider.removeAccount(accountId)); setProviderAccounts(await window.coach.provider.listAccounts()) }} />}
    </main>
  )
}
