import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, BookOpen, Brain, CalendarDays, MoreHorizontal, Plus, Send, Sparkles, X } from 'lucide-react'
import type { ApplicationInfo } from '../../shared/contracts/application-contract'
import type { CreateWorkspaceInput, Workspace, WorkspaceSummary } from '../../shared/contracts/workspace-contract'
import type { ConversationMessage } from '../../shared/contracts/conversation-contract'
import type { ProviderStatus } from '../../shared/contracts/provider-contract'

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

function ProviderSettingsDialog({ open, status, onClose, onConfigured, onDisconnect }: {
  open: boolean
  status: ProviderStatus | null
  onClose: () => void
  onConfigured: (apiKey: string, model: string) => Promise<void>
  onDisconnect: () => Promise<void>
}) {
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('gpt-5-mini')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null
  const secureStorageUnavailable = status?.secureStorageAvailable === false

  async function configure() {
    setSaving(true)
    setError(null)
    try {
      await onConfigured(apiKey, model)
      setApiKey('')
    } catch {
      setError('A conexão falhou. Verifique a chave, o modelo e o acesso de API da conta.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-coach-ink/55 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="provider-settings-title">
      <section className="w-full max-w-lg rounded-[2rem] bg-coach-paper p-7 shadow-2xl">
        <div className="flex items-start justify-between"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">BYOK · sua chave</p><h2 id="provider-settings-title" className="mt-2 font-display text-3xl font-black">Provedor de IA</h2></div><button aria-label="Fechar" disabled={saving} onClick={onClose} className="rounded-full p-2 hover:bg-black/5"><X /></button></div>
        <p className="mt-4 text-sm leading-6 text-coach-muted">A assinatura do ChatGPT não é uma chave de API. Use apenas uma chave criada oficialmente na plataforma da OpenAI. Ela não será salva no SQLite. Quando conectada, as mensagens recentes necessárias serão enviadas à API para gerar respostas, com armazenamento remoto desativado na requisição.</p>
        {status?.configured ? (
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><p className="font-extrabold text-emerald-900">OpenAI conectada</p><p className="mt-1 text-sm text-emerald-700">Modelo: {status.model}. A memória continua pertencendo ao Coach.</p><button disabled={saving} onClick={() => { setSaving(true); void onDisconnect().finally(() => setSaving(false)) }} className="mt-4 rounded-xl border border-emerald-300 px-4 py-2 text-sm font-bold text-emerald-900">Desconectar</button></div>
        ) : (
          <form className="mt-6" onSubmit={(event) => { event.preventDefault(); void configure() }}>
            {secureStorageUnavailable && <div className="mb-5 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">O cofre seguro do sistema operacional não está disponível. O Coach não salvará a chave de forma insegura.</div>}
            {error && <div className="mb-5 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
            <label className="block text-sm font-bold">Chave de API OpenAI<input type="password" autoComplete="off" required minLength={20} maxLength={512} disabled={secureStorageUnavailable} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-…" className="mt-2 w-full rounded-xl border border-coach-line bg-white px-4 py-3 font-mono outline-none focus:border-coach-green" /></label>
            <label className="mt-5 block text-sm font-bold">Modelo<input required maxLength={100} disabled={secureStorageUnavailable} value={model} onChange={(event) => setModel(event.target.value)} className="mt-2 w-full rounded-xl border border-coach-line bg-white px-4 py-3 outline-none focus:border-coach-green" /></label>
            <button disabled={saving || secureStorageUnavailable || !apiKey.trim()} className="mt-6 w-full rounded-xl bg-coach-orange px-5 py-3 font-extrabold text-white disabled:opacity-45">{saving ? 'Testando conexão…' : 'Testar e conectar'}</button>
          </form>
        )}
      </section>
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
  const [plannerLoading, setPlannerLoading] = useState(true)
  const [plannerError, setPlannerError] = useState<string | null>(null)
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)

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
  }, [loadWorkspaces])

  async function sendPlannerMessage() {
    const content = plannerInput.trim()
    if (!content || plannerSending || plannerLoading) return
    setPlannerSending(true)
    setPlannerInput('')
    try {
      const newMessages = await window.coach.conversation.sendHomeMessage({ content })
      setMessages((current) => [...current, ...newMessages])
      setPlannerError(null)
    } catch {
      setPlannerInput(content)
      setPlannerError('Não foi possível enviar sua mensagem ao Planner.')
    } finally {
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

  if (selected) {
    return (
      <main className="min-h-screen p-6 text-coach-ink md:p-10">
        <button onClick={() => setSelected(null)} className="flex items-center gap-2 rounded-xl border border-coach-line bg-white/70 px-4 py-2 text-sm font-bold"><ArrowLeft size={17} /> Voltar à Home</button>
        <section className="mx-auto mt-24 max-w-4xl text-center">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-coach-green">Workspace aberto</p>
          <h1 className="mt-4 font-display text-6xl font-black tracking-tight">{selected.name}</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-coach-muted">{selected.objective || 'Defina um objetivo para orientar suas próximas sessões.'}</p>
          <div className="mx-auto mt-12 max-w-xl rounded-[2rem] border border-coach-line bg-white/70 p-8 shadow-soft"><Brain className="mx-auto text-coach-orange" size={36} /><h2 className="mt-5 font-display text-2xl font-extrabold">Seu ambiente está pronto</h2><p className="mt-3 text-coach-muted">Chat, editor, sessões e materiais serão adicionados incrementalmente. Neste momento, já comprovamos criação, persistência e isolamento do Workspace.</p></div>
        </section>
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
            </div>
            <form className="border-t border-white/10 p-4" onSubmit={(event) => { event.preventDefault(); void sendPlannerMessage() }}>
              <div className="flex items-end gap-2 rounded-2xl bg-white/8 p-2"><textarea disabled={plannerLoading} aria-label="Mensagem para o Planner" value={plannerInput} onChange={(event) => setPlannerInput(event.target.value)} maxLength={4000} placeholder="Ex.: Tenho prova de C dia 16…" className="max-h-32 min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-white/35 disabled:opacity-40" /><button disabled={!plannerInput.trim() || plannerSending || plannerLoading} aria-label="Enviar" className="grid size-11 shrink-0 place-items-center rounded-xl bg-coach-yellow text-coach-ink disabled:opacity-35"><Send size={18} /></button></div>
              <p className="mt-2 px-1 text-[11px] text-white/35">{providerStatus?.configured ? `Conectado a ${providerStatus.providerName} · ${providerStatus.model}` : 'Modo local · nenhuma mensagem é enviada para uma IA externa'}</p>
            </form>
          </aside>
        </div>
      </section>
      <footer className="mx-auto mt-20 flex max-w-7xl justify-between border-t border-coach-line py-5 text-xs text-coach-muted"><span>Dados locais por padrão</span><span>{applicationInfo ? `${applicationInfo.name} ${applicationInfo.version} · API ${applicationInfo.apiVersion}` : 'Conectando…'}</span></footer>
      <CreateWorkspaceDialog open={dialogOpen} submitting={submitting} onClose={() => setDialogOpen(false)} onSubmit={createWorkspace} />
      <ProviderSettingsDialog open={providerDialogOpen} status={providerStatus} onClose={() => setProviderDialogOpen(false)} onConfigured={async (apiKey, model) => { const status = await window.coach.provider.configureOpenAI({ apiKey, model }); setProviderStatus(status); setProviderDialogOpen(false) }} onDisconnect={async () => { const status = await window.coach.provider.disconnect('openai'); setProviderStatus(status) }} />
    </main>
  )
}
