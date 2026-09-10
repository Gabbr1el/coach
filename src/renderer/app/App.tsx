import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, CalendarDays, MoreHorizontal, Plus, Send, Sparkles, X } from 'lucide-react'
import type { ApplicationInfo } from '../../shared/contracts/application-contract'
import type { CreateWorkspaceInput, Workspace, WorkspaceSummary } from '../../shared/contracts/workspace-contract'
import type { ConversationMessage } from '../../shared/contracts/conversation-contract'
import type { ConfigureProviderResult, ProviderAccountSummary, ProviderStatus } from '../../shared/contracts/provider-contract'
import type { DailyStudyReport, StudyWorkspaceState } from '../../shared/contracts/study-workspace-contract'
import type { GlobalReportOverview } from '../../shared/contracts/report-contract'
import type { LearningPathState, Roadmap, RoadmapModule } from '../../shared/contracts/roadmap-contract'
import type { CodeExecutionResult, InteractiveCodeBlock, InteractiveCodeState } from '../../shared/contracts/code-execution-contract'
import { ProjectWorkspace } from './ProjectWorkspace'
import type { PlannerAction } from '../../shared/contracts/planner-action-contract'
import { WorkspaceShell, type WorkspacePage } from './WorkspaceShell'
import { HomeScreen, type HomeSection } from './HomeScreen'
import type { ObserverState } from '../../shared/contracts/observer-contract'
import type { AcademicOverview, StudyScheduleItem, WorkspacePriority } from '../../shared/contracts/planning-contract'
import type { MaterialSearchResult, MaterialSummary } from '../../shared/contracts/material-contract'
import type { SavedForLaterItem, SessionOutlineItem } from '../../shared/contracts/session-navigation-contract'
import type { StudyProgressState } from '../../shared/contracts/study-progress-contract'
import type { PersistedStudyLesson, StudyLessonLoadResult } from '../../shared/contracts/study-lesson-contract'
import type { AcademicSubjectContext } from '../../shared/contracts/academic-subject-context-contract'
import { StudyLessonView, studyLessonBlockExcerpt } from './StudyLessonView'
import { ExercisesWorkspace, type ActiveExerciseContext } from './ExercisesWorkspace'
import { LearningPathDrawer } from './LearningPathDrawer'
import { studiesPreparationMessage } from './studies-preparation'
import { planActionLabel } from '../../application/study-workspaces/daily-plan'

function useDialogFocus<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const dialogRef = useRef<T | null>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = () => [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])]
    focusable()[0]?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const elements = focusable()
      if (!elements.length) return
      const first = elements[0]!
      const last = elements.at(-1)!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown); previous?.focus() }
  }, [open])
  return dialogRef
}

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

function WorkspaceCreationScreen({ open, submitting, initial, onClose, onSubmit }: {
  open: boolean
  submitting: boolean
  initial: { name: string; objective: string } | null
  onClose: () => void
  onSubmit: (input: CreateWorkspaceInput) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [objective, setObjective] = useState('')
  const [diagnosticAnswer, setDiagnosticAnswer] = useState('')
  const [question, setQuestion] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzed, setAnalyzed] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [declaredLevel, setDeclaredLevel] = useState<CreateWorkspaceInput['declaredLevel']>(undefined)
  const [declaredKnowledge, setDeclaredKnowledge] = useState<string[]>([])
  const [declaredDifficulties, setDeclaredDifficulties] = useState<string[]>([])
  const [goals, setGoals] = useState<string[]>([])
  const [relatedContexts, setRelatedContexts] = useState<AcademicSubjectContext[]>([])
  const [selectedRelated, setSelectedRelated] = useState<string[]>([])
  const analysisEpoch = useRef(0)
  const resetSubjectState = () => { analysisEpoch.current += 1; setObjective(''); setDiagnosticAnswer(''); setDeclaredLevel(undefined); setDeclaredKnowledge([]); setDeclaredDifficulties([]); setGoals([]); setRelatedContexts([]); setSelectedRelated([]); setAnalyzed(false); setQuestion(null); setAnalysisError(null) }

  useEffect(() => { if (!open) return; setName(initial?.name ?? ''); setObjective(initial?.objective ?? ''); setDiagnosticAnswer(''); setDeclaredLevel(undefined); setDeclaredKnowledge([]); setDeclaredDifficulties([]); setGoals([]); setRelatedContexts([]); setSelectedRelated([]); setAnalyzed(false); setQuestion(null); setAnalysisError(null) }, [open, initial])

  async function analyze() {
    if (name.trim().length < 2 || analyzing) return
    const epoch = ++analysisEpoch.current
    setAnalyzing(true); setAnalysisError(null)
    try { const result = await window.coach.workspaceOnboarding.analyze({ topic: name, diagnosticAnswer: diagnosticAnswer.trim() || undefined }); if (analysisEpoch.current !== epoch) return; setName(result.topic); setObjective(result.objective); setQuestion(result.question); setDeclaredLevel(result.declaredLevel ?? undefined); setDeclaredKnowledge([...result.declaredKnowledge]); setDeclaredDifficulties([...result.declaredDifficulties]); setGoals([...result.goals]); setRelatedContexts([...(result.relatedContexts ?? [])]); setAnalyzed(!result.needsDiagnostic) }
    catch { setAnalysisError('Não consegui avaliar o tema agora. Tente novamente.') }
    finally { setAnalyzing(false) }
  }

  const dialogRef = useDialogFocus<HTMLDivElement>(open, onClose)
  if (!open) return null

  return (
    <div ref={dialogRef} className="fixed inset-0 z-20 overflow-y-auto bg-[#0d0e12] p-5" role="dialog" aria-modal="true" aria-labelledby="create-workspace-title">
      <form
        className="mx-auto min-h-full w-full max-w-5xl rounded-[2rem] border border-coach-line bg-[#111217] p-7 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault()
           if (!analyzed) { void analyze(); return }
             void onSubmit({ name, objective, declaredLevel, declaredKnowledge, declaredDifficulties, goals, relatedSubjects: selectedRelated.map((subject) => ({ subject, relation: 'user_selected' as const })) }).catch(() => setAnalysisError('Não foi possível criar o Workspace e salvar o contexto acadêmico.'))
        }}
      >
        <div className="flex items-start justify-between">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Preparação contextual</p><h2 id="create-workspace-title" className="mt-2 font-display text-3xl font-black">Criar Workspace</h2></div>
          <button type="button" aria-label="Fechar" disabled={submitting} onClick={onClose} className="rounded-full p-2 hover:bg-black/5 disabled:opacity-50"><X /></button>
        </div>
         <label className="mt-7 block text-sm font-bold">Tema que você quer aprender
           <input autoFocus required minLength={2} maxLength={80} value={name} onChange={(event) => { setName(event.target.value); resetSubjectState() }} placeholder="Ex.: Estrutura de Dados" className="mt-2 w-full rounded-xl border border-coach-line bg-[#111217] px-4 py-3 outline-none focus:border-coach-green" />
         </label>
         <label className="mt-5 block text-sm font-bold">Objetivo<input required maxLength={500} value={objective} onChange={(event) => setObjective(event.target.value)} className="mt-2 w-full rounded-xl border border-coach-line bg-[#0d0e12] px-4 py-3" /></label>
         <label className="mt-5 block text-sm font-bold">Nível atual<select required value={declaredLevel ?? ""} onChange={(event) => setDeclaredLevel(event.target.value as CreateWorkspaceInput['declaredLevel'])} className="mt-2 w-full rounded-xl border border-coach-line bg-[#0d0e12] px-4 py-3"><option value="" disabled>Selecione</option><option value="beginner">Iniciante</option><option value="intermediate">Intermediário</option><option value="advanced">Avançado</option></select></label>
         <section className="mt-6 rounded-2xl border border-coach-line p-5"><h3 className="font-display text-xl font-black">O que o Coach já sabe</h3><p className="mt-1 text-xs text-coach-muted">Revise livremente. Uma linha por item; as mudanças serão persistidas ao criar.</p><label className="mt-4 block text-xs font-black uppercase text-coach-muted">Conhecimentos<textarea value={declaredKnowledge.join('\n')} onChange={(event) => setDeclaredKnowledge(event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))} className="mt-2 min-h-20 w-full rounded-xl border border-coach-line bg-[#0d0e12] p-3 text-sm font-normal normal-case text-coach-ink" /></label><label className="mt-3 block text-xs font-black uppercase text-coach-muted">Dificuldades<textarea value={declaredDifficulties.join('\n')} onChange={(event) => setDeclaredDifficulties(event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))} className="mt-2 min-h-20 w-full rounded-xl border border-coach-line bg-[#0d0e12] p-3 text-sm font-normal normal-case text-coach-ink" /></label><label className="mt-3 block text-xs font-black uppercase text-coach-muted">Objetivos relacionados<textarea value={goals.join('\n')} onChange={(event) => setGoals(event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))} className="mt-2 min-h-20 w-full rounded-xl border border-coach-line bg-[#0d0e12] p-3 text-sm font-normal normal-case text-coach-ink" /></label>{relatedContexts.length > 0 && <div className="mt-4"><p className="text-xs font-black uppercase text-coach-muted">Contextos relacionados opcionais</p><div className="mt-2 flex flex-wrap gap-2">{relatedContexts.map((context) => <label key={context.subject} className="flex items-center gap-2 rounded-full border border-coach-line px-3 py-2 text-xs"><input type="checkbox" checked={selectedRelated.includes(context.subject)} onChange={(event) => setSelectedRelated((current) => event.target.checked ? [...current, context.subject] : current.filter((item) => item !== context.subject))} />{context.subject}</label>)}</div></div>}</section>
         <section className="mt-6 rounded-2xl border border-dashed border-coach-line p-5"><h3 className="font-display text-xl font-black">Materiais para personalização</h3><p className="mt-2 text-sm text-coach-muted">PDF e PPTX poderão ser selecionados e analisados antes da criação na próxima etapa deste fluxo.</p></section>
         <section className="mt-6 rounded-2xl bg-white/[.03] p-5"><h3 className="font-display text-xl font-black">Resumo</h3><p className="mt-2 text-sm text-coach-muted">O Coach preparará {name || 'o tema'} para o nível {declaredLevel ? ({ beginner: 'iniciante', intermediate: 'intermediário', advanced: 'avançado' } as const)[declaredLevel] : 'ainda não informado'}, usando seu objetivo e contexto acadêmico sem transformar declarações em domínio comprovado.</p></section>
         {question && <label className="mt-5 block rounded-xl border border-[#39334f] bg-[#181622] p-4 text-sm font-bold"><span className="text-[#aa9cff]">Coach quer entender você</span><span className="mt-2 block font-normal leading-6 text-[#c8cad0]">{question}</span><textarea autoFocus maxLength={1000} value={diagnosticAnswer} onChange={(event) => setDiagnosticAnswer(event.target.value)} placeholder="Conte o que já estudou, praticou e onde trava…" className="mt-3 min-h-24 w-full resize-none rounded-lg border border-[#39334f] bg-[#111217] px-4 py-3 outline-none" /></label>}
         {analyzed && <label className="mt-5 block text-sm font-bold">Objetivo sugerido pelo Coach<textarea maxLength={500} value={objective} onChange={(event) => setObjective(event.target.value)} className="mt-2 min-h-24 w-full resize-none rounded-xl border border-coach-line bg-[#111217] px-4 py-3 outline-none focus:border-coach-green" /></label>}
         {analysisError && <p className="mt-4 text-xs text-red-400">{analysisError}</p>}
        <div className="mt-7 flex justify-end gap-3">
          <button type="button" disabled={submitting} onClick={onClose} className="rounded-xl border border-coach-line px-5 py-3 font-bold disabled:opacity-50">Cancelar</button>
           <button type="submit" disabled={submitting || analyzing || name.trim().length < 2 || Boolean(question && !diagnosticAnswer.trim())} className="rounded-xl bg-coach-orange px-5 py-3 font-extrabold text-white disabled:opacity-50">{submitting ? 'Criando…' : analyzing ? 'Coach analisando…' : analyzed ? 'Criar Workspace' : question ? 'Continuar com o Coach' : 'Analisar tema'}</button>
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
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose)

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
    <div ref={dialogRef} className="fixed inset-0 z-30 overflow-y-auto bg-coach-ink/55 p-3 backdrop-blur-sm sm:p-5" role="dialog" aria-modal="true" aria-labelledby="provider-settings-title">
      <div className="flex min-h-full items-center justify-center">
      <section className="my-3 w-full max-w-lg rounded-[2rem] bg-coach-paper p-5 shadow-2xl sm:my-5 sm:p-7">
        <div className="flex items-start justify-between"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">BYOK · sua chave</p><h2 id="provider-settings-title" className="mt-2 font-display text-3xl font-black">Provedor de IA</h2></div><button type="button" aria-label="Fechar" onClick={() => { setApiKey(''); onClose() }} className="rounded-full p-2 hover:bg-black/5"><X /></button></div>
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
  const [workspaceCreationInitial, setWorkspaceCreationInitial] = useState<{ name: string; objective: string } | null>(null)
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
  const studySelectionEpoch = useRef(0)
  const workspaceDrafts = useRef(new Map<string, string>())
  const workspaceMessageEnd = useRef<HTMLDivElement | null>(null)
  const workspaceConversationPane = useRef<HTMLDivElement | null>(null)
  const workspaceFollowLatest = useRef(true)
  const [studyState, setStudyState] = useState<StudyWorkspaceState | null>(null)
  const [editorContent, setEditorContent] = useState('')
  const [studyNotes, setStudyNotes] = useState('')
  const [documentSavedAt, setDocumentSavedAt] = useState<number | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const notesDialogRef = useDialogFocus<HTMLDivElement>(notesOpen, () => setNotesOpen(false))
  const [timerNow, setTimerNow] = useState(Date.now())
  const [planUpdating, setPlanUpdating] = useState(false)
  const [execution, setExecution] = useState<CodeExecutionResult | null>(null)
  const [practiceContext, setPracticeContext] = useState<{ fileName: string; language: string; code: string; execution: CodeExecutionResult | null } | null>(null)
  const [interactiveCodeContext, setInteractiveCodeContext] = useState<{ block: InteractiveCodeBlock; state: InteractiveCodeState } | null>(null)
  const [activeExerciseContext, setActiveExerciseContext] = useState<ActiveExerciseContext | null>(null)
  const [exerciseRoadmap, setExerciseRoadmap] = useState<Roadmap | null>(null)
  const [exerciseTopicId, setExerciseTopicId] = useState<string | null>(null)
  const [executing, setExecuting] = useState(false)
  const [observerState, setObserverState] = useState<ObserverState | null>(null)
  const [sessionCompleting, setSessionCompleting] = useState(false)
  const [timerUpdating, setTimerUpdating] = useState(false)
  const [sessionHistory, setSessionHistory] = useState<DailyStudyReport[]>([])
  const [priorities, setPriorities] = useState<WorkspacePriority[]>([])
  const [globalReport, setGlobalReport] = useState<GlobalReportOverview | null>(null)
  const [studyRoadmap, setStudyRoadmap] = useState<Roadmap | null>(null)
  const [learningPathState, setLearningPathState] = useState<LearningPathState | null>(null)
  const [learningPathOpen, setLearningPathOpen] = useState(false)
  const [studyModule, setStudyModule] = useState<RoadmapModule | null>(null)
  const [studyProgress, setStudyProgress] = useState<StudyProgressState | null>(null)
  const [studyLesson, setStudyLesson] = useState<PersistedStudyLesson | null>(null)
  const [studyLessonLoad, setStudyLessonLoad] = useState<StudyLessonLoadResult | null>(null)
  const [studyLessonRetryNonce, setStudyLessonRetryNonce] = useState(0)
  const [deadlineOpen, setDeadlineOpen] = useState(false)
  const [planningOpen, setPlanningOpen] = useState(false)
  const [routineInput, setRoutineInput] = useState('')
  const [routineNotes, setRoutineNotes] = useState<string[]>([])
  const [schedule, setSchedule] = useState<StudyScheduleItem[]>([])
  const [academicOverview, setAcademicOverview] = useState<AcademicOverview | null>(null)
  const [materialsOpen, setMaterialsOpen] = useState(false)
  const [materials, setMaterials] = useState<MaterialSummary[]>([])
  const [materialQuery, setMaterialQuery] = useState('')
  const [materialResults, setMaterialResults] = useState<MaterialSearchResult[]>([])
  const [activeMaterial, setActiveMaterial] = useState<{ materialId: string; name: string; pageOrSlide: number | null; selectedText: string | null } | null>(null)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [outline, setOutline] = useState<SessionOutlineItem[]>([])
  const [savedForLater, setSavedForLater] = useState<SavedForLaterItem[]>([])
  const [laterInput, setLaterInput] = useState('')
  const [plannerActions, setPlannerActions] = useState<PlannerAction[]>([])
  const studyStateRef = useRef<StudyWorkspaceState | null>(null)
  const editorContentRef = useRef('')
  const lastInterventionSignature = useRef<string | null>(null)
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
    void window.coach.planning.getAcademicOverview().then(setAcademicOverview)
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
    workspaceFollowLatest.current = true
    setWorkspaceMessages([])
    setWorkspaceStreamedContent('')
    setActiveMaterial(null)
    setWorkspaceError(null)
    setExecution(null)
    setPracticeContext(null)
    setInteractiveCodeContext(null)
    setActiveExerciseContext(null)
    setExerciseRoadmap(null)
    setExerciseTopicId(null)
    setStudyState(null)
    studySelectionEpoch.current += 1
    setStudyRoadmap(null)
    setLearningPathState(null)
    setLearningPathOpen(false)
    setStudyModule(null)
    setStudyProgress(null)
    setInteractiveCodeContext(null)
    setStudyLesson(null)
    setStudyLessonLoad(null)
    setObserverState(null)
    setExecuting(false)
    if (!selected) return
    setWorkspaceLoading(true)
    void Promise.all([window.coach.conversation.listWorkspaceMessages(selected.id), window.coach.studyWorkspace.refreshLivePlan({ workspaceId: selected.id }), window.coach.observer.getState(selected.id)])
      .then(([loaded, state, observer]) => { if (workspaceLoadEpoch.current === epoch) { setWorkspaceMessages(loaded); setStudyState(state); setObserverState(observer); setEditorContent(state.editorContent); setStudyNotes(state.notes); documentRevision.current = state.documentRevision; notesRevision.current = state.notesRevision } })
      .catch(() => { if (workspaceLoadEpoch.current === epoch) setWorkspaceError('Não foi possível carregar a conversa deste Workspace.') })
      .finally(() => { if (workspaceLoadEpoch.current === epoch) setWorkspaceLoading(false) })
    return () => { workspaceLoadEpoch.current += 1 }
  }, [selected?.id])

  useEffect(() => { studyStateRef.current = studyState }, [studyState])
  useEffect(() => { editorContentRef.current = editorContent }, [editorContent])
  useEffect(() => { studyNotesRef.current = studyNotes }, [studyNotes])

  useEffect(() => {
    if (!selected || workspacePage !== 'studies' || !learningPathState || (learningPathState.status === 'ready' && studyLessonLoad !== null) || learningPathState.status === 'failed_retryable' || learningPathState.status === 'waiting_for_provider') return
    const workspaceId = selected.id
    let cancelled = false
    let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const state = await window.coach.roadmap.getLearningPathState(workspaceId)
        if (cancelled) return
        if (state.status !== 'ready') { setLearningPathState(state); return }
        const [roadmap, saved] = await Promise.all([window.coach.roadmap.get(workspaceId), window.coach.studyProgress.get(workspaceId)])
        if (cancelled) return
        if (!roadmap) { setLearningPathState(state); setWorkspaceError('A Trilha está pronta, mas não foi possível carregar seu conteúdo.'); return }
        const restoredModule = saved?.roadmapId === roadmap.id ? roadmap.modules.find((item) => item.id === saved.moduleId) : null
        const module = restoredModule ?? roadmap.modules.find((item) => item.status === 'active' || item.status === 'available') ?? roadmap.modules[0]
        if (!module) { setLearningPathState(state); setWorkspaceError('A Trilha está pronta, mas não possui módulos disponíveis.'); return }
        const topicId = saved?.roadmapId === roadmap.id && saved.moduleId === module.id && module.topics.some((topic) => `${module.id}:${topic}` === saved.topicId) ? saved.topicId : `${module.id}:${module.topics[0] ?? module.title}`
        const selectionEpoch = ++studySelectionEpoch.current
        const lessonLoad = await window.coach.studyLesson.getOrCreate({ workspaceId, roadmapId: roadmap.id, moduleId: module.id, topicId })
        if (cancelled || studySelectionEpoch.current !== selectionEpoch) return
        setStudyLessonLoad(lessonLoad)
        if (lessonLoad.status !== 'ready') { setStudyRoadmap(roadmap); setStudyModule(module); setStudyLesson(null); setStudyProgress(saved?.topicId === topicId ? saved : null); setLearningPathState(state); return }
        const progress = saved?.topicId === topicId ? saved : await window.coach.studyProgress.select({ workspaceId, roadmapId: roadmap.id, moduleId: module.id, topicId, lessonId: lessonLoad.lesson.id, checkpointId: null })
        if (!cancelled && studySelectionEpoch.current === selectionEpoch) { setStudyRoadmap(roadmap); setStudyModule(module); setStudyLesson(lessonLoad.lesson); setStudyProgress(progress); setLearningPathState(state) }
      } catch { if (!cancelled) setWorkspaceError('Não foi possível acompanhar a preparação da Trilha agora.') }
      finally { polling = false }
    }
    void poll()
    const interval = window.setInterval(() => void poll(), 2500)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [selected?.id, workspacePage, learningPathState?.status, learningPathState?.retryAfter, studyLessonLoad, studyLessonRetryNonce])

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
    if (pane && workspaceFollowLatest.current) pane.scrollTop = pane.scrollHeight
  }, [workspaceMessages, workspaceStreamedContent])

  async function sendPlannerMessage() {
    const content = plannerInput.trim()
    if (!content || plannerSending || plannerLoading) return
    setPlannerSending(true); setPlannerInput(''); setPlannerError(null)
    try {
      const turn = await window.coach.conversation.organizeHomeMessage({ content })
      setMessages(turn.messages); setPlannerActions(await window.coach.plannerAction.listPending())
      if (turn.result.outcome === 'applied') { const [nextPriorities, nextSchedule, overview] = await Promise.all([window.coach.planning.listPriorities(), window.coach.planning.getSchedule(), window.coach.planning.getAcademicOverview()]); setPriorities(nextPriorities); setSchedule(nextSchedule); setAcademicOverview(overview) }
      if (turn.result.outcome === 'failed') setPlannerError(turn.result.message)
    } catch { setPlannerInput(content); setPlannerError('Não foi possível concluir este turno da Organizadora.') }
    finally { setPlannerSending(false); setStreamedContent('') }
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

  async function sendWorkspaceMessage(contentOverride?: string) {
    const content = (contentOverride ?? workspaceInput).trim()
    if (!selected || !content || workspaceSending || workspaceLoading) return
    if (workspacePage === 'studies' && (!studyProgress || !studyModule)) { setWorkspaceError('Aguarde o tópico atual ser carregado antes de conversar com o Coach.'); return }
    if (!providerStatus?.configured) {
      setWorkspaceError('Conecte um provedor de IA na Home antes de conversar neste Workspace.')
      return
    }
    if (providerStatus.quota === 'exhausted') {
      setWorkspaceError('O provedor está acessível, mas a cota disponível foi esgotada.')
      return
    }
    if (providerStatus.connectionState === 'unreachable') {
      setWorkspaceError('O provedor configurado está indisponível no momento.')
      return
    }
    if (workspacePage === 'exercises' && activeExerciseContext) {
      try { await activeExerciseContext.flushDraft() }
      catch { setWorkspaceError('Não foi possível salvar o código atual antes de consultar o Tutor.'); return }
    }
    if (workspacePage === 'studies' && studyProgress && studyModule && /\b(não entendi|nao entendi|ajuda|dica|explique|explica)\b/i.test(content)) {
      void window.coach.studyProgress.record({ workspaceId: selected.id, type: 'HELP_USED', moduleId: studyProgress.moduleId, topicId: studyProgress.topicId, lessonId: studyProgress.lessonId, checkpointId: studyProgress.checkpointId }).then((event) => event.shouldReplan ? window.coach.studyWorkspace.recalculatePlan({ workspaceId: selected.id }).then(setStudyState) : undefined)
    }
    workspaceFollowLatest.current = true
    setWorkspaceSending(true)
    setWorkspaceMessages((current) => [...current, { id: `optimistic-${crypto.randomUUID()}`, role: 'user', content, createdAt: Date.now(), sequence: (current.at(-1)?.sequence ?? 0) + 1, providerId: null, modelId: null }])
    workspaceDrafts.current.set(selected.id, content)
    setWorkspaceInput('')
    setWorkspaceStreamedContent('')
    setWorkspaceError(null)
    const requestId = crypto.randomUUID()
    const workspaceId = selected.id
    const epoch = workspaceLoadEpoch.current
    const isCurrentRequest = () => workspaceLoadEpoch.current === epoch
    const latestExecution = workspacePage === 'practice' ? practiceContext?.execution ?? execution : null
    const activeTopic = studyModule?.topics.find((topic) => `${studyModule.id}:${topic}` === studyProgress?.topicId)
    const activeLesson = studyLesson?.topicId === studyProgress?.topicId ? studyLesson : null
    const currentBlock = activeLesson?.blocks.find((block) => block.id === studyProgress?.currentPosition?.currentBlockId)
    const currentExcerpt = studyLessonBlockExcerpt(currentBlock)
    const requestMaterial = workspacePage === 'materials' ? activeMaterial : null
    workspaceStreamHandle.current = window.coach.conversation.streamWorkspaceMessage({ requestId, workspaceId, content, activePage: workspacePage, activeExercise: workspacePage === 'exercises' && activeExerciseContext ? { exerciseId: activeExerciseContext.exerciseId } : undefined, activeMaterial: requestMaterial, activeStudy: workspacePage === 'studies' && studyModule && studyProgress && activeTopic && activeLesson && studyProgress.currentPosition ? { roadmapId: activeLesson.roadmapId, moduleId: studyModule.id, module: studyModule.title, topicId: studyProgress.topicId, topic: activeTopic, lessonId: activeLesson.id, currentBlockId: studyProgress.currentPosition.currentBlockId, checkpointId: studyProgress.checkpointId, currentExcerpt } : undefined, activeInteractiveCode: workspacePage === 'studies' && interactiveCodeContext ? { lessonId: interactiveCodeContext.state.lessonId, blockId: interactiveCodeContext.block.id, interactionType: interactiveCodeContext.block.interactionType, instruction: interactiveCodeContext.block.instruction, language: interactiveCodeContext.block.language, code: interactiveCodeContext.state.currentCode, prediction: interactiveCodeContext.state.prediction, attempts: interactiveCodeContext.state.attempts, lastExecution: interactiveCodeContext.state.lastExecution ? { stdout: interactiveCodeContext.state.lastExecution.stdout, stderr: interactiveCodeContext.state.lastExecution.stderr, exitCode: interactiveCodeContext.state.lastExecution.exitCode, timedOut: interactiveCodeContext.state.lastExecution.timedOut } : null, validationResult: interactiveCodeContext.state.validationResult ? { status: interactiveCodeContext.state.validationResult.status, message: interactiveCodeContext.state.validationResult.message } : null } : undefined, practiceContext: workspacePage === 'practice' && practiceContext ? { fileName: practiceContext.fileName, language: practiceContext.language, code: practiceContext.code } : undefined, lastExecution: latestExecution ? { stdout: latestExecution.stdout, stderr: latestExecution.stderr, exitCode: latestExecution.exitCode, timedOut: latestExecution.timedOut } : null }, (event) => {
      if (!isCurrentRequest()) return
      if (event.type === 'text-delta') setWorkspaceStreamedContent((current) => current + event.content)
      if (event.type === 'completed') {
        setWorkspaceMessages(event.messages)
        setWorkspaceStreamedContent('')
        setWorkspaceSending(false)
        workspaceDrafts.current.delete(workspaceId)
        setActiveMaterial(null)
        workspaceStreamHandle.current = null
        if (event.metadata?.lessonAdapted && activeLesson && event.metadata.lessonAdapted.lessonId === activeLesson.id) {
          void window.coach.studyLesson.getOrCreate({ workspaceId, roadmapId: activeLesson.roadmapId, moduleId: activeLesson.moduleId, topicId: activeLesson.topicId }).then((result) => { if (isCurrentRequest() && result.status === 'ready') { setStudyLessonLoad(result); setStudyLesson(result.lesson) } })
        }
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
    const livePriority = priorities.find((item) => item.workspaceId === selected.id)
    const adaptiveMinutes = activeDuration ?? 25
    const applyStudyState = (workspaceId: string, epoch: number) => (state: StudyWorkspaceState) => {
      if (workspaceLoadEpoch.current === epoch && state.workspaceId === workspaceId) setStudyState(state)
    }
    const activePlan = studyState?.plan.find((item) => item.status === 'active')
    const openMaterials = () => { setWorkspacePage('materials'); setMaterialResults([]); void window.coach.material.list(selected.id).then(setMaterials) }
    const openReports = () => { setWorkspacePage('reports'); void window.coach.studyWorkspace.listSessionHistory(selected.id).then(setSessionHistory).catch(() => setWorkspaceError('Não foi possível carregar o histórico.')) }
    const openExercises = (roadmap?: Roadmap, topicId?: string) => {
      studySelectionEpoch.current += 1
      setLearningPathOpen(false); setWorkspaceError(null); setActiveExerciseContext(null); setWorkspacePage('exercises')
      if (roadmap) {
        const firstModule = roadmap.modules.find((module) => module.status !== 'locked' && module.topics.length > 0)
        setExerciseRoadmap(roadmap); setExerciseTopicId(topicId ?? (firstModule ? `${firstModule.id}:${firstModule.topics[0]}` : null)); return
      }
      void Promise.all([window.coach.roadmap.get(selected.id), window.coach.studyProgress.get(selected.id)]).then(([loadedRoadmap, saved]) => {
        if (!loadedRoadmap) { setWorkspaceError('Crie ou aceite uma Trilha antes de abrir os exercícios.'); return }
        const savedTopic = saved?.roadmapId === loadedRoadmap.id && loadedRoadmap.modules.some((module) => module.status !== 'locked' && module.id === saved.moduleId && module.topics.some((topic) => `${module.id}:${topic}` === saved.topicId)) ? saved.topicId : null
        const firstModule = loadedRoadmap.modules.find((module) => module.status !== 'locked' && module.topics.length > 0)
        setExerciseRoadmap(loadedRoadmap); setExerciseTopicId(savedTopic ?? (firstModule ? `${firstModule.id}:${firstModule.topics[0]}` : null))
      }).catch(() => setWorkspaceError('Não foi possível carregar a Trilha de exercícios.'))
    }
    const selectStudyTopic = async (roadmap: Roadmap, module: RoadmapModule, topicIndex: number) => {
      const selectionEpoch = ++studySelectionEpoch.current
      const topic = module.topics[topicIndex] ?? module.title
      const topicId = `${module.id}:${topic}`
      const lessonLoad = await window.coach.studyLesson.getOrCreate({ workspaceId: selected.id, roadmapId: roadmap.id, moduleId: module.id, topicId })
      if (studySelectionEpoch.current !== selectionEpoch) return
      setStudyRoadmap(roadmap); setStudyModule(module); setStudyLessonLoad(lessonLoad)
      if (lessonLoad.status !== 'ready') { setStudyLesson(null); setStudyProgress(null); return }
      const progress = await window.coach.studyProgress.select({ workspaceId: selected.id, roadmapId: roadmap.id, moduleId: module.id, topicId, lessonId: lessonLoad.lesson.id, checkpointId: null })
      if (studySelectionEpoch.current !== selectionEpoch) return
      setStudyLesson(lessonLoad.lesson); setStudyProgress(progress)
    }
    const openStudies = (moduleId?: string) => {
      const selectionEpoch = ++studySelectionEpoch.current
      setWorkspacePage('studies'); setLearningPathOpen(false); setWorkspaceError(null); setLearningPathState(null); setStudyRoadmap(null); setStudyModule(null); setStudyLesson(null); setStudyLessonLoad(null); setStudyProgress(null)
      void window.coach.roadmap.getLearningPathState(selected.id).then(async (pathState) => {
        if (studySelectionEpoch.current !== selectionEpoch) return
        setLearningPathState(pathState)
        const [roadmap, saved] = await Promise.all([window.coach.roadmap.get(selected.id), window.coach.studyProgress.get(selected.id)])
        if (studySelectionEpoch.current !== selectionEpoch) return
        if (!roadmap) { if (pathState.status === 'ready') setWorkspaceError('A Trilha está pronta, mas não foi possível carregar seu conteúdo.'); return }
        const restoredModule = saved?.roadmapId === roadmap.id ? roadmap.modules.find((item) => item.id === saved.moduleId) : null
        const requested = roadmap.modules.find((item) => item.id === moduleId)
        const module = requested ?? restoredModule ?? roadmap.modules.find((item) => item.status === 'active' || item.status === 'available') ?? roadmap.modules[0]
        if (!module) { setWorkspaceError('A Trilha está pronta, mas não possui módulos disponíveis.'); return }
        if (saved?.roadmapId === roadmap.id && saved.moduleId === module.id && module.topics.some((topic) => `${module.id}:${topic}` === saved.topicId)) {
          const lessonLoad = await window.coach.studyLesson.getOrCreate({ workspaceId: selected.id, roadmapId: roadmap.id, moduleId: module.id, topicId: saved.topicId })
          if (studySelectionEpoch.current !== selectionEpoch) return
          setStudyRoadmap(roadmap); setStudyModule(module); setStudyLessonLoad(lessonLoad)
          if (lessonLoad.status === 'ready') { setStudyLesson(lessonLoad.lesson); setStudyProgress(saved) }
          return
        }
        if (studySelectionEpoch.current === selectionEpoch) await selectStudyTopic(roadmap, module, 0)
      }).catch(() => { if (studySelectionEpoch.current === selectionEpoch) setWorkspaceError('Não foi possível abrir os estudos agora.') })
    }
    const leaveExercises = async () => { await activeExerciseContext?.flushDraft(); setActiveExerciseContext(null) }
    const selectPage = (page: WorkspacePage) => { void (async () => { if (workspacePage === 'exercises' && page !== 'exercises') await leaveExercises(); if (page === 'studies') openStudies(); else if (page === 'exercises') openExercises(); else { studySelectionEpoch.current += 1; setLearningPathOpen(false); setStudyModule(null); if (page === 'materials') openMaterials(); else if (page === 'reports') openReports(); else if (page === 'plan') { setWorkspacePage(page); void window.coach.studyWorkspace.recalculatePlan({ workspaceId: selected.id }).then(setStudyState).catch(() => setWorkspaceError('Não foi possível recalcular o plano de hoje.')) } else setWorkspacePage(page) } })() }
    return (
      <WorkspaceShell name={selected.name} objective={selected.objective} page={workspacePage} timerLabel={timerLabel} timerRunning={studyState?.timerStatus === 'running'} finishing={sessionCompleting} coachMessages={workspaceMessages} streamedMessage={workspaceStreamedContent} coachInput={workspaceInput} coachBusy={workspaceSending || workspaceLoading} coachError={workspaceError} conversationRef={workspaceConversationPane} messageEndRef={workspaceMessageEnd} onConversationScroll={() => { const pane = workspaceConversationPane.current; if (pane) workspaceFollowLatest.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 72 }} onPage={selectPage} onHome={() => { void (workspacePage === 'exercises' ? leaveExercises() : Promise.resolve()).then(() => { setSelected(null); setHomeSection('home'); void window.coach.planning.listPriorities().then(setPriorities) }) }} onSettings={() => setProviderDialogOpen(true)} onToggleTimer={() => { if (!studyState || timerUpdating) return; const workspaceId = selected.id; const epoch = workspaceLoadEpoch.current; const action = studyState.timerStatus === 'running' ? 'pause' : 'start'; setTimerUpdating(true); const configure = action === 'start' && studyState.timerStatus === 'idle' && studyState.timerDurationSeconds !== adaptiveMinutes * 60 ? window.coach.studyWorkspace.setTimerDuration({ workspaceId, durationSeconds: adaptiveMinutes * 60 }) : Promise.resolve(studyState); void configure.then(() => window.coach.studyWorkspace.updateTimer({ workspaceId, action })).then(applyStudyState(workspaceId, epoch)).catch(() => setWorkspaceError('Não foi possível atualizar o foco.')).finally(() => setTimerUpdating(false)) }} onFinish={() => { if (sessionCompleting) return; setSessionCompleting(true); void window.coach.studyWorkspace.completeSession(selected.id).then(setStudyState).finally(() => setSessionCompleting(false)) }} onCoachInput={setWorkspaceInput} onCoachSend={sendWorkspaceMessage} onNotes={() => setNotesOpen(true)}>
        {workspacePage === 'studies' && <div className="relative flex h-full min-h-0 flex-col overflow-hidden">{livePriority?.eventPhase === 'today' && <div className="shrink-0 border-b border-coach-orange/30 bg-coach-orange/10 px-6 py-3 text-xs text-coach-muted"><strong className="text-coach-orange">Revisão para a prova hoje.</strong> A aula continua completa; pontos de revisão recebem destaque visual.</div>}{studyModule && studyRoadmap && studyProgress && studyLesson ? <><div className="flex shrink-0 items-center justify-between gap-4 border-b border-coach-line px-6 py-3"><p className="min-w-0 truncate text-xs text-coach-muted"><span className="text-coach-ink">{selected.name}</span><span className="mx-2">›</span>{studyModule.title}<span className="mx-2">›</span><span className="text-coach-ink">{studyModule.topics.find((topic) => `${studyModule.id}:${topic}` === studyProgress.topicId) ?? studyModule.title}</span></p><button aria-expanded={learningPathOpen} aria-controls="learning-path-drawer" onClick={() => setLearningPathOpen(true)} className="shrink-0 rounded-lg border border-coach-line px-3 py-2 text-xs font-black text-coach-green hover:bg-white/[.03]">Trilha de aprendizado</button></div><div className="min-h-0 flex-1"><StudyLessonView workspaceId={selected.id} module={studyModule} roadmap={studyRoadmap} lesson={studyLesson} progress={studyProgress} reviewMode={livePriority?.eventPhase === 'today'} onExercises={() => openExercises(studyRoadmap, studyProgress.topicId)} onPosition={(position, checkpointStates) => { void window.coach.studyProgress.updatePosition({ workspaceId: selected.id, position, checkpointStates }).then(setStudyProgress) }} onLessonChanged={setStudyLesson} onInteractiveContext={(block, state) => setInteractiveCodeContext({ block, state })} onCheckpoint={() => { void window.coach.studyWorkspace.recalculatePlan({ workspaceId: selected.id }).then(setStudyState) }} onComplete={() => { void window.coach.studyProgress.completeTopic({ workspaceId: selected.id, topicId: studyProgress.topicId }).then(({ state, nextTarget }) => { setStudyProgress(state); if (nextTarget) setStudyLesson(null); return Promise.all([window.coach.studyWorkspace.recalculatePlan({ workspaceId: selected.id }).then(setStudyState), window.coach.roadmap.get(selected.id).then((roadmap) => { if (roadmap) { setStudyRoadmap(roadmap); const module = nextTarget ? roadmap.modules.find((item) => item.id === nextTarget.moduleId) : null; if (module) setStudyModule(module) } }), nextTarget ? window.coach.studyLesson.getOrCreate({ workspaceId: selected.id, roadmapId: studyProgress.roadmapId, moduleId: nextTarget.moduleId, topicId: nextTarget.topicId }).then((result) => { if (result.status === 'ready') setStudyLesson(result.lesson); else setWorkspaceError(result.status === 'waiting_for_provider' ? 'A próxima aula aguarda um provedor de IA.' : 'Não foi possível preparar a próxima aula agora.') }) : Promise.resolve()]) }).catch((error) => setWorkspaceError(error instanceof Error ? error.message : 'Ainda existem critérios obrigatórios pendentes.')) }} onPractice={() => setWorkspacePage('practice')} /></div><LearningPathDrawer open={learningPathOpen} roadmap={studyRoadmap} progress={studyProgress} onClose={() => setLearningPathOpen(false)} onSelect={(module, topicIndex) => selectStudyTopic(studyRoadmap, module, topicIndex).catch((error) => { setWorkspaceError('Não foi possível abrir este tópico agora.'); throw error })} /></> : <div className="grid min-h-0 flex-1 place-items-center p-8 text-center"><div><p className="font-display text-xl font-black text-coach-ink">{studyLessonLoad?.status === 'waiting_for_provider' ? 'Esta aula será preparada quando a IA estiver disponível.' : studiesPreparationMessage(studyLessonLoad, learningPathState)}</p><p className="mt-2 text-xs text-coach-muted">Você pode continuar usando o Coach enquanto isso.</p>{studyLessonLoad && studyLessonLoad.status !== 'ready' && <button onClick={() => { setStudyLessonLoad(null); setStudyLessonRetryNonce((value) => value + 1) }} className="mt-4 rounded-lg bg-coach-orange px-4 py-2 text-xs font-black text-white">Tentar novamente</button>}{learningPathState?.status === 'failed_retryable' && <button onClick={() => { void window.coach.roadmap.generate(selected.id).then(() => openStudies()).catch(() => setWorkspaceError('Não foi possível tentar preparar a Trilha agora.')) }} className="mt-4 rounded-lg bg-coach-orange px-4 py-2 text-xs font-black text-white">Tentar novamente</button>}{studyRoadmap && <><button onClick={() => setLearningPathOpen(true)} className="ml-2 mt-4 rounded-lg border border-coach-line px-4 py-2 text-xs font-black text-coach-green">Ver Trilha</button><LearningPathDrawer open={learningPathOpen} roadmap={studyRoadmap} progress={studyProgress} onClose={() => setLearningPathOpen(false)} onSelect={(module, topicIndex) => selectStudyTopic(studyRoadmap, module, topicIndex).catch(() => setWorkspaceError('Não foi possível abrir este tópico agora.'))} /></>}</div></div>}</div>}
        {workspacePage === 'exercises' && exerciseRoadmap && exerciseTopicId && <ExercisesWorkspace workspaceId={selected.id} roadmap={exerciseRoadmap} initialTopicId={exerciseTopicId} onBack={() => { void leaveExercises().then(() => openStudies()) }} onContext={setActiveExerciseContext} />}
        {workspacePage === 'exercises' && (!exerciseRoadmap || !exerciseTopicId) && <div className="grid h-full place-items-center p-8 text-center"><div><p className="font-display text-xl font-black">Carregando a Trilha de exercícios…</p><p className="mt-2 text-xs text-coach-muted">Os exercícios só serão gerados quando você abrir um tópico disponível.</p><button type="button" onClick={() => openStudies()} className="mt-4 rounded-lg border border-coach-line px-4 py-2 text-xs font-black text-coach-green">Voltar aos Estudos</button></div></div>}
        {workspacePage === 'overview' && <div className="coach-scroll-pane h-full p-5 lg:p-8"><div className="mx-auto max-w-5xl"><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Visão geral</p><h2 className="mt-2 font-display text-3xl font-black">Continue de onde parou.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-coach-muted">Objetivo, progresso, foco e próximo passo reunidos em um único lugar.</p><div className="mt-7 grid gap-4 md:grid-cols-3"><article className="rounded-lg border border-coach-line bg-[#111217] p-5"><span className="text-xs font-black text-coach-muted">Módulo atual</span><strong className="mt-2 block font-display text-xl">{planActionLabel(activePlan)}</strong><p className="mt-2 text-xs text-coach-muted">{activePlan?.durationMinutes ?? 0} minutos sugeridos</p></article><article className="rounded-lg border border-coach-line bg-[#111217] p-5"><span className="text-xs font-black text-coach-muted">Progresso de hoje</span><strong className="mt-2 block font-display text-3xl">{studyState?.plan.length ? Math.round(completedItems / studyState.plan.length * 100) : 0}%</strong><div className="mt-3 h-2 overflow-hidden rounded-full bg-coach-line"><div className="h-full bg-coach-green" style={{ width: `${studyState?.plan.length ? completedItems / studyState.plan.length * 100 : 0}%` }} /></div></article><article className="rounded-lg bg-[#12372f] p-5 text-white"><span className="text-xs font-black text-white/55">Observer</span><strong className="mt-2 block font-display text-xl">{observerState?.interventionSuggested ? 'Atenção necessária' : 'Progresso estável'}</strong><p className="mt-2 text-xs text-white/55">{observerState?.focusExitCount ?? 0} saídas de foco</p></article></div><div className="mt-5 rounded-xl bg-[#181622] p-6"><p className="text-xs font-black uppercase text-coach-orange">Próximo passo</p><div className="mt-2 flex flex-wrap items-center justify-between gap-4"><div><strong className="font-display text-2xl">{activePlan?.title ?? 'Revisar aprendizados'}</strong><p className="mt-1 text-sm text-coach-muted">Abra a prática para trabalhar com arquivos reais.</p></div><button onClick={() => setWorkspacePage('practice')} className="rounded-xl bg-coach-orange px-5 py-3 text-sm font-black text-white">Começar prática</button></div></div></div></div>}
        {workspacePage === 'plan' && <div className="coach-scroll-pane h-full p-5 lg:p-8"><div className="mx-auto max-w-5xl"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Plano de hoje</p><h2 className="mt-2 font-display text-3xl font-black">Hoje você vai estudar</h2></div><p className="text-xs text-coach-muted">{studyState?.plan.filter((item) => item.status === 'completed').length ?? 0}/{studyState?.plan.length ?? 0} atividades concluídas</p></div><div className="mt-6 space-y-3">{studyState?.plan.map((item) => <button disabled={planUpdating} key={item.id} onClick={() => { setPlanUpdating(true); void window.coach.studyWorkspace.activatePlanItem({ workspaceId: selected.id, itemId: item.id }).then(setStudyState).finally(() => setPlanUpdating(false)) }} className={`flex w-full items-center gap-4 rounded-lg border p-4 text-left ${item.status === 'active' ? 'border-coach-yellow bg-[#181622]' : 'border-coach-line bg-[#111217]'}`}><span className={`grid size-7 place-items-center rounded-full border ${item.status === 'completed' ? 'border-coach-green bg-coach-green text-white' : 'border-coach-line'}`}>{item.status === 'completed' ? '✓' : item.position}</span><span className="min-w-0 flex-1"><strong className="block truncate">{item.title}</strong><small className="text-coach-muted">{item.scheduledStartMinutes !== undefined ? `${String(Math.floor(item.scheduledStartMinutes / 60)).padStart(2, '0')}:${String(item.scheduledStartMinutes % 60).padStart(2, '0')} · ` : ''}{item.durationMinutes} min · {item.status}</small></span></button>)}</div></div></div>}
        {workspacePage === 'materials' && <div className="coach-scroll-pane h-full p-5 lg:p-8"><div className="mx-auto max-w-5xl"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Biblioteca</p><h2 className="mt-2 font-display text-3xl font-black">Materiais do Workspace</h2></div><button onClick={() => void window.coach.material.importFile(selected.id).then((material) => { if (material) setMaterials((current) => [material, ...current]) }).catch((error: unknown) => setWorkspaceError(error instanceof Error ? error.message : 'Não foi possível importar este material.'))} className="rounded-xl bg-coach-orange px-5 py-3 text-sm font-black text-white">Importar PDF/PPTX</button></div><form className="mt-6 flex gap-2" onSubmit={(event) => { event.preventDefault(); void window.coach.material.search({ workspaceId: selected.id, query: materialQuery }).then(setMaterialResults) }}><input minLength={2} value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} placeholder="Buscar nos materiais" className="min-w-0 flex-1 rounded-xl border border-coach-line bg-[#111217] p-3" /><button className="rounded-xl bg-coach-ink px-5 font-black text-white">Buscar</button></form><div className="mt-6 grid gap-4 md:grid-cols-2">{materialResults.map((item) => <article key={`${item.materialId}-${item.pageNumber}`} className="rounded-lg border border-coach-line bg-[#111217] p-5"><strong>{item.materialName} · pág. {item.pageNumber}</strong><p className="mt-3 text-sm leading-6 text-coach-muted">{item.content}</p><button onClick={() => { setActiveMaterial({ materialId: item.materialId, name: item.materialName, pageOrSlide: item.pageNumber, selectedText: item.content.slice(0, 2000) }); setWorkspaceInput(`Explique o trecho selecionado deste material.`) }} className="mt-3 text-xs font-black text-coach-green">Perguntar ao Coach</button></article>)}{!materialResults.length && materials.map((item) => <article key={item.id} className="rounded-lg border border-coach-line bg-[#111217] p-5"><strong className="block break-words">{item.name}</strong><p className="mt-1 text-xs text-coach-muted">{item.pageCount} páginas · {item.semanticAnalysis?.documentType ?? item.mediaType} · relevância {item.semanticAnalysis?.relevance ?? 'aguardando análise'}</p>{item.semanticAnalysis && <><p className="mt-2 text-sm">{item.semanticAnalysis.summary}</p><p className="mt-2 text-xs text-coach-muted">{item.semanticAnalysis.topics.join(' · ')}</p></>}{item.status === 'staged' && <div className="mt-4 flex flex-wrap gap-2"><select defaultValue="reference" id={`role-${item.id}`} className="rounded-lg border border-coach-line bg-[#0d0e12] p-2 text-xs"><option value="base">Base da disciplina</option><option value="priority">Prioritário</option><option value="reference">Referência</option></select><button onClick={() => { const role = (document.getElementById(`role-${item.id}`) as HTMLSelectElement).value as 'base'|'priority'|'reference'; void window.coach.material.decide({ workspaceId: selected.id, materialId: item.id, decision: 'approve', role }).then((updated) => setMaterials((all) => all.map((value) => value.id === item.id ? updated : value))) }} className="rounded-lg bg-coach-green px-3 py-2 text-xs font-black">{item.semanticAnalysis?.relevance === 'unrelated' ? 'Usar mesmo assim como referência' : 'Usar material'}</button><button onClick={() => void window.coach.material.decide({ workspaceId: selected.id, materialId: item.id, decision: 'discard', role: 'reference' }).then((updated) => setMaterials((all) => all.map((value) => value.id === item.id ? updated : value)))} className="rounded-lg border border-coach-line px-3 py-2 text-xs font-black">Descartar</button></div>}{item.status === 'ready' && <button onClick={() => { setActiveMaterial({ materialId: item.id, name: item.name, pageOrSlide: 1, selectedText: null }); void window.coach.material.readPage({ workspaceId: selected.id, materialId: item.id, pageNumber: 1 }).then((page) => setMaterialResults([{ chunkId: `${item.id}-1`, materialId: item.id, materialName: item.name, pageNumber: 1, topicId: null, retrieval: 'lexical', content: page.content }])) }} className="mt-3 text-xs font-black text-coach-green">Abrir material</button>}</article>)}</div></div></div>}
        {workspacePage === 'practice' && <div className="h-full min-h-0 overflow-hidden"><ProjectWorkspace workspaceId={selected.id} workspaceName={selected.name} onError={setWorkspaceError} onContextChange={(context) => { setPracticeContext(context); setExecution(context.execution); if (context.execution?.observerState) { setObserverState(context.execution.observerState); const signature = context.execution.errorSignature; if (context.execution.observerState.interventionSuggested && signature && lastInterventionSignature.current !== signature) { lastInterventionSignature.current = signature; setWorkspaceMessages((current) => [...current, { id: `intervention-${crypto.randomUUID()}`, role: 'assistant', content: `Percebi que o mesmo erro se repetiu. Estou vendo o código atual e a última execução (${context.execution?.stderr.split('\n').filter(Boolean).at(-1) ?? signature}). Posso dar uma pista específica sem entregar a solução.`, createdAt: Date.now(), sequence: (current.at(-1)?.sequence ?? 0) + 1, providerId: 'coach-observer', modelId: null }]) } } }} /></div>}
        {workspacePage === 'videos' && <div className="coach-scroll-pane h-full p-5 lg:p-8"><div className="mx-auto max-w-5xl"><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Vídeos focados</p><h2 className="mt-2 font-display text-3xl font-black">Aprenda sem sair do contexto</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-coach-muted">Use uma busca direcionada ao objetivo deste Workspace. O Coach mantém a conversa e o plano visíveis sem abrir o feed tradicional.</p><div className="mt-7 rounded-xl border border-coach-line bg-[#111217] p-6"><label className="text-xs font-black uppercase text-coach-muted">Buscar no YouTube</label><div className="mt-3 flex gap-2"><input value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} placeholder={`Ex.: ${activePlan?.title ?? selected.name}`} className="min-w-0 flex-1 rounded-xl border border-coach-line bg-coach-paper p-3" /><button onClick={() => { const query = encodeURIComponent(`${materialQuery || activePlan?.title || selected.name} aula`); window.open(`https://www.youtube.com/results?search_query=${query}`, '_blank', 'noopener,noreferrer') }} className="rounded-xl bg-coach-orange px-5 text-sm font-black text-[#0c0d10]">Pesquisar</button></div><p className="mt-3 text-xs text-coach-muted">Links externos abrem somente após sua ação. Nenhum vídeo é enviado automaticamente ao provedor de IA.</p></div></div></div>}
        {workspacePage === 'reports' && <div className="coach-scroll-pane h-full p-5 lg:p-8"><div className="mx-auto max-w-5xl"><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Evolução</p><h2 className="mt-2 font-display text-3xl font-black">Relatórios de aprendizagem</h2><div className="mt-6 grid gap-4 md:grid-cols-2">{sessionHistory.length === 0 && <p className="rounded-lg bg-[#111217] p-5 text-sm text-coach-muted">Comece a estudar para acumular dados neste relatório.</p>}{sessionHistory.map((session) => <article key={session.date} className="rounded-lg border border-coach-line bg-[#111217] p-5"><div className="flex justify-between"><strong>{new Date(`${session.date}T12:00:00`).toLocaleDateString('pt-BR')} · {session.sessionCount} {session.sessionCount === 1 ? 'sessão' : 'sessões'}</strong><span className="rounded-full bg-coach-green/10 px-3 py-1 text-xs font-black text-coach-green">{Math.floor(session.focusSeconds / 60)} min</span></div><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl bg-coach-paper p-3"><strong className="text-xl">{session.executions ? `${session.executions - session.errors}/${session.executions}` : "Não avaliado"}</strong><span className="block text-[10px] text-coach-muted">Execuções sem erro</span></div><div className="rounded-xl bg-coach-paper p-3"><strong className="text-sm">Ainda não avaliada</strong><span className="block text-[10px] text-coach-muted">Retenção após revisão futura</span></div></div><p className="mt-4 text-xs leading-5 text-coach-muted">{session.recommendation}</p></article>)}</div></div></div>}
        {notesOpen && <div ref={notesDialogRef} className="fixed inset-0 z-20 flex justify-end bg-black/30" role="dialog" aria-modal="true" aria-labelledby="quick-notes-title" onMouseDown={() => setNotesOpen(false)}><section className="flex h-full w-full max-w-md flex-col bg-coach-paper p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><h2 id="quick-notes-title" className="font-display text-2xl font-black">Notas rápidas</h2><button aria-label="Fechar notas" onClick={() => setNotesOpen(false)}><X /></button></div><label htmlFor="quick-notes" className="sr-only">Notas rápidas</label><textarea id="quick-notes" value={studyNotes} onChange={(event) => setStudyNotes(event.target.value)} className="mt-6 min-h-0 flex-1 resize-none rounded-lg border border-coach-line bg-[#111217] p-4" /></section></div>}
        {providerDialogOpen && <ProviderSettingsDialog status={providerStatus} accounts={providerAccounts} onClose={() => setProviderDialogOpen(false)} onConfigured={async (label, apiKey, model, persistence) => { const result = await window.coach.provider.configureOpenAI({ label, apiKey, model, persistence }); setProviderStatus(await window.coach.provider.getStatus()); setProviderAccounts(await window.coach.provider.listAccounts()); return result }} onConfiguredCompatible={async (label, baseUrl, apiKey, model, persistence) => { const result = await window.coach.provider.configureCompatible({ label, baseUrl, apiKey, model, persistence }); setProviderStatus(await window.coach.provider.getStatus()); setProviderAccounts(await window.coach.provider.listAccounts()); return result }} onSelect={async (accountId) => { await window.coach.provider.selectAccount(accountId); setProviderStatus(await window.coach.provider.getStatus()); setProviderAccounts(await window.coach.provider.listAccounts()) }} onRemove={async (accountId) => { await window.coach.provider.removeAccount(accountId); setProviderStatus(await window.coach.provider.getStatus()); setProviderAccounts(await window.coach.provider.listAccounts()) }} />}
      </WorkspaceShell>
    )
  }

  return <>
    <HomeScreen section={homeSection} loading={loading} error={error} report={globalReport} schedule={schedule} academicOverview={academicOverview} workspaces={workspaces} priorities={priorities} messages={messages} streamedContent={streamedContent} plannerActions={plannerActions} plannerInput={plannerInput} plannerBusy={plannerSending || plannerLoading} plannerError={plannerError} providerLabel={providerAccounts.find((account) => account.isActive)?.label ?? 'IA desconectada'} onSection={setHomeSection} onSettings={() => setProviderDialogOpen(true)} onCreate={() => { setWorkspaceCreationInitial(null); setDialogOpen(true) }} onOpen={(id) => void openWorkspace(id)} onArchive={(id) => void archiveWorkspace(id)} onPlannerInput={setPlannerInput} onPlannerSend={() => void sendPlannerMessage()} onResolveAction={(actionId, decision) => { if (plannerSending || plannerLoading) return; setPlannerSending(true); setPlannerError(null); void window.coach.plannerAction.resolve({ actionId, decision }).then(async (action) => { setPlannerActions(await window.coach.plannerAction.listPending()); if (action.type === 'workspace.prepare' && decision === 'apply') { const result = action.result as { name: string; objective: string }; setWorkspaceCreationInitial(result); setDialogOpen(true) } await loadWorkspaces(); const message = decision === 'reject' ? `A ação ${action.label} foi descartada.` : action.type === 'workspace.prepare' ? 'Abri a preparação do Workspace com os dados disponíveis.' : action.type === 'workspace.create' ? `Criei o Workspace ${(action.result as { name?: string } | null)?.name ?? ''}.` : `${action.label} foi aplicada.`; setMessages(await window.coach.conversation.saveHomeActionResult(message)); const [nextPriorities, nextSchedule, overview] = await Promise.all([window.coach.planning.listPriorities(), window.coach.planning.getSchedule(), window.coach.planning.getAcademicOverview()]); setPriorities(nextPriorities); setSchedule(nextSchedule); setAcademicOverview(overview) }).catch(() => setPlannerError('Esta ação já foi executada ou ficou obsoleta.')).finally(() => setPlannerSending(false)) }} />
    {dialogOpen && <WorkspaceCreationScreen open={dialogOpen} submitting={submitting} initial={workspaceCreationInitial} onClose={() => { setDialogOpen(false); setWorkspaceCreationInitial(null) }} onSubmit={createWorkspace} />}
    {providerDialogOpen && <ProviderSettingsDialog status={providerStatus} accounts={providerAccounts} onClose={() => setProviderDialogOpen(false)} onConfigured={async (label, apiKey, model, persistence) => { const result = await window.coach.provider.configureOpenAI({ label, apiKey, model, persistence }); setProviderStatus(await window.coach.provider.getStatus()); setProviderAccounts(await window.coach.provider.listAccounts()); return result }} onConfiguredCompatible={async (label, baseUrl, apiKey, model, persistence) => { const result = await window.coach.provider.configureCompatible({ label, baseUrl, apiKey, model, persistence }); setProviderStatus(await window.coach.provider.getStatus()); setProviderAccounts(await window.coach.provider.listAccounts()); return result }} onSelect={async (accountId) => { await window.coach.provider.selectAccount(accountId); setProviderStatus(await window.coach.provider.getStatus()); setProviderAccounts(await window.coach.provider.listAccounts()) }} onRemove={async (accountId) => { await window.coach.provider.removeAccount(accountId); setProviderStatus(await window.coach.provider.getStatus()); setProviderAccounts(await window.coach.provider.listAccounts()) }} />}
  </>
}
