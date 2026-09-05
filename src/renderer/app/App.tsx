import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, BookOpen, Brain, CalendarDays, MoreHorizontal, Plus, X } from 'lucide-react'
import type { ApplicationInfo } from '../../shared/contracts/application-contract'
import type { CreateWorkspaceInput, Workspace, WorkspaceSummary } from '../../shared/contracts/workspace-contract'

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

export function App() {
  const [applicationInfo, setApplicationInfo] = useState<ApplicationInfo | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [selected, setSelected] = useState<Workspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
  }, [loadWorkspaces])

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
        <button onClick={() => setDialogOpen(true)} className="flex items-center gap-2 rounded-xl bg-coach-orange px-4 py-2.5 text-sm font-extrabold text-white"><Plus size={18} /> Novo Workspace</button>
      </header>

      <section className="mx-auto mt-20 max-w-7xl">
        <div className="max-w-3xl"><p className="mb-3 text-xs font-black uppercase tracking-[0.22em] text-coach-green">Visão acadêmica</p><h1 className="font-display text-5xl font-black leading-[0.95] tracking-tight md:text-7xl">O que merece sua<span className="block text-coach-orange">atenção agora?</span></h1><p className="mt-6 max-w-2xl text-lg leading-8 text-coach-muted">Organize cada matéria em um ambiente próprio. Prioridades inteligentes chegarão quando tivermos dados reais de prazos, domínio e disponibilidade.</p></div>
        {error && <div role="alert" className="mt-7 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
        {loading ? <p className="mt-12 text-coach-muted">Carregando Workspaces…</p> : workspaces.length ? (
          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{workspaces.map((workspace) => <WorkspaceCard key={workspace.id} workspace={workspace} onOpen={(id) => void openWorkspace(id)} onArchive={(id) => void archiveWorkspace(id)} />)}</div>
        ) : (
          <div className="mt-12 grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
            <section className="relative overflow-hidden rounded-[2rem] border border-coach-line bg-white/70 p-8 shadow-soft backdrop-blur-xl"><div className="absolute -right-16 -top-16 size-52 rounded-full bg-coach-yellow/25 blur-2xl" /><div className="relative"><div className="grid size-12 place-items-center rounded-2xl bg-coach-green/10 text-coach-green"><BookOpen size={23} /></div><h2 className="mt-7 font-display text-3xl font-extrabold">Ainda não há Workspaces</h2><p className="mt-3 max-w-xl leading-7 text-coach-muted">Crie um ambiente para uma matéria, informe seu objetivo e o Coach manterá esse contexto separado dos demais estudos.</p><button onClick={() => setDialogOpen(true)} className="mt-8 inline-flex items-center gap-3 rounded-xl bg-coach-orange px-5 py-3 font-extrabold text-white"><Plus size={18} /> Criar primeiro Workspace</button></div></section>
            <aside className="rounded-[2rem] bg-coach-ink p-7 text-white shadow-soft"><div className="flex items-center justify-between"><span className="text-xs font-black uppercase tracking-[0.18em] text-coach-yellow">Fundação</span><Brain className="text-coach-yellow" size={23} /></div><p className="mt-8 font-display text-2xl font-extrabold leading-tight">O sistema aprende o processo, não só a resposta.</p><ul className="mt-7 space-y-4 text-sm text-white/65"><li className="flex gap-3"><CalendarDays className="shrink-0 text-coach-mint" size={18} /> Planejamento baseado na vida real</li><li className="flex gap-3"><BookOpen className="shrink-0 text-coach-mint" size={18} /> Memória pertencente ao estudante</li></ul></aside>
          </div>
        )}
      </section>
      <footer className="mx-auto mt-20 flex max-w-7xl justify-between border-t border-coach-line py-5 text-xs text-coach-muted"><span>Dados locais por padrão</span><span>{applicationInfo ? `${applicationInfo.name} ${applicationInfo.version} · API ${applicationInfo.apiVersion}` : 'Conectando…'}</span></footer>
      <CreateWorkspaceDialog open={dialogOpen} submitting={submitting} onClose={() => setDialogOpen(false)} onSubmit={createWorkspace} />
    </main>
  )
}
