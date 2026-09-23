import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, CalendarDays, MoreHorizontal, Plus, Send, Sparkles, X } from 'lucide-react'
import type { ApplicationInfo } from '../../shared/contracts/application-contract'
import type { CreateWorkspaceInput, Workspace, WorkspaceHistoryDetail, WorkspaceSummary } from '../../shared/contracts/workspace-contract'
import type { ConversationMessage } from '../../shared/contracts/conversation-contract'
import type {
  ProviderAccountHealthSnapshot,
  ProviderAccountSummary,
  ProviderRuntimeIssue,
  ProviderStatus,
} from '../../shared/contracts/provider-contract'
import type { DailyStudyReport, StudyWorkspaceState } from '../../shared/contracts/study-workspace-contract'
import type { GlobalReportOverview } from '../../shared/contracts/report-contract'
import type { LearningPathState, Roadmap, RoadmapModule, RoadmapRebuildPreview } from '../../shared/contracts/roadmap-contract'
import type { CodeExecutionResult, InteractiveCodeBlock, InteractiveCodeState } from '../../shared/contracts/code-execution-contract'
import { ProjectWorkspace } from './ProjectWorkspace'
import type { PlannerAction } from '../../shared/contracts/planner-action-contract'
import { WorkspaceShell, type WorkspacePage } from './WorkspaceShell'
import { HomeScreen, type HomeSection } from './HomeScreen'
import { refreshAfterAcademicMutation } from './academic-view-model'
import { refreshAcademicProjections } from './academic-projection-refresh'
import type { ObserverState } from '../../shared/contracts/observer-contract'
import type { AcademicOverview, WeeklyPlan, StudyScheduleItem, WorkspacePriority } from '../../shared/contracts/planning-contract'
import type { MaterialSearchResult, MaterialSummary } from '../../shared/contracts/material-contract'
import type { SavedForLaterItem, SessionOutlineItem } from '../../shared/contracts/session-navigation-contract'
import type { StudyProgressState } from '../../shared/contracts/study-progress-contract'
import type { PersistedStudyLesson, StudyLessonLoadResult } from '../../shared/contracts/study-lesson-contract'
import type { WorkspaceTopicAnalysis } from '../../shared/contracts/workspace-onboarding-contract'
import { StudyLessonView, studyLessonBlockExcerpt } from './StudyLessonView'
import { ExercisesWorkspace, type ActiveExerciseContext } from './ExercisesWorkspace'
import { LearningPathDrawer } from './LearningPathDrawer'
import { studiesPreparationMessage } from './studies-preparation'
import { planActionLabel } from '../../application/study-workspaces/daily-plan'
import { deriveNextStepCta } from '../../application/study-workspaces/next-step-cta'
import { exactTopic, navigateNextStep } from './next-step-navigation'
import type { AcademicLifeProjection } from '../../shared/contracts/academic-life-contract'
import { ReviewWorkspace } from './ReviewWorkspace'
import { MATERIAL_FALLBACK, publicCreationError, WorkspaceCreationOperations } from './workspace-creation-operations'
import { appendOptimisticMessage, isNearChatBottom, optimisticMessage, reconcileConversationMessages, scrollChatToLatest, WorkspaceChatController } from './chat-experience'
import { useDialogFocus } from './dialog-focus'
import { plannerRequestIdentity } from './planner-request-retry'

export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])') || Boolean(target.closest('[contenteditable]:not([contenteditable="false"])')))
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
  const [analysis, setAnalysis] = useState<WorkspaceTopicAnalysis | null>(null)
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null)
  const [duplicateDifference, setDuplicateDifference] = useState('')
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false)
  const [draftWorkspaceId, setDraftWorkspaceId] = useState<string | null>(null)
  const [draftMaterials, setDraftMaterials] = useState<MaterialSummary[]>([])
  const [materialBusy, setMaterialBusy] = useState(false)
  const [closing, setClosing] = useState(false)
  const creationOperations = useRef(new WorkspaceCreationOperations())
  const draftWorkspaceIdRef = useRef<string | null>(null)
  const analysisEpoch = useRef(0)
  const resetSubjectState = () => { analysisEpoch.current += 1; setObjective(''); setDiagnosticAnswer(''); setAnalysis(null); setDuplicate(null); setDuplicateDifference(''); setDuplicateConfirmed(false); setAnalyzed(false); setQuestion(null); setAnalysisError(null); const id = draftWorkspaceIdRef.current; if (id) { setMaterialBusy(true); void creationOperations.current.invalidate(async () => { await window.coach.workspace.discardDraft(id); if (draftWorkspaceIdRef.current === id) { draftWorkspaceIdRef.current = null; setDraftWorkspaceId(null); setDraftMaterials([]) } }).catch(() => setAnalysisError('Não foi possível limpar o rascunho anterior.')).finally(() => setMaterialBusy(false)) } }

  useEffect(() => { if (!open) return; creationOperations.current.reopen(); draftWorkspaceIdRef.current = null; setName(initial?.name ?? ''); setObjective(''); setDiagnosticAnswer(''); setAnalysis(null); setDuplicate(null); setDuplicateDifference(''); setDuplicateConfirmed(false); setDraftWorkspaceId(null); setDraftMaterials([]); setAnalyzed(false); setQuestion(null); setAnalysisError(null) }, [open, initial])

  async function analyze(confirmInterpretation = false) {
    if (name.trim().length < 1 || analyzing) return
    const epoch = ++analysisEpoch.current
    setAnalyzing(true); setAnalysisError(null)
    try { const result = await window.coach.workspaceOnboarding.analyze({ topic: name, diagnosticAnswer: diagnosticAnswer.trim() || undefined, confirmation: confirmInterpretation && analysis ? { analysisToken: analysis.analysisToken, revision: analysis.revision, canonicalSubject: analysis.canonicalSubject, canonicalFocus: analysis.canonicalFocus } : undefined }); if (analysisEpoch.current !== epoch) return; setName(result.topic); setAnalysis(result); setObjective(result.objective); setQuestion(result.question); setAnalyzed(result.status === 'VALID' || result.status === 'NEEDS_CLARIFICATION') }
    catch { setAnalysisError('Não consegui avaliar o tema agora. Tente novamente.') }
    finally { setAnalyzing(false) }
  }
  const creationInput = (): CreateWorkspaceInput => ({ name, objective, analysisToken: analysis?.analysisToken, analysisRevision: analysis?.revision, canonicalFocus: analysis?.canonicalFocus, canonicalContext: analysis?.canonicalContext, localKnowledgeProjection: analysis?.localKnowledgeProjection, curricularScope: analysis?.curricularScope, declaredLevel: analysis?.declaredLevel ?? undefined, declaredKnowledge: analysis ? [...analysis.declaredKnowledge] : [], declaredDifficulties: analysis ? [...analysis.declaredDifficulties] : [], goals: analysis ? [...analysis.goals] : [], duplicateOverride: duplicateConfirmed && duplicateDifference.trim().length >= 8 ? { confirmed: true, meaningfulDifference: duplicateDifference.trim() } : undefined, relatedSubjects: analysis?.relatedContexts.map(({ subject, relation }) => ({ subject, relation })) ?? [] })
  async function addMaterial() { if (materialBusy || closing) return; setMaterialBusy(true); setAnalysisError(null); try { await creationOperations.current.run(async (generation) => { let id = draftWorkspaceIdRef.current; if (!id) { const draft = await window.coach.workspace.prepareDraft(creationInput()); if (!creationOperations.current.isCurrent(generation)) { await window.coach.workspace.discardDraft(draft.id); return } id = draft.id; draftWorkspaceIdRef.current = id; setDraftWorkspaceId(id) } await window.coach.material.importFile(id); const materials = await window.coach.material.list(id); if (creationOperations.current.isCurrent(generation) && draftWorkspaceIdRef.current === id) setDraftMaterials(materials) }) } catch (error) { setAnalysisError(publicCreationError(error, MATERIAL_FALLBACK)) } finally { setMaterialBusy(false) } }
  async function decideDraftMaterial(materialId: string, decision: 'approve' | 'discard', role: 'base' | 'priority' | 'reference' = 'reference') { if (!draftWorkspaceId || materialBusy || closing) return; setMaterialBusy(true); try { await creationOperations.current.run(async (generation) => { const id = draftWorkspaceId; await window.coach.material.decide({ workspaceId: id, materialId, decision, role }); const materials = await window.coach.material.list(id); if (creationOperations.current.isCurrent(generation)) setDraftMaterials(materials) }) } catch (error) { setAnalysisError(publicCreationError(error, MATERIAL_FALLBACK)) } finally { setMaterialBusy(false) } }
  async function closeCreation() { if (closing) return; setClosing(true); try { await creationOperations.current.close(async () => { const id = draftWorkspaceIdRef.current; if (id) await window.coach.workspace.discardDraft(id) }); draftWorkspaceIdRef.current = null; setDraftWorkspaceId(null); setDraftMaterials([]); onClose() } catch { setAnalysisError('Não foi possível limpar o rascunho. Tente novamente.') } finally { setClosing(false) } }

  const dialogRef = useDialogFocus<HTMLDivElement>(open, () => { void closeCreation() }, 'input[name="workspace-topic"]')
  if (!open) return null

  return (
    <div ref={dialogRef} className="fixed inset-0 z-20 overflow-y-auto bg-[#0d0e12] p-5" role="dialog" aria-modal="true" aria-labelledby="create-workspace-title">
      <form
        className="mx-auto min-h-full w-full max-w-5xl rounded-[2rem] border border-coach-line bg-[#111217] p-7 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault()
           if (!analyzed) { void analyze(); return }
             void creationOperations.current.submit(async () => onSubmit({ ...creationInput(), draftId: draftWorkspaceIdRef.current ?? undefined })).catch((error: unknown) => { const message = publicCreationError(error); const marker = message.match(/WORKSPACE_DUPLICATE\|([^|]+)\|(.+)$/); if (marker) { setDuplicate({ id: marker[1]!, name: marker[2]! }); setAnalysisError(null) } else setAnalysisError(message) })
        }}
      >
        <div className="flex items-start justify-between">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Preparação contextual</p><h2 id="create-workspace-title" className="mt-2 font-display text-3xl font-black">Criar Workspace</h2></div>
          <button type="button" aria-label="Fechar" disabled={submitting || closing || materialBusy} onClick={() => { void closeCreation() }} className="rounded-full p-2 hover:bg-black/5 disabled:opacity-50"><X /></button>
        </div>
          <label className="mt-7 block text-sm font-bold">Tema principal
            <input name="workspace-topic" required minLength={1} maxLength={80} value={name} onChange={(event) => { setName(event.target.value); resetSubjectState() }} placeholder="Ex.: Estrutura de Dados" className="mt-2 w-full rounded-xl border border-coach-line bg-[#111217] px-4 py-3 outline-none focus:border-coach-green" />
            <span className="mt-1 block text-xs font-normal text-coach-muted">Use uma disciplina ou habilidade específica. O Coach analisará o foco antes de criar a Trilha.</span>
          </label>
          {analysis && <section className={`mt-5 rounded-2xl border p-5 ${analysis.status === 'INVALID' || analysis.status === 'REQUIRED_DESCRIPTION' ? 'border-red-500/50 bg-red-500/10' : analysis.status === 'NEEDS_CONFIRMATION' ? 'border-coach-orange/60 bg-coach-orange/10' : 'border-coach-green/40 bg-coach-green/[.06]'}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.16em] text-coach-muted">Interpretação do Coach</p><h3 className="mt-1 font-display text-xl font-black">{analysis.canonicalSubject || 'Tema não reconhecido'}</h3></div><span className="rounded-full border border-current px-3 py-1 text-[10px] font-black tracking-wide">{analysis.status}</span></div><p className="mt-3 text-sm leading-6 text-coach-muted">{analysis.explanation}</p><p className="mt-2 text-[11px] text-coach-muted">Análise de IA: {{ valid: 'validada', unavailable: 'indisponível; regra segura aplicada', invalid: 'resposta inválida; regra segura aplicada', uncertain: 'incerta; confirmação local exigida', not_used: 'não necessária' }[analysis.providerAnalysisState]}</p>{analysis.canonicalFocus && analysis.canonicalFocus !== analysis.canonicalSubject && <p className="mt-2 text-xs"><strong>Foco:</strong> {analysis.canonicalFocus}</p>}{analysis.relatedContexts.length > 0 && <div className="mt-4 border-t border-coach-line pt-3"><p className="text-xs font-black uppercase tracking-wide">Relações automáticas</p>{analysis.relatedContexts.map((item) => <p key={`${item.relation}:${item.subject}`} className="mt-2 text-xs text-coach-muted"><strong className="text-coach-ink">{item.subject}</strong> — {item.explanation} Isso adiciona contexto, não evidência de domínio.</p>)}</div>}</section>}
          <section className="mt-6 rounded-2xl border border-dashed border-coach-line p-5"><div className="flex items-center justify-between gap-4"><div><h3 className="font-display text-xl font-black">Materiais para personalização</h3><p className="mt-2 text-sm text-coach-muted">Opcional. Anexe PDF ou PPTX; nada entra na Trilha até você aprovar o papel de cada arquivo.</p></div><button type="button" disabled={!analyzed || submitting} onClick={() => void addMaterial().catch(() => setAnalysisError('Não foi possível anexar o material.'))} className="rounded-xl border border-coach-line px-4 py-2 text-sm font-bold disabled:opacity-50">Adicionar PDF/PPTX</button></div>{draftMaterials.map((material) => <article key={material.id} className="mt-3 rounded-lg border border-coach-line p-3 text-xs"><strong>{material.name}</strong><p className="mt-1 text-coach-muted">{material.semanticAnalysis?.summary ?? material.errorMessage ?? `Extração concluída: ${material.pageCount} páginas/slides.`}</p>{material.status === 'staged' && <div className="mt-3 flex flex-wrap gap-2"><select id={`role-${material.id}`} defaultValue="reference" className="rounded-lg border border-coach-line bg-[#111217] px-2 py-1"><option value="base">Base curricular</option><option value="priority">Prioridade</option><option value="reference">Referência</option></select><button type="button" onClick={() => { const role = (document.getElementById(`role-${material.id}`) as HTMLSelectElement).value as 'base' | 'priority' | 'reference'; void decideDraftMaterial(material.id, 'approve', role) }} className="rounded-lg bg-coach-green px-3 py-1 font-bold text-white">Aprovar papel</button><button type="button" onClick={() => void decideDraftMaterial(material.id, 'discard')} className="rounded-lg border border-coach-line px-3 py-1">Descartar</button></div>}<span className="mt-2 block text-coach-muted">Estado: {material.status}</span></article>)}</section>
          {question && <label className="mt-5 block rounded-xl border border-[#39334f] bg-[#181622] p-4 text-sm font-bold"><span className="text-[#aa9cff]">{analysis?.status === 'REQUIRED_DESCRIPTION' ? 'Descrição obrigatória' : 'Pergunta contextual opcional'}</span><span className="mt-2 block font-normal leading-6 text-[#c8cad0]">{question}</span><textarea maxLength={1000} value={diagnosticAnswer} onChange={(event) => { setDiagnosticAnswer(event.target.value); if (analysis?.status === 'REQUIRED_DESCRIPTION') setAnalyzed(false); else setAnalyzed(event.target.value.trim().length === 0) }} placeholder={analysis?.status === 'REQUIRED_DESCRIPTION' ? 'Ex.: ED significa Estrutura de Dados' : 'Você pode responder ou criar o Workspace sem responder.'} className="mt-3 min-h-24 w-full resize-none rounded-lg border border-[#39334f] bg-[#111217] px-4 py-3 outline-none" />{diagnosticAnswer.trim() && <button type="button" disabled={analyzing} onClick={() => void analyze()} className="mt-3 rounded-lg border border-[#aa9cff] px-3 py-2 text-xs font-bold text-[#aa9cff]">Analisar novamente</button>}</label>}
         {analysisError && <p className="mt-4 text-xs text-red-400">{analysisError}</p>}
           {duplicate && <section className="mt-5 rounded-xl border border-coach-orange/50 bg-coach-orange/10 p-4"><strong>Já existe um Workspace equivalente: {duplicate.name}</strong><p className="mt-2 text-xs text-coach-muted">Cancele esta criação e abra “{duplicate.name}”, ou descreva uma diferença acadêmica real.</p><label className="mt-3 block text-xs font-bold">O que torna este Workspace diferente?<textarea value={duplicateDifference} onChange={(event) => { setDuplicateDifference(event.target.value); setDuplicateConfirmed(false) }} placeholder="Ex.: foco na implementação em C para a prova prática" className="mt-2 min-h-20 w-full rounded-lg border border-coach-line bg-[#111217] p-3" /></label><label className="mt-3 flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" disabled={duplicateDifference.trim().length < 8} checked={duplicateConfirmed} onChange={(event) => setDuplicateConfirmed(event.target.checked)} /><span><strong className="block">Criar outro Workspace mesmo assim</strong><span className="mt-1 block font-normal text-coach-muted">Ao marcar, o Coach manterá dois planos separados para temas semelhantes usando a diferença descrita.</span></span></label></section>}
         <div className="mt-7 flex justify-end gap-3 border-t border-coach-line pt-5">
           <button type="button" disabled={submitting || closing || materialBusy} onClick={() => { void closeCreation() }} className="rounded-xl border border-coach-line px-5 py-3 font-bold disabled:opacity-50">{closing ? 'Limpando...' : 'Cancelar'}</button>
            {!analysis && <button type="button" disabled={submitting || analyzing || name.trim().length < 1} onClick={() => void analyze()} className="rounded-xl border border-coach-green px-5 py-3 font-extrabold text-coach-green disabled:opacity-50">{analyzing ? 'Coach analisando…' : 'Analisar tema'}</button>}{analysis?.status === 'NEEDS_CONFIRMATION' && <button type="button" disabled={analyzing} onClick={() => void analyze(true)} className="rounded-xl border border-coach-green px-5 py-3 font-extrabold text-coach-green disabled:opacity-50">Confirmar interpretação</button>}<button type="submit" disabled={!analyzed || submitting || analyzing || materialBusy || closing || !analysis?.analysisToken || draftMaterials.some((item) => item.status === 'staged') || (duplicate !== null && !duplicateConfirmed)} className="rounded-xl bg-coach-orange px-5 py-3 font-extrabold text-white disabled:opacity-50">{submitting ? 'Criando…' : 'Criar Workspace'}</button>
        </div>
      </form>
    </div>
  )
}

type AIAvailabilityProblem =
  | ProviderRuntimeIssue
  | 'no-ai'

type ProviderLastActivity = {
  readonly outcome:
    | 'success'
    | 'failure'

  readonly at: number
  readonly code: string | null
  readonly detail: string
  readonly model: string
}


const PROVIDER_LAST_ACTIVITY_STORAGE_KEY =
  'coach.provider-last-activity.v1'


function providerActivityDetailFromStreamCode(
  code: string,
): string {
  switch (code) {
    case 'INSUFFICIENT_QUOTA':
      return 'O provedor informou que o limite de uso ou a cota disponível foi atingido.'

    case 'MODEL_UNAVAILABLE':
      return 'O serviço continua configurado, mas o modelo usado nesta tentativa não estava disponível.'

    case 'INVALID_CREDENTIAL':
      return 'A credencial desta IA foi recusada pelo serviço.'

    case 'ACCESS_RESTRICTED':
      return 'O serviço recusou o acesso desta conta, modelo ou região.'

    case 'RATE_LIMITED':
      return 'O serviço recebeu a solicitação, mas aplicou um limite temporário de requisições.'

    case 'NETWORK_UNAVAILABLE':
      return 'A solicitação não conseguiu manter comunicação com o serviço de IA.'

    case 'REQUEST_TIMEOUT':
      return 'A IA demorou mais do que o limite permitido para concluir esta solicitação.'

    case 'PROVIDER_UNAVAILABLE':
      return 'O Coach não conseguiu concluir uma resposta funcional nesta tentativa. A conexão com o serviço pode continuar ativa.'

    case 'REQUEST_FAILED':
      return 'A solicitação chegou ao fluxo da IA, mas não foi concluída com uma resposta utilizável.'

    default:
      return 'A última solicitação não pôde ser concluída.'
  }
}


function readProviderLastActivities():
  Record<string, ProviderLastActivity> {
  try {
    const raw =
      window.localStorage.getItem(
        PROVIDER_LAST_ACTIVITY_STORAGE_KEY,
      )

    if (!raw) {
      return {}
    }

    const parsed: unknown =
      JSON.parse(raw)

    if (
      !parsed
      || typeof parsed !== 'object'
      || Array.isArray(parsed)
    ) {
      return {}
    }

    const result:
      Record<string, ProviderLastActivity> = {}

    for (
      const [accountId, value]
      of Object.entries(parsed)
    ) {
      if (
        !value
        || typeof value !== 'object'
        || Array.isArray(value)
      ) {
        continue
      }

      const candidate =
        value as Partial<ProviderLastActivity>

      if (
        (
          candidate.outcome !== 'success'
          && candidate.outcome !== 'failure'
        )
        || typeof candidate.at !== 'number'
        || !Number.isFinite(candidate.at)
        || (
          candidate.code !== null
          && candidate.code !== undefined
          && typeof candidate.code !== 'string'
        )
        || typeof candidate.detail !== 'string'
        || typeof candidate.model !== 'string'
      ) {
        continue
      }

      result[accountId] = {
        outcome:
          candidate.outcome,

        at:
          candidate.at,

        code:
          candidate.code ?? null,

        detail:
          candidate.detail,

        model:
          candidate.model,
      }
    }

    return result
  } catch {
    return {}
  }
}


function saveProviderLastActivities(
  activities:
    Record<string, ProviderLastActivity>,
): void {
  try {
    window.localStorage.setItem(
      PROVIDER_LAST_ACTIVITY_STORAGE_KEY,
      JSON.stringify(activities),
    )
  } catch {
    /*
     * Diagnóstico não contém credenciais.
     * Falha de persistência não pode impedir
     * o uso normal do Coach.
     */
  }
}


function providerRuntimeIssueFromStreamCode(
  code: string,
): ProviderRuntimeIssue | null {
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
    case 'PROVIDER_UNAVAILABLE':
      return 'temporarily-unavailable'

    /*
     * REQUEST_FAILED significa que uma execução
     * específica não produziu resposta utilizável.
     *
     * A conexão do provider continua válida.
     */
    case 'REQUEST_FAILED':
      return null

    default:
      return null
  }
}


function aiProblemCopy(
  problem: AIAvailabilityProblem,
) {
  switch (problem) {
    case 'no-ai':
      return {
        title: 'Nenhuma IA disponível',
        message:
          'Nenhuma IA está selecionada para responder.',
      }

    case 'usage-limit':
      return {
        title: 'Esta IA não pode responder agora',
        message:
          'O limite de uso desta IA foi atingido. Escolha outro modelo ou outra IA.',
      }

    case 'model-unavailable':
      return {
        title: 'Modelo indisponível',
        message:
          'O modelo selecionado não está disponível. Escolha outro modelo.',
      }

    case 'access-restricted':
      return {
        title: 'Acesso restrito',
        message:
          'O plano, a organização, a política ou a região não permite usar esta IA.',
      }

    case 'temporarily-unavailable':
      return {
        title: 'IA temporariamente indisponível',
        message:
          'Esta IA não conseguiu responder neste momento. Tente novamente em alguns instantes.',
      }

    case 'reauth-required':
      return {
        title: 'Reconecte esta conta',
        message:
          'Esta conta precisa ser reconectada antes de continuar.',
      }

    case 'available':
      return {
        title: 'IA disponível',
        message:
          'Esta IA está respondendo normalmente.',
      }
  }
}


function AIProblemDialog({
  problem,
  detail,
  onManage,
  onClose,
}: {
  problem: AIAvailabilityProblem
  detail?: string | null
  onManage(): void
  onClose(): void
}) {
  const copy =
    aiProblemCopy(problem)
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose, 'button')

  return (
    <div
      className="fixed inset-0 z-[150] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-problem-title"
    >
      <section ref={dialogRef} className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-[#39313b] bg-[#121318] p-6 shadow-2xl">
        <div className="mx-auto grid size-11 place-items-center rounded-full bg-[#3a2024] font-bold text-[#ef8d93]">
          !
        </div>

        <h2
          id="ai-problem-title"
          className="mt-4 text-center text-xl font-semibold text-white"
        >
          {copy.title}
        </h2>

        <p className="mt-3 text-center text-sm leading-6 text-[#9297a3]">
          {copy.message}
        </p>

        {detail && (
          <div className="mt-4 rounded-xl border border-[#3f3525] bg-[#1b1812] px-4 py-3 text-left">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#e8b96d]">
              Última tentativa
            </span>

            <p className="mt-1 text-xs leading-5 text-[#b7bbc5]">
              {detail}
            </p>
          </div>
        )}

        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={onManage}
            className="rounded-xl bg-[#8c7cff] px-4 py-2.5 text-xs font-bold text-[#0c0d10]"
          >
            Ir para Suas IAs
          </button>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[#343743] px-4 py-2.5 text-xs font-semibold text-white"
          >
            OK
          </button>
        </div>
      </section>
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
  const plannerRetry = useRef<{ content: string; requestId: string } | null>(null)
  const homeRequestEpoch = useRef(0)
  const [plannerLoading, setPlannerLoading] = useState(true)
  const [plannerError, setPlannerError] = useState<string | null>(null)
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
  const [providerAccounts, setProviderAccounts] = useState<ProviderAccountSummary[]>([])
  const [providerAccountsState, setProviderAccountsState] = useState<'loading' | 'loaded' | 'error'>('loading')

  const [
    providerRuntimeIssues,
    setProviderRuntimeIssues,
  ] = useState<
    Record<string, ProviderRuntimeIssue>
  >({})

  const [
    providerHealthSnapshots,
    setProviderHealthSnapshots,
  ] = useState<
    Record<
      string,
      ProviderAccountHealthSnapshot
    >
  >({})

  const providerHealthRefreshing =
    useRef(false)

  const refreshProviderHealth =
    useCallback(
      async (): Promise<void> => {
        if (
          providerHealthRefreshing.current
        ) {
          return
        }

        providerHealthRefreshing.current =
          true

        try {
          const snapshots =
            await window.coach.provider
              .refreshHealth()

          const next =
            Object.fromEntries(
              snapshots.map(
                (snapshot) => [
                  snapshot.accountId,
                  snapshot,
                ],
              ),
            ) as Record<
              string,
              ProviderAccountHealthSnapshot
            >

          setProviderHealthSnapshots(
            next,
          )

          /*
           * Falhas de conectividade/autenticação/modelo
           * detectadas pelo health devem aparecer sem
           * exigir uma tentativa de geração.
           *
           * usage-limit é mantido até uma geração real
           * provar que a cota voltou.
           */
          setProviderRuntimeIssues(
            (current) => {
              const updated = {
                ...current,
              }

              let changed = false

              for (
                const snapshot
                of snapshots
              ) {
                if (
                  snapshot.runtimeIssue
                ) {
                  if (
                    updated[
                      snapshot.accountId
                    ]
                    !== snapshot.runtimeIssue
                  ) {
                    updated[
                      snapshot.accountId
                    ] =
                      snapshot.runtimeIssue

                    changed = true
                  }

                  continue
                }

                /*
                 * Snapshot de catálogo não apaga falha
                 * funcional. Somente heartbeat ou uso real
                 * bem-sucedido pode voltar para available.
                 */
              }

              return changed
                ? updated
                : current
            },
          )

          /*
           * ProviderStatus representa a IA ativa.
           * Atualizamos apenas a conectividade usando
           * o snapshot correspondente.
           */
          setProviderStatus(
            (current) => {
              if (
                !current
                || !current.activeAccountId
              ) {
                return current
              }

              const activeHealth =
                next[
                  current.activeAccountId
                ]

              if (!activeHealth) {
                return current
              }

              return {
                ...current,

                connected:
                  activeHealth
                    .connectionState
                  === 'connected',

                connectionState:
                  activeHealth
                    .connectionState,
              }
            },
          )
        } finally {
          providerHealthRefreshing.current =
            false
        }
      },
      [],
    )

  const [
    providerConnectingAccountId,
    setProviderConnectingAccountId,
  ] = useState<string | null>(null)


  /*
   * Guarda a configuração ativa que já recebeu
   * a verificação funcional automática desta sessão.
   *
   * Não é um heartbeat: cada configuração é verificada
   * apenas quando precisa ser conhecida.
   */
  const providerStartupFunctionalCheckKey =
    useRef<string | null>(null)



  const [
    providerLastActivities,
    setProviderLastActivities,
  ] = useState<
    Record<string, ProviderLastActivity>
  >(
    () =>
      readProviderLastActivities(),
  )


  const [
    aiProblem,
    setAIProblem,
  ] = useState<
    AIAvailabilityProblem | null
  >(null)

  const [
    aiManageRequest,
    setAIManageRequest,
  ] = useState(0)
  const [workspaceMessages, setWorkspaceMessages] = useState<ConversationMessage[]>([])
  const [workspaceInput, setWorkspaceInput] = useState('')
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceSending, setWorkspaceSending] = useState(false)
  const [workspaceSendStage, setWorkspaceSendStage] = useState<'sending' | 'context' | 'generating' | 'executing' | null>(null)
  const [workspaceContextSummary, setWorkspaceContextSummary] = useState<string | null>(null)
  const [workspaceStreamedContent, setWorkspaceStreamedContent] = useState('')
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const workspaceStreamHandle = useRef<{ cancel(): void; dispose(): void } | null>(null)
  const workspaceLoadEpoch = useRef(0)
  const workspaceOpenEpoch = useRef(0)
  const workspaceChat = useRef(new WorkspaceChatController())
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
  const [timerNow, setTimerNow] = useState(() => performance.now())
  const timerAnchor = useRef({ startedAt: null as number | null, remainingSeconds: 0, monotonicMs: performance.now() })
  const [planUpdating, setPlanUpdating] = useState(false)
  const [timerExpired, setTimerExpired] = useState(false)
  const timerExpiredDialogRef = useDialogFocus<HTMLDivElement>(timerExpired, () => setTimerExpired(false))
  const [execution, setExecution] = useState<CodeExecutionResult | null>(null)
  const [practiceContext, setPracticeContext] = useState<{ fileName: string; language: string; code: string; execution: CodeExecutionResult | null } | null>(null)
  const [interactiveCodeContext, setInteractiveCodeContext] = useState<{ block: InteractiveCodeBlock; state: InteractiveCodeState } | null>(null)
  const [activeExerciseContext, setActiveExerciseContext] = useState<ActiveExerciseContext | null>(null)
  const [exerciseRoadmap, setExerciseRoadmap] = useState<Roadmap | null>(null)
  const [exerciseTopicId, setExerciseTopicId] = useState<string | null>(null)
  const [exerciseSetId, setExerciseSetId] = useState<string | null>(null)
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
  const [schedule, setSchedule] = useState<StudyScheduleItem[]>([])
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlan | null>(null)
  const [academicOverview, setAcademicOverview] = useState<AcademicOverview | null>(null)
  const [academicLife, setAcademicLife] = useState<AcademicLifeProjection | null>(null)
  const [workspaceHistory, setWorkspaceHistory] = useState<WorkspaceSummary[]>([])
  const [historyDetail, setHistoryDetail] = useState<WorkspaceHistoryDetail | null>(null)
  const [materialsOpen, setMaterialsOpen] = useState(false)
  const [materials, setMaterials] = useState<MaterialSummary[]>([])
  const [materialQuery, setMaterialQuery] = useState('')
  const [materialResults, setMaterialResults] = useState<MaterialSearchResult[]>([])
  const [roadmapRebuild, setRoadmapRebuild] = useState<RoadmapRebuildPreview | null>(null)
  const [roadmapRebuildBusy, setRoadmapRebuildBusy] = useState(false)
  const [activeMaterial, setActiveMaterial] = useState<{ materialId: string; name: string; pageOrSlide: number | null; selectedText: string | null } | null>(null)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [outline, setOutline] = useState<SessionOutlineItem[]>([])
  const [savedForLater, setSavedForLater] = useState<SavedForLaterItem[]>([])
  const [laterInput, setLaterInput] = useState('')
  const [plannerActions, setPlannerActions] = useState<PlannerAction[]>([])
  const [workspacePlannerActions, setWorkspacePlannerActions] = useState<PlannerAction[]>([])
  const studyStateRef = useRef<StudyWorkspaceState | null>(null)
  const editorContentRef = useRef('')
  const lastInterventionSignature = useRef<string | null>(null)
  const studyNotesRef = useRef('')
  const documentRevision = useRef(0)
  const notesRevision = useRef(0)

  const refreshDependentProjections = useCallback(async () => {
    const snapshot = await refreshAcademicProjections({ replanWeek: async () => { await window.coach.planning.replanWeek(); return window.coach.planning.getWeeklyPlan() }, listWorkspaces: () => window.coach.workspace.list(), listPriorities: () => window.coach.planning.listPriorities(), getSchedule: () => window.coach.planning.getSchedule(), getAcademicOverview: () => window.coach.planning.getAcademicOverview(), getAcademicLife: () => window.coach.academicLife.getProjection(), getReports: () => window.coach.report.getGlobalOverview() })
    setWorkspaces(snapshot.workspaces); setPriorities(snapshot.priorities); setSchedule(snapshot.schedule); setWeeklyPlan(snapshot.weeklyPlan); setAcademicOverview(snapshot.academicOverview); setAcademicLife(snapshot.academicLife); setGlobalReport(snapshot.reports)
    return snapshot
  }, [])

  const loadWorkspaces = useCallback(async () => {
    try {
      const [active, history] = await Promise.all([window.coach.workspace.list(), window.coach.workspace.listHistory()])
      setWorkspaces(active)
      setWorkspaceHistory(history)
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
    const epoch = ++homeRequestEpoch.current
    void window.coach.conversation.listHomeMessages().then((loaded) => { if (homeRequestEpoch.current === epoch) setMessages((current) => reconcileConversationMessages(current, loaded)) }).catch(() => setPlannerError('Não foi possível carregar a conversa do Planner.')).finally(() => { if (homeRequestEpoch.current === epoch) setPlannerLoading(false) })
    void window.coach.planning.listPriorities().then(setPriorities)
    void window.coach.planning.getAcademicOverview().then(setAcademicOverview)
    void window.coach.planning.getWeeklyPlan().then(setWeeklyPlan).catch(() => setPlannerError('Não foi possível carregar o plano semanal.'))
    void window.coach.academicLife.getProjection().then(setAcademicLife)
    void window.coach.provider.getStatus().then(setProviderStatus).catch(() => setPlannerError('Não foi possível consultar a configuração de IA.'))
    void window.coach.provider.listAccounts().then((accounts) => { setProviderAccounts(accounts); setProviderAccountsState('loaded') }).catch(() => { setProviderAccountsState('error'); setPlannerError('Não foi possível listar as contas de IA.') })
    void window.coach.plannerAction.listPending().then(setPlannerActions)
    void window.coach.report.getGlobalOverview().then(setGlobalReport).catch(() => setPlannerError('Não foi possível carregar o panorama geral.'))
  }, [loadWorkspaces])

  useEffect(() => {
    const shouldMonitorProvider =
      homeSection === 'home'
      || homeSection === 'ai'
      || Boolean(selected)

    if (!shouldMonitorProvider) {
      return
    }

    let disposed = false
    let checking = false

    const probeActiveProvider =
      async () => {
        if (
          checking
          || document.hidden
        ) {
          return
        }

        checking = true

        try {
          /*
           * getStatus() verifica somente a IA ativa.
           *
           * Para OmniRoute, checkAvailability() usa
           * /v1/models/<modelo> e não gera conteúdo.
           */
          const status =
            await window.coach.provider
              .getStatus()

          if (disposed) {
            return
          }

          setProviderStatus(status)

          /*
           * getStatus() é a verificação barata:
           * não pede uma resposta ao modelo.
           *
           * Quando termina, saímos de "Conectando...".
           * Isso significa apenas "Conectado".
           * "Funcionando" exige uma utilização real.
           */
          /*
           * O probe barato atualiza somente conectividade.
           *
           * Se existe uma troca explícita em andamento,
           * "Conectando..." será encerrado pela verificação
           * funcional one-shot daquela troca.
           */
          /*
           * IMPORTANTE:
           *
           * Um probe HTTP bem-sucedido prova somente
           * conectividade/autenticação e, no OmniRoute,
           * presença do modelo no catálogo.
           *
           * Ele NÃO pode apagar um runtimeIssue gerado
           * por uma tentativa real do Coach.
           *
           * A falha funcional só volta para verde depois
           * que uma chamada real completar com sucesso.
           */
        } catch {
          if (disposed) {
            return
          }

          /*
           * Falha no probe da IA ativa:
           * Home e Workspace mudam imediatamente
           * para o estado indisponível.
           */
          setProviderStatus(
            (current) =>
              current
                ? {
                    ...current,
                    connected: false,
                    connectionState:
                      'unreachable',
                  }
                : current,
          )
        } finally {
          checking = false
        }
      }

    void probeActiveProvider()

    const timer =
      window.setInterval(
        () => {
          void probeActiveProvider()
        },
        5_000,
      )

    const handleVisibilityChange =
      () => {
        if (!document.hidden) {
          void probeActiveProvider()
        }
      }

    document.addEventListener(
      'visibilitychange',
      handleVisibilityChange,
    )

    return () => {
      disposed = true

      window.clearInterval(timer)

      document.removeEventListener(
        'visibilitychange',
        handleVisibilityChange,
      )
    }
  }, [
    homeSection,
    selected?.id,
    providerStatus?.activeAccountId,
    providerStatus?.model,
  ])


  useEffect(() => { if (!workspaces.some((workspace) => workspace.provisioning && workspace.provisioning.status !== 'ready')) return; const timer = window.setInterval(() => void loadWorkspaces(), 1500); return () => window.clearInterval(timer) }, [workspaces, loadWorkspaces])

  const stopWorkspaceStream = useCallback(() => {
    const stream = workspaceStreamHandle.current
    const snapshot = workspaceChat.current.activate(null, () => { stream?.cancel(); stream?.dispose() })
    workspaceStreamHandle.current = null
    setWorkspaceStreamedContent(snapshot.partial)
    setWorkspaceSending(false)
  }, [])

  useEffect(() => () => {
    streamHandle.current?.cancel()
    streamHandle.current?.dispose()
    stopWorkspaceStream()
  }, [stopWorkspaceStream])

  useEffect(() => {
    const epoch = ++workspaceLoadEpoch.current
    const stream = workspaceStreamHandle.current
    const snapshot = workspaceChat.current.activate(selected?.id ?? null, () => { stream?.cancel(); stream?.dispose() })
    workspaceStreamHandle.current = null
    setWorkspaceSending(false)
    setPlanUpdating(false)
    setSessionCompleting(false)
    setTimerUpdating(false)
    setWorkspaceInput(selected ? workspaceDrafts.current.get(selected.id) ?? '' : '')
    workspaceFollowLatest.current = true
    setWorkspaceMessages(snapshot.messages)
    setWorkspaceStreamedContent(snapshot.partial)
    setActiveMaterial(null)
    setRoadmapRebuild(null)
    setWorkspaceError(null)
    setExecution(null)
    setPracticeContext(null)
    setInteractiveCodeContext(null)
    setActiveExerciseContext(null)
    setExerciseRoadmap(null)
    setExerciseTopicId(null)
    setExerciseSetId(null)
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
    if (selected.status !== 'active') {
      setWorkspaceLoading(true)
      void window.coach.workspace.getHistoryDetail(selected.id).then((detail) => { if (workspaceLoadEpoch.current === epoch) setHistoryDetail(detail) }).catch(() => { if (workspaceLoadEpoch.current === epoch) setWorkspaceError('Não foi possível carregar o histórico deste Workspace.') }).finally(() => { if (workspaceLoadEpoch.current === epoch) setWorkspaceLoading(false) })
      return () => { workspaceLoadEpoch.current += 1 }
    }
    setHistoryDetail(null)
    setWorkspaceLoading(true)
    void Promise.all([window.coach.conversation.listWorkspaceMessages(selected.id), window.coach.studyWorkspace.refreshLivePlan({ workspaceId: selected.id }), window.coach.observer.getState(selected.id)])
      .then(([loaded, state, observer]) => { if (workspaceLoadEpoch.current === epoch) { setWorkspaceMessages((current) => workspaceChat.current.reconcileLoad(selected.id, snapshot.generation, current, loaded) ?? current); setStudyState(state); setObserverState(observer); setEditorContent(state.editorContent); setStudyNotes(state.notes); documentRevision.current = state.documentRevision; notesRevision.current = state.notesRevision } })
      .catch(() => { if (workspaceLoadEpoch.current === epoch) setWorkspaceError('Não foi possível carregar a conversa deste Workspace.') })
      .finally(() => { if (workspaceLoadEpoch.current === epoch) setWorkspaceLoading(false) })
    void window.coach.roadmap.getRebuildPreview({ workspaceId: selected.id }).then((preview) => { if (workspaceLoadEpoch.current === epoch) setRoadmapRebuild(preview) }).catch(() => {})
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
        const progress = saved?.roadmapId === roadmap.id && saved.topicId === topicId && saved.lessonId === lessonLoad.lesson.id ? saved : await window.coach.studyProgress.select({ workspaceId, roadmapId: roadmap.id, moduleId: module.id, topicId, lessonId: lessonLoad.lesson.id, checkpointId: null })
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
    if (timerAnchor.current.startedAt !== studyState.timerStartedAt) timerAnchor.current = { startedAt: studyState.timerStartedAt, remainingSeconds: studyState.timerRemainingSeconds, monotonicMs: performance.now() }
    const interval = window.setInterval(() => setTimerNow(performance.now()), 1000)
    return () => window.clearInterval(interval)
  }, [studyState?.timerRemainingSeconds, studyState?.timerStartedAt, studyState?.timerStatus])

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
    const remaining = Math.max(0, timerAnchor.current.remainingSeconds - Math.floor(Math.max(0, timerNow - timerAnchor.current.monotonicMs) / 1000))
    if (remaining !== 0) return
    const workspaceId = selected.id
    const epoch = workspaceLoadEpoch.current
    setTimerUpdating(true)
    void window.coach.studyWorkspace.updateTimer({ workspaceId, action: 'pause' }).then((state) => {
      if (workspaceLoadEpoch.current === epoch && state.workspaceId === workspaceId) { setStudyState(state); setTimerExpired(state.timerRemainingSeconds === 0) }
    }).catch(() => { if (workspaceLoadEpoch.current === epoch) setWorkspaceError('Não foi possível pausar o cronômetro concluído.') }).finally(() => { if (workspaceLoadEpoch.current === epoch) setTimerUpdating(false) })
  }, [timerNow, selected?.id, studyState?.timerRemainingSeconds, studyState?.timerStartedAt, studyState?.timerStatus, timerUpdating, sessionCompleting])

  useEffect(() => {
    const pane = workspaceConversationPane.current
    if (pane && workspaceFollowLatest.current) scrollChatToLatest(pane)
  }, [workspaceMessages, workspaceStreamedContent])

  function activeProviderAccountId():
    string | null {
    /*
     * providerAccounts é atualizado de forma otimista
     * quando o usuário troca de IA.
     *
     * Portanto, isActive representa imediatamente a IA que
     * a interface considera atual.
     *
     * providerStatus fica como fallback para inicialização
     * ou enquanto a lista ainda não terminou de carregar.
     */
    return (
      providerAccounts.find(
        (account) =>
          account.isActive,
      )?.id
      ?? providerStatus?.activeAccountId
      ?? null
    )
  }


  function activeProviderAccount():
    ProviderAccountSummary | null {
    const accountId =
      activeProviderAccountId()

    if (!accountId) {
      return null
    }

    return (
      providerAccounts.find(
        (account) =>
          account.id === accountId,
      )
      ?? null
    )
  }


  function activeProviderRuntimeIssue():
    ProviderRuntimeIssue | undefined {
    const accountId =
      activeProviderAccountId()

    if (!accountId) {
      return undefined
    }

    return providerRuntimeIssues[
      accountId
    ]
  }


  function activeProviderConnecting():
    boolean {
    const account =
      activeProviderAccount()

    if (
      !account
      || !account.model.trim()
    ) {
      return false
    }

    if (
      providerConnectingAccountId
      === account.id
    ) {
      return true
    }

    /*
     * Se já sabemos que o endpoint está inacessível,
     * não estamos conectando: estamos sem conexão.
     */
    if (
      providerStatus?.connectionState
      === 'unreachable'
    ) {
      return false
    }

    /*
     * O probe barato pode confirmar que o gateway,
     * autenticação e catálogo estão acessíveis.
     *
     * Isso sozinho NÃO encerra "Conectando...".
     * A seleção atual continua nesse estado até existir
     * um resultado funcional ou um problema conhecido.
     */
    const runtimeIssue =
      activeProviderRuntimeIssue()

    const healthIssue =
      providerHealthSnapshots[
        account.id
      ]?.runtimeIssue

    /*
     * Ainda não existe resultado suficiente
     * da verificação de conexão atual.
     */
    return (
      runtimeIssue === undefined
      && healthIssue == null
    )
  }


  async function verifyActiveProviderOnce(
    accountId: string,
  ): Promise<void> {
    /*
     * Uma troca de IA/modelo executa UMA geração funcional.
     *
     * Não existe repetição automática.
     * O pequeno tempo mínimo também garante que o usuário
     * consiga perceber visualmente "Conectando...".
     */
    const startedAt =
      performance.now()

    try {
      const snapshot =
        await window.coach.provider
          .checkActiveFunctionalHealth()

      if (
        !snapshot
        || snapshot.accountId
          !== accountId
      ) {
        setProviderRuntimeIssues(
          (current) => ({
            ...current,

            [accountId]:
              'temporarily-unavailable',
          }),
        )

        return
      }

      const runtimeIssue:
        ProviderRuntimeIssue =
          snapshot.runtimeIssue
          ?? 'temporarily-unavailable'

      const functionalSnapshot:
        ProviderAccountHealthSnapshot = {
          ...snapshot,

          runtimeIssue,
        }

      setProviderHealthSnapshots(
        (current) => ({
          ...current,

          [accountId]:
            functionalSnapshot,
        }),
      )

      setProviderRuntimeIssues(
        (current) => ({
          ...current,

          [accountId]:
            runtimeIssue,
        }),
      )

      setProviderStatus(
        (current) => {
          if (
            !current
            || current.activeAccountId
              !== accountId
          ) {
            return current
          }

          return {
            ...current,

            connected:
              functionalSnapshot
                .connectionState
                === 'connected',

            connectionState:
              functionalSnapshot
                .connectionState,

            quota:
              runtimeIssue
                === 'usage-limit'
                ? 'exhausted'
                : runtimeIssue
                    === 'available'
                  ? 'available'
                  : 'unknown',
          }
        },
      )
    } catch {
      /*
       * Falha do próprio check também é um problema
       * funcional. Não inventamos que o gateway caiu.
       */
      setProviderRuntimeIssues(
        (current) => ({
          ...current,

          [accountId]:
            'temporarily-unavailable',
        }),
      )
    } finally {
      const elapsed =
        performance.now()
        - startedAt

      const remaining =
        Math.max(
          0,
          700 - elapsed,
        )

      if (remaining > 0) {
        await new Promise<void>(
          (resolve) =>
            window.setTimeout(
              resolve,
              remaining,
            ),
        )
      }

      setProviderConnectingAccountId(
        (current) =>
          current === accountId
            ? null
            : current,
      )
    }
  }


  useEffect(() => {
    /*
     * Ao abrir o Coach, a IA que já estava selecionada
     * também precisa ser validada funcionalmente.
     *
     * Sem isso, um modelo quebrado poderia aparecer como
     * "Conectado" somente porque o gateway responde.
     */
    const account =
      providerAccounts.find(
        (item) =>
          item.isActive,
      )
      ?? (
        providerStatus?.activeAccountId
          ? providerAccounts.find(
              (item) =>
                item.id
                === providerStatus.activeAccountId,
            )
          : undefined
      )

    if (
      !account
      || !account.isEnabled
      || !account.model.trim()
    ) {
      return
    }

    /*
     * Esperamos renderer e backend concordarem sobre
     * qual conta/modelo estão ativos.
     */
    if (
      providerStatus?.activeAccountId
        !== account.id
      || providerStatus.model
        !== account.model
    ) {
      return
    }

    const verificationKey =
      [
        account.id,
        account.model,
        account.reasoningEffort
          ?? 'auto',
      ].join('::')

    /*
     * onSelect/onUpdate já controlam suas próprias
     * verificações. Não competimos com uma troca
     * explicitamente em andamento.
     */
    if (
      providerConnectingAccountId
        === account.id
    ) {
      return
    }

    const runtimeIssue =
      providerRuntimeIssues[
        account.id
      ]

    const healthIssue =
      providerHealthSnapshots[
        account.id
      ]?.runtimeIssue

    /*
     * Se já existe um resultado funcional conhecido
     * nesta sessão, não gastamos outra chamada.
     */
    if (
      runtimeIssue !== undefined
      || healthIssue != null
    ) {
      providerStartupFunctionalCheckKey.current =
        verificationKey

      return
    }

    if (
      providerStartupFunctionalCheckKey.current
        === verificationKey
    ) {
      return
    }

    providerStartupFunctionalCheckKey.current =
      verificationKey

    setProviderConnectingAccountId(
      account.id,
    )

    /*
     * UMA verificação.
     *
     * verifyActiveProviderOnce encerra o estado
     * Conectando e grava available/problema.
     */
    void verifyActiveProviderOnce(
      account.id,
    )
  }, [
    providerAccounts,
    providerStatus?.activeAccountId,
    providerStatus?.model,
    providerConnectingAccountId,
    providerRuntimeIssues,
    providerHealthSnapshots,
  ])


  function activeProviderUnavailable():
    boolean {
    const account =
      activeProviderAccount()

    if (!account) {
      return false
    }

    if (activeProviderConnecting()) {
      return false
    }

    const issue =
      activeProviderRuntimeIssue()

    /*
     * "available" é confirmação de uma chamada
     * real bem-sucedida.
     *
     * Qualquer outro runtime issue deixa a Home
     * imediatamente em amarelo.
     */
    if (
      issue
      && issue !== 'available'
    ) {
      /*
       * A conexão do gateway pode continuar viva,
       * mas qualquer falha funcional conhecida da
       * IA atual precisa aparecer como problema.
       */
      return true
    }

    if (
      providerStatus?.connected
      !== true
    ) {
      return true
    }

    if (!account.model.trim()) {
      return true
    }

    return false
  }


  function activeProviderConnected():
    boolean {
    const account =
      activeProviderAccount()

    return Boolean(
      account
      && account.model.trim()
      && providerStatus?.connected
        === true
      && !activeProviderConnecting()
      && !activeProviderUnavailable(),
    )
  }


  function activeProviderLabel():
    string {
    const account =
      activeProviderAccount()

    if (!account) {
      return 'IA DESCONECTADA'
    }

    if (!account.model.trim()) {
      return account.providerId
        === 'omniroute'
        ? 'OmniRoute sem modelo'
        : `${account.label} sem modelo`
    }

    if (activeProviderConnecting()) {
      return `${account.label} · Conectando...`
    }

    if (activeProviderUnavailable()) {
      const issue =
        activeProviderRuntimeIssue()

      if (
        issue === 'model-unavailable'
      ) {
        return `${account.label} · modelo indisponível`
      }

      if (
        issue
          === 'temporarily-unavailable'
      ) {
        return `${account.label} · indisponível agora`
      }

      if (
        issue === 'reauth-required'
      ) {
        return `${account.label} · reconectar`
      }

      if (
        issue === 'access-restricted'
      ) {
        return `${account.label} · acesso restrito`
      }

      if (
        issue === 'usage-limit'
      ) {
        return `${account.label} · limite de uso`
      }

      return `${account.label} · não conectada`
    }

    return account.label
  }


  function recordActiveProviderActivity(
    outcome:
      | 'success'
      | 'failure',

    code: string | null = null,
  ): void {
    const account =
      activeProviderAccount()

    if (!account) {
      return
    }

    const activity:
      ProviderLastActivity = {
        outcome,

        at:
          Date.now(),

        code:
          outcome === 'success'
            ? 'OK'
            : code,

        detail:
          outcome === 'success'
            ? 'A última solicitação real foi concluída normalmente.'
            : providerActivityDetailFromStreamCode(
                code ?? 'UNKNOWN',
              ),

        model:
          account.model,
      }

    setProviderLastActivities(
      (current) => {
        const next = {
          ...current,

          [account.id]:
            activity,
        }

        saveProviderLastActivities(
          next,
        )

        return next
      },
    )
  }


  function activeProviderLastActivity():
    ProviderLastActivity | null {
    const accountId =
      activeProviderAccountId()

    if (!accountId) {
      return null
    }

    return (
      providerLastActivities[
        accountId
      ]
      ?? null
    )
  }


  function markActiveProviderRuntime(
    state: ProviderRuntimeIssue,
  ): void {
    const accountId =
      activeProviderAccountId()

    if (!accountId) {
      return
    }

    setProviderRuntimeIssues(
      (current) => ({
        ...current,
        [accountId]:
          state,
      }),
    )
  }


  function currentAIProblem():
    AIAvailabilityProblem | null {
    const accountId =
      activeProviderAccountId()

    if (
      !providerStatus?.configured
      || !accountId
    ) {
      return 'no-ai'
    }

    if (
      providerStatus.quota
      === 'exhausted'
    ) {
      return 'usage-limit'
    }

    if (
      providerStatus.connectionState
      === 'unreachable'
    ) {
      return 'temporarily-unavailable'
    }

    return null
  }


  function openAIManagement(): void {
    const navigate = () => {
      streamHandle.current?.cancel()
      streamHandle.current?.dispose()
      streamHandle.current = null

      setPlannerSending(false)
      setStreamedContent('')
      setAIProblem(null)

      workspaceOpenEpoch.current += 1
      stopWorkspaceStream()

      setSelected(null)
      setHomeSection('ai')

      setAIManageRequest(
        (current) =>
          current + 1,
      )
    }

    if (activeExerciseContext) {
      void activeExerciseContext
        .flushDraft()
        .catch(() => {})
        .finally(navigate)

      return
    }

    navigate()
  }

  async function sendPlannerMessage() {
    const content = plannerInput.trim()
    if (!content || plannerSending || plannerLoading) return

    const problem =
      currentAIProblem()

    if (problem) {
      setAIProblem(problem)
      return
    }
    const retryIdentity = plannerRequestIdentity(plannerRetry.current, content, () => crypto.randomUUID())
    const requestId = retryIdentity.requestId
    plannerRetry.current = retryIdentity
    const epoch = ++homeRequestEpoch.current
    setPlannerSending(true); setPlannerInput(''); setPlannerError(null); setStreamedContent('')
    setMessages((current) => appendOptimisticMessage(current, optimisticMessage(content, (current.at(-1)?.sequence ?? 0) + 1, requestId)))
    streamHandle.current?.dispose()
    streamHandle.current = window.coach.conversation.streamHomeMessage({ requestId, content }, (event) => {
      if (homeRequestEpoch.current !== epoch) return
      if (event.type === 'text-delta') setStreamedContent((current) => current + event.content)
      if (event.type === 'completed') {
        if (plannerRetry.current?.requestId === requestId) plannerRetry.current = null
        markActiveProviderRuntime('available')
        recordActiveProviderActivity(
          'success',
        )
        setMessages((current) => reconcileConversationMessages(current, event.messages))
        setPlannerSending(false); setStreamedContent(''); streamHandle.current = null
        void window.coach.plannerAction.listPending().then((actions) => { if (homeRequestEpoch.current === epoch) setPlannerActions(actions) })
        void Promise.all([window.coach.planning.listPriorities(), window.coach.planning.getSchedule(), window.coach.planning.getAcademicOverview(), window.coach.planning.getWeeklyPlan()]).then(([nextPriorities, nextSchedule, overview, nextWeek]) => { if (homeRequestEpoch.current === epoch) { setPriorities(nextPriorities); setSchedule(nextSchedule); setAcademicOverview(overview); setWeeklyPlan(nextWeek) } }).catch(() => { if (homeRequestEpoch.current === epoch) setPlannerError('A ação pode ter sido salva, mas não foi possível atualizar toda a tela. Recarregue para confirmar o estado persistido.') })
      }
      if (event.type === 'cancelled' || event.type === 'error') {
        setPlannerSending(false)
        setStreamedContent('')
        setPlannerInput(content)
        streamHandle.current = null

        if (event.type === 'error') {
          const issue =
            providerRuntimeIssueFromStreamCode(
              event.code,
            )

          if (issue) {
            markActiveProviderRuntime(issue)
          recordActiveProviderActivity(
            'failure',
            event.code,
          )
            setAIProblem(issue)
            setPlannerError(null)
          } else {
            setPlannerError(
              event.code === 'THREAD_BUSY'
                ? 'A solicitação anterior ainda está em andamento.'
                : 'A IA não conseguiu responder. Sua mensagem continua pronta para tentar novamente.',
            )
          }
        } else {
          setPlannerError(null)
        }

        void window.coach.conversation
          .listHomeMessages()
          .then((loaded) => {
            if (
              homeRequestEpoch.current
              === epoch
            ) {
              setMessages(
                (current) =>
                  reconcileConversationMessages(
                    current,
                    loaded,
                  ),
              )
            }
          })
      }
    })
  }

  async function createWorkspace(input: CreateWorkspaceInput) {
    setSubmitting(true)
    try {
      const workspace = await window.coach.workspace.create(input)
      setDialogOpen(false)
      setWorkspaceCreationInitial(null)
      setSelected(null)
      setHomeSection('workspaces')
      await loadWorkspaces()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('WORKSPACE_DUPLICATE|')) throw error
      setError('Não foi possível criar o Workspace. Verifique os campos e tente novamente.')
      throw error
    } finally {
      setSubmitting(false)
    }
  }

  async function openWorkspace(id: string) {
    const openEpoch = ++workspaceOpenEpoch.current
    stopWorkspaceStream()
    try {
      const workspace = await window.coach.workspace.open(id)
      if (workspaceOpenEpoch.current !== openEpoch) return
      if (!workspace) throw new Error('Workspace not found')
      const snapshot = workspaceChat.current.activate(workspace.id)
      setWorkspaceMessages(snapshot.messages)
      setWorkspaceStreamedContent(snapshot.partial)
      setWorkspacePage('overview')
      setSelected(workspace)
      const pending = await window.coach.plannerAction.listPending()
      if (workspaceOpenEpoch.current !== openEpoch) return
      setWorkspacePlannerActions(pending.filter((action) => (action.payload as { workspaceId?: string } | null)?.workspaceId === workspace.id))
      await loadWorkspaces()
    } catch {
      if (workspaceOpenEpoch.current === openEpoch) setError('Este Workspace não está mais disponível.')
    }
  }

  async function archiveWorkspace(id: string) {
    if (!window.confirm('Arquivar este Workspace? Você poderá restaurá-lo em uma versão futura.')) return
    try {
      await window.coach.workspace.archive(id)
      const snapshot = await refreshDependentProjections()
      if (selected?.id === id || !snapshot.workspaces.some((workspace) => workspace.id === selected?.id)) { workspaceOpenEpoch.current += 1; stopWorkspaceStream(); setSelected(null); setHomeSection('home') }
    } catch {
      setError('Não foi possível arquivar o Workspace.')
    }
  }

  async function resolveHomePlannerAction(actionId: string, decision: 'apply' | 'reject') {
    if (plannerSending || plannerLoading) return
    setPlannerSending(true); setPlannerError(null)
    try {
      const action = await window.coach.plannerAction.resolve({ actionId, decision })
      setPlannerActions(await window.coach.plannerAction.listPending())
      if (action.type === 'workspace.prepare' && decision === 'apply') { const result = action.result as { name: string; objective: string }; setWorkspaceCreationInitial(result); setDialogOpen(true) }
      const message = decision === 'reject' ? `A ação ${action.label} foi descartada.` : action.type === 'workspace.prepare' ? 'Abri a preparação do Workspace com os dados disponíveis.' : action.type === 'workspace.create' ? `Criei o Workspace ${(action.result as { name?: string } | null)?.name ?? ''}.` : `${action.label} foi aplicada.`
      const returnedTurn = await window.coach.conversation.saveHomeActionResult(message)
      setMessages((current) => reconcileConversationMessages(current, returnedTurn))
      if (decision === 'apply') await refreshDependentProjections()
    } catch {
      setPlannerError('Esta ação já foi executada ou ficou obsoleta.')
    } finally {
      setPlannerSending(false)
    }
  }

  async function resolveWorkspacePlannerAction(workspaceId: string, actionId: string, decision: 'apply' | 'reject') {
    if (workspaceSending) return
    setWorkspaceSending(true); setWorkspaceError(null)
    try {
      const action = await window.coach.plannerAction.resolve({ actionId, decision })
      setWorkspacePlannerActions((current) => current.filter((item) => item.id !== action.id))
      if (decision === 'apply') {
        await refreshDependentProjections()
        const state = await window.coach.studyWorkspace.getState(workspaceId)
        setStudyState(state)
        setWorkspaceMessages((current) => workspaceChat.current.cacheMessages(workspaceId, reconcileConversationMessages(current, [{ id: crypto.randomUUID(), role: 'assistant', content: `Ação aplicada e persistida: ${action.label}.`, createdAt: Date.now(), sequence: (current.at(-1)?.sequence ?? 0) + 1, providerId: 'coach-local', modelId: 'planner-action-v1' }])))
      }
    } catch {
      setWorkspaceError('Não foi possível resolver a ação; nenhuma confirmação de sucesso foi registrada.')
    } finally {
      setWorkspaceSending(false)
    }
  }

  async function sendWorkspaceMessage(contentOverride?: string) {
    const content = (contentOverride ?? workspaceInput).trim()
    if (!selected || !content || workspaceSending || workspaceLoading) return
    if (workspacePage === 'studies' && (!studyProgress || !studyModule || !studyProgress.lessonId)) { setWorkspaceError('Aguarde o tópico atual ser carregado antes de conversar com o Coach.'); return }
    const problem =
      currentAIProblem()

    if (problem) {
      setWorkspaceError(null)
      setAIProblem(problem)
      return
    }
    if (workspacePage === 'exercises' && activeExerciseContext) {
      try { await activeExerciseContext.flushDraft() }
      catch { setWorkspaceError('Não foi possível salvar o código atual antes de consultar o Tutor.'); return }
    }
    if (workspacePage === 'studies' && studyProgress?.lessonId && studyModule && /\b(não entendi|nao entendi|ajuda|dica|explique|explica)\b/i.test(content)) {
      void window.coach.studyProgress.record({ workspaceId: selected.id, type: 'HELP_USED', moduleId: studyProgress.moduleId, topicId: studyProgress.topicId, lessonId: studyProgress.lessonId, checkpointId: studyProgress.checkpointId, requestId: crypto.randomUUID(), helpType: 'coach_help_requested' }).then((event) => event.shouldReplan ? window.coach.studyWorkspace.recalculatePlan({ workspaceId: selected.id }).then(setStudyState) : undefined)
    }
    workspaceFollowLatest.current = true
    setWorkspaceSending(true)
    setWorkspaceSendStage('sending')
    setWorkspaceContextSummary(null)
    const requestId = crypto.randomUUID()
    setWorkspaceMessages((current) => {
      const next = appendOptimisticMessage(current, optimisticMessage(content, (current.at(-1)?.sequence ?? 0) + 1, requestId))
      workspaceChat.current.cacheMessages(selected.id, next)
      return next
    })
    workspaceDrafts.current.set(selected.id, content)
    setWorkspaceInput('')
    setWorkspaceStreamedContent('')
    setWorkspaceError(null)
    const workspaceId = selected.id
    const generation = workspaceChat.current.beginStream(workspaceId)
    setWorkspaceMessages((current) => workspaceChat.current.cacheMessages(workspaceId, current))
    const isCurrentRequest = () => workspaceChat.current.accepts(workspaceId, generation)
    const latestExecution = workspacePage === 'practice' ? practiceContext?.execution ?? execution : null
    const activeTopic = studyModule?.topics.find((topic) => `${studyModule.id}:${topic}` === studyProgress?.topicId)
    const activeLesson = studyLesson?.topicId === studyProgress?.topicId ? studyLesson : null
    const currentBlock = activeLesson?.blocks.find((block) => block.id === studyProgress?.currentPosition?.currentBlockId)
    const currentExcerpt = studyLessonBlockExcerpt(currentBlock)
    const requestMaterial = workspacePage === 'materials' ? activeMaterial : null
    workspaceStreamHandle.current = window.coach.conversation.streamWorkspaceMessage({ requestId, workspaceId, content, activePage: workspacePage, activeExercise: workspacePage === 'exercises' && activeExerciseContext ? { exerciseId: activeExerciseContext.exerciseId } : undefined, activeMaterial: requestMaterial, activeStudy: workspacePage === 'studies' && studyModule && studyProgress && activeTopic && activeLesson && studyProgress.currentPosition ? { roadmapId: activeLesson.roadmapId, moduleId: studyModule.id, module: studyModule.title, topicId: studyProgress.topicId, topic: activeTopic, lessonId: activeLesson.id, currentBlockId: studyProgress.currentPosition.currentBlockId, checkpointId: studyProgress.checkpointId, currentExcerpt } : undefined, activeInteractiveCode: workspacePage === 'studies' && interactiveCodeContext ? { lessonId: interactiveCodeContext.state.lessonId, blockId: interactiveCodeContext.block.id, interactionType: interactiveCodeContext.block.interactionType, instruction: interactiveCodeContext.block.instruction, language: interactiveCodeContext.block.language, code: interactiveCodeContext.state.currentCode, prediction: interactiveCodeContext.state.prediction, attempts: interactiveCodeContext.state.attempts, lastExecution: interactiveCodeContext.state.lastExecution ? { stdout: interactiveCodeContext.state.lastExecution.stdout, stderr: interactiveCodeContext.state.lastExecution.stderr, exitCode: interactiveCodeContext.state.lastExecution.exitCode, timedOut: interactiveCodeContext.state.lastExecution.timedOut } : null, validationResult: interactiveCodeContext.state.validationResult ? { status: interactiveCodeContext.state.validationResult.status, message: interactiveCodeContext.state.validationResult.message } : null } : undefined, practiceContext: workspacePage === 'practice' && practiceContext ? { fileName: practiceContext.fileName, language: practiceContext.language, code: practiceContext.code } : undefined, lastExecution: latestExecution ? { stdout: latestExecution.stdout, stderr: latestExecution.stderr, exitCode: latestExecution.exitCode, timedOut: latestExecution.timedOut } : null }, (event) => {
      if (!isCurrentRequest()) return
      if (event.type === 'started' || event.type === 'state') setWorkspaceSendStage(event.state)
      if (event.type === 'state' && event.metadata) setWorkspaceContextSummary(`${event.metadata.historyCount ?? 0} mensagens · ${event.metadata.contextResources?.length ?? 0} fontes`)
      if (event.type === 'text-delta') { setWorkspaceSendStage(null); const next = workspaceChat.current.appendPartial(workspaceId, generation, event.content); if (next !== null) setWorkspaceStreamedContent(next) }
      if (event.type === 'completed') {
        markActiveProviderRuntime('available')
        recordActiveProviderActivity(
          'success',
        )
        setWorkspaceMessages((current) => workspaceChat.current.reconcileCurrent(workspaceId, current, event.messages) ?? current)
        setWorkspaceStreamedContent('')
        setWorkspaceSending(false)
        setWorkspaceSendStage(null)
        workspaceDrafts.current.delete(workspaceId)
        setActiveMaterial(null)
        workspaceStreamHandle.current = null
        if (event.metadata?.plannerAction) setWorkspacePlannerActions((current) => current.some((item) => item.id === event.metadata!.plannerAction!.id) ? current : [event.metadata!.plannerAction!, ...current])
        void Promise.all([window.coach.studyWorkspace.getState(workspaceId), window.coach.planning.getWeeklyPlan()]).then(([state, plan]) => { if (isCurrentRequest()) { setStudyState(state); setWeeklyPlan(plan) } }).catch(() => { if (isCurrentRequest()) setWorkspaceError('A resposta foi salva, mas não foi possível atualizar o plano exibido.') })
        if (event.metadata?.lessonAdapted && activeLesson && event.metadata.lessonAdapted.lessonId === activeLesson.id) {
          void window.coach.studyLesson.getOrCreate({ workspaceId, roadmapId: activeLesson.roadmapId, moduleId: activeLesson.moduleId, topicId: activeLesson.topicId }).then((result) => { if (isCurrentRequest() && result.status === 'ready') { setStudyLessonLoad(result); setStudyLesson(result.lesson) } })
        }
      }
      if (event.type === 'cancelled') {
        workspaceChat.current.clearPartial(workspaceId, generation)
        setWorkspaceStreamedContent('')
        setWorkspaceSending(false)
        setWorkspaceSendStage(null)
        workspaceDrafts.current.set(workspaceId, content)
        setWorkspaceInput(content)
        workspaceStreamHandle.current = null
      }
      if (event.type === 'error') {
        setWorkspaceSending(false)
        setWorkspaceSendStage(null)

        workspaceDrafts.current.set(
          workspaceId,
          content,
        )

        setWorkspaceInput(content)
        workspaceStreamHandle.current = null

        const issue =
          providerRuntimeIssueFromStreamCode(
            event.code,
          )

        if (issue) {
          markActiveProviderRuntime(issue)
          recordActiveProviderActivity(
            'failure',
            event.code,
          )
          setWorkspaceError(null)
          setAIProblem(issue)
        } else {
          setWorkspaceError(
            event.code === 'THREAD_BUSY'
              ? 'A solicitação anterior ainda está em andamento.'
              : 'A IA não conseguiu responder. Sua pergunta foi preservada localmente quando possível.',
          )
        }

        void window.coach.conversation
          .listWorkspaceMessages(
            workspaceId,
          )
          .then((loaded) => {
            if (!isCurrentRequest()) {
              return
            }

            setWorkspaceMessages(
              (current) =>
                workspaceChat.current
                  .reconcileCurrent(
                    workspaceId,
                    current,
                    loaded,
                  )
                ?? current,
            )

            workspaceChat.current
              .clearPartial(
                workspaceId,
                generation,
              )

            setWorkspaceStreamedContent('')
          })
      }
    })
  }

  if (selected) {
    if (selected.status === 'completed' || selected.status === 'archived') {
      return <main className="coach-app-shell overflow-hidden bg-[#090a0d] p-5 text-white"><section className="coach-scroll-pane mx-auto h-full w-full max-w-6xl rounded-2xl border border-[#2d3040] bg-[#111217] p-6 lg:p-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#72d7aa]">Histórico · somente leitura</p><h1 className="mt-3 text-3xl font-semibold">{selected.name}</h1><p className="mt-3 text-sm leading-6 text-[#9297a3]">{selected.objective || 'Workspace de estudos'}</p></div><button type="button" onClick={() => { setSelected(null); setHistoryDetail(null); setHomeSection('workspaces'); void loadWorkspaces() }} className="rounded-lg bg-[#8c7cff] px-4 py-2.5 text-xs font-bold text-[#0c0d10]">Voltar ao histórico</button></div><div className="mt-6 rounded-xl border border-[#292c35] bg-[#0d0e12] p-4 text-xs text-[#747986]">Este Workspace está {selected.status === 'completed' ? 'concluído' : 'arquivado'}. A consulta abaixo não permite editar, reativar nem produzir nova evidência.</div>{workspaceLoading && <p className="mt-6 text-xs text-[#747986]">Carregando dados preservados…</p>}{historyDetail?.repairConflict && <section className="mt-6 rounded-xl border border-[#e8b96d]/40 bg-[#e8b96d]/[.08] p-5"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#e8b96d]">Conflito duplicado preservado</p><h2 className="mt-2 text-lg font-semibold">Este registro foi preservado separado do Workspace canônico.</h2><p className="mt-2 text-xs leading-5 text-[#b7bbc5]">O reparo encontrou evidências significativas nos dois registros. Evidências não foram mescladas automaticamente. Compare este histórico com “{historyDetail.repairConflict.canonicalWorkspace.name}” antes de qualquer decisão manual.</p><button type="button" onClick={() => void openWorkspace(historyDetail.repairConflict!.canonicalWorkspace.id)} className="mt-4 rounded-lg border border-[#e8b96d]/50 px-3 py-2 text-xs font-bold text-[#e8b96d]">Abrir Workspace canônico</button></section>}{historyDetail && <><div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['Tópicos', `${historyDetail.progress.completedTopics}/${historyDetail.progress.totalTopics}`], ['Evidências', historyDetail.progress.evidenceEvents], ['Tentativas', `${historyDetail.performance.successfulAttempts}/${historyDetail.performance.attempts}`], ['Foco', `${Math.floor(historyDetail.performance.focusSeconds / 60)} min`]].map(([label, value]) => <article key={label} className="rounded-xl border border-[#292c35] bg-[#0d0e12] p-4"><strong className="text-2xl">{value}</strong><span className="mt-2 block text-[10px] uppercase tracking-wider text-[#747986]">{label}</span></article>)}</div><div className="mt-6 grid gap-5 lg:grid-cols-2"><section className="rounded-xl border border-[#292c35] p-5"><h2 className="text-sm font-bold">Trilha preservada</h2>{historyDetail.roadmap ? <><p className="mt-2 text-xs text-[#9297a3]">{historyDetail.roadmap.title}</p>{historyDetail.roadmap.modules.map((module) => <article key={module.title} className="mt-3 border-t border-[#292c35] pt-3"><strong className="text-xs">{module.title}</strong><p className="mt-1 text-[11px] text-[#747986]">{module.topics.join(' · ')}</p></article>)}</> : <p className="mt-3 text-xs text-[#747986]">Nenhuma Trilha persistida.</p>}</section><section className="rounded-xl border border-[#292c35] p-5"><h2 className="text-sm font-bold">Materiais</h2>{historyDetail.materials.map((material) => <article key={material.id} className="mt-3 border-t border-[#292c35] pt-3"><strong className="text-xs">{material.name}</strong><p className="mt-1 text-[11px] text-[#747986]">{material.pageCount} página(s) · {material.status}</p></article>)}{historyDetail.materials.length === 0 && <p className="mt-3 text-xs text-[#747986]">Nenhum material persistido.</p>}</section></div><section className="mt-5 rounded-xl border border-[#292c35] p-5"><h2 className="text-sm font-bold">Sessões e desempenho</h2>{historyDetail.sessions.map((session) => <article key={`${session.startedAt}:${session.endedAt}`} className="mt-3 grid grid-cols-[1fr_auto] gap-3 border-t border-[#292c35] pt-3 text-xs"><span>{new Date(session.startedAt).toLocaleString('pt-BR')}</span><span className="text-[#72d7aa]">{Math.floor(session.focusSeconds / 60)} min · {session.status}</span></article>)}{historyDetail.sessions.length === 0 && <p className="mt-3 text-xs text-[#747986]">Nenhuma sessão persistida.</p>}</section></>}</section></main>
    }
    const completedItems = studyState?.plan.filter((item) => item.status === 'completed').length ?? 0
    const timerRemaining = studyState ? Math.max(0, studyState.timerStatus === 'running' ? timerAnchor.current.remainingSeconds - Math.floor(Math.max(0, timerNow - timerAnchor.current.monotonicMs) / 1000) : studyState.timerRemainingSeconds) : 0
    const timerLabel = `${String(Math.floor(timerRemaining / 60)).padStart(2, '0')}:${String(timerRemaining % 60).padStart(2, '0')}`
    const activeDuration = studyState?.plan.find((item) => item.status === 'active')?.durationMinutes
    const livePriority = priorities.find((item) => item.workspaceId === selected.id)
    const adaptiveMinutes = activeDuration ?? 25
    const applyStudyState = (workspaceId: string, epoch: number) => (state: StudyWorkspaceState) => {
      if (workspaceLoadEpoch.current === epoch && state.workspaceId === workspaceId) setStudyState(state)
    }
    const activePlan = studyState?.plan.find((item) => item.status === 'active')
    const nextStep = deriveNextStepCta(activePlan)
    const openMaterials = (materialId?: string) => { setWorkspacePage('materials'); setMaterialResults([]); void window.coach.material.list(selected.id).then((items) => { setMaterials(items); if (materialId) { const item = items.find((candidate) => candidate.id === materialId); if (item) { setActiveMaterial({ materialId: item.id, name: item.name, pageOrSlide: null, selectedText: null }); window.setTimeout(() => document.getElementById(`material-${item.id}`)?.scrollIntoView({ block: 'center' }), 0) } } }) }
    const openReports = () => { setWorkspacePage('reports'); void window.coach.studyWorkspace.listSessionHistory(selected.id).then(setSessionHistory).catch(() => setWorkspaceError('Não foi possível carregar o histórico.')) }
    const openExercises = (roadmap?: Roadmap, topicId?: string, moduleId?: string, exerciseSetId?: string) => {
      studySelectionEpoch.current += 1
      setLearningPathOpen(false); setWorkspaceError(null); setActiveExerciseContext(null); setExerciseSetId(exerciseSetId ?? null); setWorkspacePage('exercises')
      if (roadmap) {
        const target = exactTopic(roadmap, moduleId ?? null, topicId ?? null)
        const firstModule = roadmap.modules.find((module) => module.status !== 'locked' && module.topics.length > 0)
        setExerciseRoadmap(roadmap); setExerciseTopicId(target?.topicId ?? (firstModule ? `${firstModule.id}:${firstModule.topics[0]}` : null)); return
      }
      void Promise.all([window.coach.roadmap.get(selected.id), window.coach.studyProgress.get(selected.id)]).then(([loadedRoadmap, saved]) => {
        if (!loadedRoadmap) { setWorkspaceError('Crie ou aceite uma Trilha antes de abrir os exercícios.'); return }
        const savedTopic = saved?.roadmapId === loadedRoadmap.id && loadedRoadmap.modules.some((module) => module.status !== 'locked' && module.id === saved.moduleId && module.topics.some((topic) => `${module.id}:${topic}` === saved.topicId)) ? saved.topicId : null
        const firstModule = loadedRoadmap.modules.find((module) => module.status !== 'locked' && module.topics.length > 0)
        const target = exactTopic(loadedRoadmap, moduleId ?? null, topicId ?? null)
        setExerciseRoadmap(loadedRoadmap); setExerciseTopicId(target?.topicId ?? savedTopic ?? (firstModule ? `${firstModule.id}:${firstModule.topics[0]}` : null))
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
    const openStudies = (moduleId?: string, topicId?: string) => {
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
        const requestedTopicIndex = topicId ? module.topics.findIndex((topic) => `${module.id}:${topic}` === topicId) : -1
        if (requestedTopicIndex >= 0) { if (studySelectionEpoch.current === selectionEpoch) await selectStudyTopic(roadmap, module, requestedTopicIndex); return }
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
    const selectPage = (page: WorkspacePage) => { void (async () => { if (workspacePage === 'exercises' && page !== 'exercises') await leaveExercises(); if (page === 'studies') openStudies(); else if (page === 'exercises') openExercises(); else { studySelectionEpoch.current += 1; setLearningPathOpen(false); setStudyModule(null); if (page === 'materials') openMaterials(); else if (page === 'reports') openReports(); else if (page === 'plan') { setWorkspacePage(page); void window.coach.studyWorkspace.getState(selected.id).then(setStudyState).catch(() => setWorkspaceError('Não foi possível carregar a projeção do plano global.')) } else setWorkspacePage(page) } })() }
    const openNextStep = () => {
      if (!nextStep) return
      navigateNextStep(nextStep, {
        openStudies: (target) => openStudies(target.moduleId ?? undefined, target.topicId ?? undefined),
        openExercises: (target) => openExercises(undefined, target.topicId ?? undefined, target.moduleId ?? undefined, target.exerciseSetId ?? undefined),
        openMaterial: (materialId) => openMaterials(materialId),
        openPage: selectPage,
      })
    }
    return (
      <WorkspaceShell name={selected.name} objective={selected.objective} page={workspacePage} timerLabel={timerLabel} timerRunning={studyState?.timerStatus === 'running'} finishing={sessionCompleting} coachMessages={workspaceMessages} streamedMessage={workspaceStreamedContent} coachInput={workspaceInput} coachBusy={workspaceSending || workspaceLoading} coachStage={workspaceSendStage} coachContextSummary={workspaceContextSummary} coachError={workspaceError} providerLabel={activeProviderLabel()} providerConnected={activeProviderConnected()} providerUnavailable={Boolean(activeProviderAccount()) && activeProviderUnavailable()} plannerActions={workspacePlannerActions} conversationRef={workspaceConversationPane} messageEndRef={workspaceMessageEnd} onConversationScroll={() => { const pane = workspaceConversationPane.current; if (pane) workspaceFollowLatest.current = isNearChatBottom(pane) }} onPage={selectPage} onHome={() => { workspaceOpenEpoch.current += 1; stopWorkspaceStream(); void (workspacePage === 'exercises' ? leaveExercises() : Promise.resolve()).then(() => { setSelected(null); setHomeSection('home'); void window.coach.planning.listPriorities().then(setPriorities) }) }} onSettings={() => {
        workspaceOpenEpoch.current += 1
        stopWorkspaceStream()

        void (
          workspacePage === 'exercises'
            ? leaveExercises()
            : Promise.resolve()
        ).then(() => {
          setSelected(null)
          setHomeSection('ai')
        })
      }} onToggleTimer={() => { if (!studyState || timerUpdating) return; const workspaceId = selected.id; const epoch = workspaceLoadEpoch.current; const action = studyState.timerStatus === 'running' ? 'pause' : 'start'; setTimerUpdating(true); const configure = action === 'start' && studyState.timerStatus === 'idle' && studyState.timerDurationSeconds !== adaptiveMinutes * 60 ? window.coach.studyWorkspace.setTimerDuration({ workspaceId, durationSeconds: adaptiveMinutes * 60 }) : Promise.resolve(studyState); void configure.then(() => window.coach.studyWorkspace.updateTimer({ workspaceId, action })).then(applyStudyState(workspaceId, epoch)).catch(() => setWorkspaceError('Não foi possível atualizar o foco.')).finally(() => setTimerUpdating(false)) }} onFinish={() => { if (sessionCompleting) return; setSessionCompleting(true); void window.coach.studyWorkspace.completeSession(selected.id).then(setStudyState).finally(() => setSessionCompleting(false)) }} onCoachInput={setWorkspaceInput} onCoachSend={sendWorkspaceMessage} onResolveAction={(actionId, decision) => void resolveWorkspacePlannerAction(selected.id, actionId, decision)} onNotes={() => setNotesOpen(true)}>
        {timerExpired && activePlan && <div ref={timerExpiredDialogRef} role="dialog" aria-modal="true" aria-labelledby="timer-expired-title" className="absolute inset-0 z-30 grid place-items-center bg-black/65 p-5"><section className="w-full max-w-lg rounded-2xl border border-coach-yellow/40 bg-[#111217] p-7 shadow-2xl"><p className="text-xs font-black uppercase tracking-[.18em] text-coach-yellow">Bloco de foco encerrado</p><h2 id="timer-expired-title" className="mt-2 font-display text-2xl font-black">O tempo terminou. A atividade não foi concluída.</h2><p className="mt-3 text-sm leading-6 text-coach-muted">O cronômetro registrou o tempo de foco, sem concluir a atividade, o tópico ou alterar seu domínio. Escolha o próximo passo para “{activePlan.title}”.</p><div className="mt-6 flex flex-wrap gap-3"><button disabled={timerUpdating} onClick={() => { setTimerUpdating(true); void window.coach.studyWorkspace.updateTimer({ workspaceId: selected.id, action: 'extend' }).then((state) => { setStudyState(state); setTimerExpired(false) }).finally(() => setTimerUpdating(false)) }} className="rounded-xl bg-coach-yellow px-4 py-3 text-sm font-black text-[#0c0d10]">Estender +10 min</button><button disabled={timerUpdating} onClick={() => { setTimerUpdating(true); void window.coach.studyWorkspace.updateTimer({ workspaceId: selected.id, action: 'pause' }).then((state) => { setStudyState(state); setTimerExpired(false) }).finally(() => setTimerUpdating(false)) }} className="rounded-xl border border-coach-line px-4 py-3 text-sm font-black">Continuar depois</button><button disabled={planUpdating} onClick={() => { setPlanUpdating(true); void window.coach.studyWorkspace.completePlanItem({ workspaceId: selected.id, itemId: activePlan.id }).then((state) => { setStudyState(state); setTimerExpired(false) }).finally(() => setPlanUpdating(false)) }} className="rounded-xl bg-coach-green px-4 py-3 text-sm font-black text-white">Concluir atividade</button></div></section></div>}
        {workspacePage === 'studies' && <div className="relative flex h-full min-h-0 flex-col overflow-hidden">{livePriority?.eventPhase === 'today' && <div className="shrink-0 border-b border-coach-orange/30 bg-coach-orange/10 px-6 py-3 text-xs text-coach-muted"><strong className="text-coach-orange">Revisão para a prova hoje.</strong> A aula continua completa; pontos de revisão recebem destaque visual.</div>}{studyModule && studyRoadmap && studyProgress && studyLesson ? <><div className="flex shrink-0 items-center justify-between gap-4 border-b border-coach-line px-6 py-3"><p className="min-w-0 truncate text-xs text-coach-muted"><span className="text-coach-ink">{selected.name}</span><span className="mx-2">›</span>{studyModule.title}<span className="mx-2">›</span><span className="text-coach-ink">{studyModule.topics.find((topic) => `${studyModule.id}:${topic}` === studyProgress.topicId) ?? studyModule.title}</span></p><button aria-expanded={learningPathOpen} aria-controls="learning-path-drawer" onClick={() => setLearningPathOpen(true)} className="shrink-0 rounded-lg border border-coach-line px-3 py-2 text-xs font-black text-coach-green hover:bg-white/[.03]">Trilha de aprendizado</button></div><div className="min-h-0 flex-1"><StudyLessonView workspaceId={selected.id} module={studyModule} roadmap={studyRoadmap} lesson={studyLesson} progress={studyProgress} reviewMode={livePriority?.eventPhase === 'today'} onExercises={() => openExercises(studyRoadmap, studyProgress.topicId)} onPosition={(position, checkpointStates) => { void window.coach.studyProgress.updatePosition({ workspaceId: selected.id, position, checkpointStates }).then(setStudyProgress) }} onLessonChanged={setStudyLesson} onInteractiveContext={(block, state) => setInteractiveCodeContext({ block, state })} onCheckpoint={() => { void window.coach.studyWorkspace.recalculatePlan({ workspaceId: selected.id }).then(setStudyState) }} onComplete={() => { void window.coach.studyProgress.completeTopic({ workspaceId: selected.id, topicId: studyProgress.topicId }).then(({ state, nextTarget }) => { setStudyProgress(state); if (nextTarget) setStudyLesson(null); return Promise.all([window.coach.studyWorkspace.recalculatePlan({ workspaceId: selected.id }).then(setStudyState), window.coach.roadmap.get(selected.id).then((roadmap) => { if (roadmap) { setStudyRoadmap(roadmap); const module = nextTarget ? roadmap.modules.find((item) => item.id === nextTarget.moduleId) : null; if (module) setStudyModule(module) } }), nextTarget ? window.coach.studyLesson.getOrCreate({ workspaceId: selected.id, roadmapId: studyProgress.roadmapId, moduleId: nextTarget.moduleId, topicId: nextTarget.topicId }).then((result) => { if (result.status === 'ready') setStudyLesson(result.lesson); else setWorkspaceError(result.status === 'waiting_for_provider' ? 'A próxima aula aguarda um provedor de IA.' : 'Não foi possível preparar a próxima aula agora.') }) : Promise.resolve()]) }).catch((error) => setWorkspaceError(error instanceof Error ? error.message : 'Ainda existem critérios obrigatórios pendentes.')) }} onPractice={() => setWorkspacePage('practice')} /></div><LearningPathDrawer open={learningPathOpen} roadmap={studyRoadmap} progress={studyProgress} onClose={() => setLearningPathOpen(false)} onSelect={(module, topicIndex) => selectStudyTopic(studyRoadmap, module, topicIndex).catch((error) => { setWorkspaceError('Não foi possível abrir este tópico agora.'); throw error })} /></> : <div className="grid min-h-0 flex-1 place-items-center p-8 text-center"><div><p className="font-display text-xl font-black text-coach-ink">{studyLessonLoad?.status === 'waiting_for_provider' ? 'Esta aula será preparada quando a IA estiver disponível.' : studiesPreparationMessage(studyLessonLoad, learningPathState)}</p><p className="mt-2 text-xs text-coach-muted">Você pode continuar usando o Coach enquanto isso.</p>{studyLessonLoad && studyLessonLoad.status !== 'ready' && <button onClick={() => { setStudyLessonLoad(null); setStudyLessonRetryNonce((value) => value + 1) }} className="mt-4 rounded-lg bg-coach-orange px-4 py-2 text-xs font-black text-white">Tentar novamente</button>}{learningPathState?.status === 'failed_retryable' && <button onClick={() => { void window.coach.roadmap.generate(selected.id).then(() => openStudies()).catch(() => setWorkspaceError('Não foi possível tentar preparar a Trilha agora.')) }} className="mt-4 rounded-lg bg-coach-orange px-4 py-2 text-xs font-black text-white">Tentar novamente</button>}{studyRoadmap && <><button onClick={() => setLearningPathOpen(true)} className="ml-2 mt-4 rounded-lg border border-coach-line px-4 py-2 text-xs font-black text-coach-green">Ver Trilha</button><LearningPathDrawer open={learningPathOpen} roadmap={studyRoadmap} progress={studyProgress} onClose={() => setLearningPathOpen(false)} onSelect={(module, topicIndex) => selectStudyTopic(studyRoadmap, module, topicIndex).catch(() => setWorkspaceError('Não foi possível abrir este tópico agora.'))} /></>}</div></div>}</div>}
        {workspacePage === 'exercises' && exerciseRoadmap && exerciseTopicId && <ExercisesWorkspace workspaceId={selected.id} roadmap={exerciseRoadmap} initialTopicId={exerciseTopicId} expectedSetId={exerciseSetId} progressState={studyProgress} onBack={() => { void leaveExercises().then(() => openStudies()) }} onContext={setActiveExerciseContext} />}
        {workspacePage === 'exercises' && (!exerciseRoadmap || !exerciseTopicId) && <div className="grid h-full place-items-center p-8 text-center"><div><p className="font-display text-xl font-black">Carregando a Trilha de exercícios…</p><p className="mt-2 text-xs text-coach-muted">O Coach prepara o tópico atual e o próximo em segundo plano. Esta tela apenas consulta o conteúdo persistido.</p><button type="button" onClick={() => openStudies()} className="mt-4 rounded-lg border border-coach-line px-4 py-2 text-xs font-black text-coach-green">Voltar aos Estudos</button></div></div>}
        {workspacePage === 'review' && <ReviewWorkspace workspaceId={selected.id} onError={setWorkspaceError} />}
        {workspacePage === 'overview' && <div className="coach-scroll-pane h-full p-5 lg:p-8"><div className="mx-auto max-w-5xl"><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Visão geral</p><h2 className="mt-2 font-display text-3xl font-black">Continue de onde parou.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-coach-muted">Objetivo, progresso, foco e próximo passo reunidos em um único lugar.</p><div className="mt-7 grid gap-4 md:grid-cols-3"><article className="rounded-lg border border-coach-line bg-[#111217] p-5"><span className="text-xs font-black text-coach-muted">Módulo atual</span><strong className="mt-2 block font-display text-xl">{planActionLabel(activePlan)}</strong><p className="mt-2 text-xs text-coach-muted">{activePlan?.durationMinutes ?? 0} minutos sugeridos</p></article><article className="rounded-lg border border-coach-line bg-[#111217] p-5"><span className="text-xs font-black text-coach-muted">Progresso de hoje</span><strong className="mt-2 block font-display text-3xl">{studyState?.plan.length ? Math.round(completedItems / studyState.plan.length * 100) : 0}%</strong><div className="mt-3 h-2 overflow-hidden rounded-full bg-coach-line"><div className="h-full bg-coach-green" style={{ width: `${studyState?.plan.length ? completedItems / studyState.plan.length * 100 : 0}%` }} /></div></article><article className="rounded-lg bg-[#12372f] p-5 text-white"><span className="text-xs font-black text-white/55">Observer</span><strong className="mt-2 block font-display text-xl">{observerState?.interventionSuggested ? 'Atenção necessária' : 'Progresso estável'}</strong><p className="mt-2 text-xs text-white/55">{observerState?.focusExitCount ?? 0} saídas de foco</p></article></div><div className="mt-5 rounded-xl bg-[#181622] p-6"><p className="text-xs font-black uppercase text-coach-orange">Próximo passo</p><div className="mt-2 flex flex-wrap items-center justify-between gap-4"><div><strong className="font-display text-2xl">{activePlan?.title ?? 'Revisar aprendizados'}</strong><p className="mt-1 text-sm text-coach-muted">{nextStep?.description ?? 'O plano de hoje foi concluído.'}</p></div>{nextStep && <button onClick={openNextStep} className="rounded-xl bg-coach-orange px-5 py-3 text-sm font-black text-white">{nextStep.label}</button>}</div></div></div></div>}
        {workspacePage === 'plan' && <div className="coach-scroll-pane h-full p-5 lg:p-8"><div className="mx-auto max-w-5xl"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Plano de hoje</p><h2 className="mt-2 font-display text-3xl font-black">Hoje você vai estudar</h2></div><p className="text-xs text-coach-muted">{studyState?.plan.filter((item) => item.status === 'completed').length ?? 0}/{studyState?.plan.length ?? 0} atividades concluídas</p></div><div className="mt-6 space-y-3">{studyState?.plan.map((item) => <article key={item.id} className={`flex w-full items-center gap-4 rounded-lg border p-4 text-left ${item.status === 'active' ? 'border-coach-yellow bg-[#181622]' : 'border-coach-line bg-[#111217]'}`}><button disabled={planUpdating || item.status === 'completed'} onClick={() => { setPlanUpdating(true); void window.coach.studyWorkspace.activatePlanItem({ workspaceId: selected.id, itemId: item.id }).then(setStudyState).finally(() => setPlanUpdating(false)) }} className="flex min-w-0 flex-1 items-center gap-4 text-left disabled:cursor-default"><span className={`grid size-7 shrink-0 place-items-center rounded-full border ${item.status === 'completed' ? 'border-coach-green bg-coach-green text-white' : 'border-coach-line'}`}>{item.status === 'completed' ? '✓' : item.position}</span><span className="min-w-0 flex-1"><strong className="block truncate">{item.title}</strong><small className="text-coach-muted">{item.scheduledStartMinutes !== undefined ? `${String(Math.floor(item.scheduledStartMinutes / 60)).padStart(2, '0')}:${String(item.scheduledStartMinutes % 60).padStart(2, '0')} · ` : ''}{item.durationMinutes} min · {item.status}</small></span></button><button disabled={planUpdating} onClick={() => { setPlanUpdating(true); void window.coach.studyWorkspace.setPlanItemCompletion({ workspaceId: selected.id, itemId: item.id, completed: item.status !== 'completed' }).then(setStudyState).catch(() => setWorkspaceError('Não foi possível alterar a conclusão da atividade.')).finally(() => setPlanUpdating(false)) }} className={item.status === 'completed' ? 'rounded-lg border border-coach-line px-3 py-2 text-xs font-black text-coach-muted' : 'rounded-lg bg-coach-green px-3 py-2 text-xs font-black text-white'}>{item.status === 'completed' ? 'Reabrir / Desfazer' : 'Concluir'}</button></article>)}</div></div></div>}
        {workspacePage === 'materials' && <div className="coach-scroll-pane h-full p-5 lg:p-8"><div className="mx-auto max-w-5xl"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Biblioteca</p><h2 className="mt-2 font-display text-3xl font-black">Materiais do Workspace</h2></div><button onClick={() => void window.coach.material.importFile(selected.id).then((material) => { if (material) setMaterials((current) => [material, ...current]) }).catch((error: unknown) => setWorkspaceError(error instanceof Error ? error.message : 'Não foi possível importar este material.'))} className="rounded-xl bg-coach-orange px-5 py-3 text-sm font-black text-white">Importar PDF/PPTX</button></div><form className="mt-6 flex gap-2" onSubmit={(event) => { event.preventDefault(); void window.coach.material.search({ workspaceId: selected.id, query: materialQuery }).then(setMaterialResults) }}><input minLength={2} value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} placeholder="Buscar nos materiais" className="min-w-0 flex-1 rounded-xl border border-coach-line bg-[#111217] p-3" /><button className="rounded-xl bg-coach-ink px-5 font-black text-white">Buscar</button></form>{(materials.some((item) => item.status === 'ready') || roadmapRebuild) && <section className="mt-6 rounded-xl border border-coach-green/30 bg-coach-green/[.06] p-5"><p className="text-[10px] font-black uppercase tracking-[.16em] text-coach-green">Integração curricular</p><h3 className="mt-2 font-display text-xl font-black">{roadmapRebuild?.materialIds.length === 0 ? 'Completar Trilha legada' : 'Adaptar a Trilha com materiais aprovados'}</h3><p className="mt-2 text-xs leading-5 text-coach-muted">{roadmapRebuild?.materialIds.length === 0 ? 'A Trilha parece terminar antes do escopo solicitado. Confira a reconciliação: nada será alterado sem sua confirmação e IDs, progresso e evidências equivalentes serão preservados.' : 'A importação sozinha não altera o currículo. Gere uma prévia da adaptação da Trilha para conferir o que permanece, o que muda, o que será adicionado e os motivos.'}</p>{materials.some((item) => item.status === 'ready') && <button disabled={roadmapRebuildBusy} onClick={() => { setRoadmapRebuildBusy(true); void window.coach.roadmap.previewRebuild({ workspaceId: selected.id, materialIds: materials.filter((item) => item.status === 'ready').map((item) => item.id) }).then(setRoadmapRebuild).catch((error: unknown) => setWorkspaceError(error instanceof Error ? error.message : 'Não foi possível preparar a adaptação. A Trilha atual foi preservada.')).finally(() => setRoadmapRebuildBusy(false)) }} className="mt-4 rounded-lg bg-coach-green px-4 py-2 text-xs font-black text-white disabled:opacity-50">{roadmapRebuildBusy ? 'Analisando impacto...' : 'Pré-visualizar nova Trilha'}</button>}{roadmapRebuild && <div className="mt-4 rounded-lg border border-coach-line bg-[#0d0e12] p-4 text-xs"><strong>Prévia da adaptação da Trilha: {roadmapRebuild.title}</strong><p className="mt-2 text-coach-muted">{roadmapRebuild.impact.relevance === 'irrelevant' ? 'Nenhuma adaptação é necessária. A Trilha atual será mantida.' : roadmapRebuild.impact.summary} Permanecem {roadmapRebuild.impact.preservedTopicIds.length} tópicos, mudam {(roadmapRebuild.impact.changedTopicIds ?? []).length}, são adicionados {roadmapRebuild.impact.addedTopics.length} e há proposta de remoção para {roadmapRebuild.impact.removedTopics.length}.</p>{(roadmapRebuild.impact.reasons ?? []).map((reason) => <p key={reason} className="mt-1 text-coach-muted">• {reason}</p>)}{roadmapRebuild.impact.unsafeProgressTopicIds.length > 0 && <p role="alert" className="mt-2 font-bold text-coach-orange">Mudança insegura explícita: há progresso em {roadmapRebuild.impact.unsafeProgressTopicIds.length} tópico(s) removido(s). Esse histórico permanece, mas deixa de integrar a Trilha ativa.</p>}{roadmapRebuild.impact.relevance !== 'irrelevant' && <button onClick={() => { const acknowledgeUnsafeChanges = roadmapRebuild.impact.requiresAcknowledgement ? window.confirm('Esta adaptação propõe remover tópicos. O histórico será preservado. Deseja confirmar a alteração destrutiva?') : true; if (!acknowledgeUnsafeChanges) return; setRoadmapRebuildBusy(true); void window.coach.roadmap.applyRebuild({ workspaceId: selected.id, previewId: roadmapRebuild.id, acknowledgeUnsafeChanges }).then((roadmap) => { setStudyRoadmap(roadmap); setRoadmapRebuild(null); setWorkspaceError(null) }).catch((error: unknown) => setWorkspaceError(error instanceof Error ? error.message : 'Não foi possível aplicar. A Trilha atual foi preservada.')).finally(() => setRoadmapRebuildBusy(false)) }} className="mt-3 rounded-lg bg-coach-orange px-4 py-2 font-black text-white">Aplicar adaptação curricular</button>}</div>}</section>}<div className="mt-6 grid gap-4 md:grid-cols-2">{materialResults.map((item) => <article key={`${item.materialId}-${item.pageNumber}`} className="rounded-lg border border-coach-line bg-[#111217] p-5"><strong>{item.materialName} · pág. {item.pageNumber}</strong><p className="mt-3 text-sm leading-6 text-coach-muted">{item.content}</p><button onClick={() => { setActiveMaterial({ materialId: item.materialId, name: item.materialName, pageOrSlide: item.pageNumber, selectedText: item.content.slice(0, 2000) }); setWorkspaceInput(`Explique o trecho selecionado deste material.`) }} className="mt-3 text-xs font-black text-coach-green">Perguntar ao Coach</button></article>)}{!materialResults.length && materials.map((item) => <article id={`material-${item.id}`} key={item.id} className="rounded-lg border border-coach-line bg-[#111217] p-5"><strong className="block break-words">{item.name}</strong><p className="mt-1 text-xs text-coach-muted">{item.pageCount} páginas · {item.semanticAnalysis?.documentType ?? item.mediaType} · relevância {item.semanticAnalysis?.relevance ?? 'aguardando análise'}</p>{item.semanticAnalysis && <><p className="mt-2 text-sm">{item.semanticAnalysis.summary}</p><p className="mt-2 text-xs text-coach-muted">{item.semanticAnalysis.topics.join(' · ')}</p></>}{item.status === 'staged' && <div className="mt-4 flex flex-wrap gap-2"><select defaultValue="reference" id={`role-${item.id}`} className="rounded-lg border border-coach-line bg-[#0d0e12] p-2 text-xs"><option value="base">Base da disciplina</option><option value="priority">Prioritário</option><option value="reference">Referência</option></select><button onClick={() => { const role = (document.getElementById(`role-${item.id}`) as HTMLSelectElement).value as 'base'|'priority'|'reference'; void window.coach.material.decide({ workspaceId: selected.id, materialId: item.id, decision: 'approve', role }).then((updated) => setMaterials((all) => all.map((value) => value.id === item.id ? updated : value))) }} className="rounded-lg bg-coach-green px-3 py-2 text-xs font-black">{item.semanticAnalysis?.relevance === 'unrelated' ? 'Usar mesmo assim como referência' : 'Usar material'}</button><button onClick={() => void window.coach.material.decide({ workspaceId: selected.id, materialId: item.id, decision: 'discard', role: 'reference' }).then((updated) => setMaterials((all) => all.map((value) => value.id === item.id ? updated : value)))} className="rounded-lg border border-coach-line px-3 py-2 text-xs font-black">Descartar</button></div>}{item.status === 'ready' && <button onClick={() => { setActiveMaterial({ materialId: item.id, name: item.name, pageOrSlide: 1, selectedText: null }); void window.coach.material.readPage({ workspaceId: selected.id, materialId: item.id, pageNumber: 1 }).then((page) => setMaterialResults([{ chunkId: `${item.id}-1`, materialId: item.id, materialName: item.name, pageNumber: 1, topicId: null, retrieval: 'lexical', content: page.content }])) }} className="mt-3 text-xs font-black text-coach-green">Abrir material</button>}</article>)}</div></div></div>}
        {workspacePage === 'practice' && <div className="h-full min-h-0 overflow-hidden"><ProjectWorkspace workspaceId={selected.id} workspaceName={selected.name} onError={setWorkspaceError} onContextChange={(context) => { setPracticeContext(context); setExecution(context.execution); if (context.execution?.observerState) { setObserverState(context.execution.observerState); const signature = context.execution.errorSignature; if (context.execution.observerState.interventionSuggested && signature && lastInterventionSignature.current !== signature) { lastInterventionSignature.current = signature; setWorkspaceMessages((current) => workspaceChat.current.cacheMessages(selected.id, [...current, { id: `intervention-${crypto.randomUUID()}`, role: 'assistant' as const, content: `Percebi que o mesmo erro se repetiu. Estou vendo o código atual e a última execução (${context.execution?.stderr.split('\n').filter(Boolean).at(-1) ?? signature}). Posso dar uma pista específica sem entregar a solução.`, createdAt: Date.now(), sequence: (current.at(-1)?.sequence ?? 0) + 1, providerId: 'coach-observer', modelId: null }])) } } }} /></div>}
        {workspacePage === 'videos' && <div className="coach-scroll-pane h-full p-5 lg:p-8"><div className="mx-auto max-w-5xl"><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Vídeos focados</p><h2 className="mt-2 font-display text-3xl font-black">Aprenda sem sair do contexto</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-coach-muted">Use uma busca direcionada ao objetivo deste Workspace. O Coach mantém a conversa e o plano visíveis sem abrir o feed tradicional.</p><div className="mt-7 rounded-xl border border-coach-line bg-[#111217] p-6"><label className="text-xs font-black uppercase text-coach-muted">Buscar no YouTube</label><div className="mt-3 flex gap-2"><input value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} placeholder={`Ex.: ${activePlan?.title ?? selected.name}`} className="min-w-0 flex-1 rounded-xl border border-coach-line bg-coach-paper p-3" /><button onClick={() => { const query = encodeURIComponent(`${materialQuery || activePlan?.title || selected.name} aula`); window.open(`https://www.youtube.com/results?search_query=${query}`, '_blank', 'noopener,noreferrer') }} className="rounded-xl bg-coach-orange px-5 text-sm font-black text-[#0c0d10]">Pesquisar</button></div><p className="mt-3 text-xs text-coach-muted">Links externos abrem somente após sua ação. Nenhum vídeo é enviado automaticamente ao provedor de IA.</p></div></div></div>}
        {workspacePage === 'reports' && <div className="coach-scroll-pane h-full p-5 lg:p-8"><div className="mx-auto max-w-5xl"><p className="text-xs font-black uppercase tracking-[0.18em] text-coach-green">Evolução</p><h2 className="mt-2 font-display text-3xl font-black">Relatórios de aprendizagem</h2><div className="mt-6 grid gap-4 md:grid-cols-2">{sessionHistory.length === 0 && <p className="rounded-lg bg-[#111217] p-5 text-sm text-coach-muted">Comece a estudar para acumular dados neste relatório.</p>}{sessionHistory.map((session) => <article key={session.date} className="rounded-lg border border-coach-line bg-[#111217] p-5"><div className="flex justify-between"><strong>{new Date(`${session.date}T12:00:00`).toLocaleDateString('pt-BR')} · {session.sessionCount} {session.sessionCount === 1 ? 'sessão' : 'sessões'}</strong><span className="rounded-full bg-coach-green/10 px-3 py-1 text-xs font-black text-coach-green">{Math.floor(session.focusSeconds / 60)} min</span></div><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl bg-coach-paper p-3"><strong className="text-xl">{session.executions ? `${session.executions - session.errors}/${session.executions}` : "Não avaliado"}</strong><span className="block text-[10px] text-coach-muted">Execuções sem erro</span></div><div className="rounded-xl bg-coach-paper p-3"><strong className="text-sm">Ainda não avaliada</strong><span className="block text-[10px] text-coach-muted">Retenção após revisão futura</span></div></div><p className="mt-4 text-xs leading-5 text-coach-muted">{session.recommendation}</p></article>)}</div></div></div>}
        {notesOpen && <div ref={notesDialogRef} className="fixed inset-0 z-20 flex justify-end bg-black/30" role="dialog" aria-modal="true" aria-labelledby="quick-notes-title" onMouseDown={() => setNotesOpen(false)}><section className="flex h-full w-full max-w-md flex-col bg-coach-paper p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><h2 id="quick-notes-title" className="font-display text-2xl font-black">Notas rápidas</h2><button aria-label="Fechar notas" onClick={() => setNotesOpen(false)}><X /></button></div><label htmlFor="quick-notes" className="sr-only">Notas rápidas</label><textarea id="quick-notes" value={studyNotes} onChange={(event) => setStudyNotes(event.target.value)} className="mt-6 min-h-0 flex-1 resize-none rounded-lg border border-coach-line bg-[#111217] p-4" /></section></div>}
        {aiProblem && (
          <AIProblemDialog
            problem={aiProblem}
            detail={
              activeProviderLastActivity()
                ?.outcome === 'failure'
                ? activeProviderLastActivity()
                    ?.detail ?? null
                : null
            }
            onManage={openAIManagement}
            onClose={() =>
              setAIProblem(null)
            }
          />
        )}
      </WorkspaceShell>
    )
  }

  return <>
    {aiProblem && (
      <AIProblemDialog
        problem={aiProblem}
        detail={
          activeProviderLastActivity()
            ?.outcome === 'failure'
            ? activeProviderLastActivity()
                ?.detail ?? null
            : null
        }
        onManage={openAIManagement}
        onClose={() =>
          setAIProblem(null)
        }
      />
    )}

    <HomeScreen section={homeSection} loading={loading} error={error} report={globalReport} schedule={schedule} weeklyPlan={weeklyPlan} academicOverview={academicOverview} academicLife={academicLife} workspaces={workspaces} workspaceHistory={workspaceHistory} priorities={priorities} messages={messages} streamedContent={streamedContent} plannerActions={plannerActions} plannerInput={plannerInput} plannerBusy={plannerSending || plannerLoading} plannerError={plannerError} providerLabel={activeProviderLabel()}
      providerConnected={
        activeProviderConnected()
      }
      providerUnavailable={
        Boolean(
          activeProviderAccount(),
        )
        && activeProviderUnavailable()
      }
      aiConnection={{
      status: providerStatus,
      accounts: providerAccounts,
      accountsState: providerAccountsState,
      onRetryAccounts: () => {
        setProviderAccountsState('loading')
        void window.coach.provider.listAccounts().then((accounts) => { setProviderAccounts(accounts); setProviderAccountsState('loaded') }).catch(() => setProviderAccountsState('error'))
      },
      runtimeIssues:
        providerRuntimeIssues,
      healthSnapshots:
        providerHealthSnapshots,

      lastActivities:
        providerLastActivities,

      connectingAccountId:
        providerConnectingAccountId,
      onRefreshHealth:
        refreshProviderHealth,
      openCurrentRequest:
        aiManageRequest,
      onConfigured: async (label, apiKey, model, persistence) => {
        const result = await window.coach.provider.configureOpenAI({
          label,
          apiKey,
          model,
          persistence,
        })
        setProviderStatus(await window.coach.provider.getStatus())
        setProviderAccounts(await window.coach.provider.listAccounts())
        return result
      },
      onConfiguredCompatible: async (
        connectorId,
        label,
        baseUrl,
        apiKey,
        model,
        persistence,
      ) => {
        const result = await window.coach.provider.configureCompatible({
          connectorId,
          label,
          baseUrl,
          apiKey,
          model,
          persistence,
        })
        setProviderStatus(await window.coach.provider.getStatus())
        setProviderAccounts(await window.coach.provider.listAccounts())
        return result
      },
      onBeginGitHubCopilotOAuth: (accountId) =>
        window.coach.provider
          .beginGitHubCopilotOAuth(accountId),

      onCompleteGitHubCopilotOAuth:
        async (flowId) => {
          const result =
            await window.coach.provider
              .completeGitHubCopilotOAuth(
                flowId,
              )

          setProviderStatus(
            await window.coach.provider
              .getStatus(),
          )

          setProviderAccounts(
            await window.coach.provider
              .listAccounts(),
          )

          return result
        },

      onSelect: async (accountId) => {
        const target =
          providerAccounts.find(
            (account) =>
              account.id === accountId,
          )

        if (!target) {
          throw new Error(
            'Provider account not found',
          )
        }

        const previousAccounts =
          providerAccounts

        const previousStatus =
          providerStatus

        const knownHealth =
          providerHealthSnapshots[
            accountId
          ]

        const previousRuntimeIssue =
          providerRuntimeIssues[
            accountId
          ]

        const previousHealthSnapshot =
          providerHealthSnapshots[
            accountId
          ]

        setProviderConnectingAccountId(
          accountId,
        )

        /*
         * Estado visual da nova seleção começa em Conectando.
         *
         * Um resultado antigo desta conta não pode fazer a
         * seleção nova aparecer imediatamente como verde.
         */
        setProviderRuntimeIssues(
          (current) => {
            if (!(accountId in current)) {
              return current
            }

            const next = {
              ...current,
            }

            delete next[
              accountId
            ]

            return next
          },
        )

        setProviderHealthSnapshots(
          (current) => {
            if (!(accountId in current)) {
              return current
            }

            const next = {
              ...current,
            }

            delete next[
              accountId
            ]

            return next
          },
        )

        /*
         * UI otimista:
         *
         * a troca visual acontece no mesmo frame,
         * sem esperar vault, banco ou rede.
         */
        setProviderAccounts(
          (current) =>
            current.map(
              (account) => ({
                ...account,

                isActive:
                  account.id
                  === accountId,
              }),
            ),
        )

        setProviderStatus(
          (current) =>
            current
              ? {
                  ...current,

                  configured:
                    true,

                  activeAccountId:
                    accountId,

                  providerId:
                    target.providerId,

                  providerName:
                    target.providerName,

                  model:
                    target.model,

                  sessionOnly:
                    target.sessionOnly,

                  quota:
                    'unknown',

                  connected:
                    knownHealth
                      ?.connectionState
                    === 'connected',

                  connectionState:
                    knownHealth
                      ?.connectionState
                    ?? 'unchecked',
                }
              : current,
        )

        try {
          /*
           * O backend seleciona a conta sem bloquear
           * a troca em um health-check prévio.
           */
          const status =
            await window.coach.provider
              .selectAccount(
                accountId,
              )

          setProviderStatus(
            status,
          )

          try {
            setProviderAccounts(
              await window.coach.provider
                .listAccounts(),
            )
          } catch {
            /*
             * A seleção já aconteceu.
             * Mantemos o estado otimista.
             */
          }

          await verifyActiveProviderOnce(
            accountId,
          )

          /*
           * Depois do teste funcional, atualizamos também
           * a visão leve das demais contas.
           */
          void refreshProviderHealth()
            .catch(() => {})
        } catch (error) {
          /*
           * Falha estrutural:
           * credencial ausente, conta removida etc.
           *
           * Volta ao estado anterior.
           */
          setProviderAccounts(
            previousAccounts,
          )

          setProviderStatus(
            previousStatus,
          )

          setProviderRuntimeIssues(
            (current) => {
              const next = {
                ...current,
              }

              if (
                previousRuntimeIssue
                === undefined
              ) {
                delete next[
                  accountId
                ]
              } else {
                next[
                  accountId
                ] =
                  previousRuntimeIssue
              }

              return next
            },
          )

          setProviderHealthSnapshots(
            (current) => {
              const next = {
                ...current,
              }

              if (
                previousHealthSnapshot
                === undefined
              ) {
                delete next[
                  accountId
                ]
              } else {
                next[
                  accountId
                ] =
                  previousHealthSnapshot
              }

              return next
            },
          )

          setProviderConnectingAccountId(
            (current) =>
              current === accountId
                ? null
                : current,
          )

          throw error
        }
      },
      onSetEnabled: async (
        accountId,
        enabled,
      ) => {
        /*
         * A mutação é a autoridade.
         *
         * Ativar/desativar é uma operação administrativa e não pode
         * ser considerada falha só porque um refresh posterior ou o
         * provider remoto/local está indisponível.
         */
        const status =
          await window.coach.provider.setAccountEnabled({
            accountId,
            enabled,
          })

        setProviderStatus(status)

        setProviderAccounts((current) =>
          current.map((account) =>
            account.id === accountId
              ? {
                  ...account,
                  isEnabled: enabled,
                  isActive:
                    enabled
                      ? account.isActive
                      : false,
                }
              : account,
          ),
        )

        /*
         * Sincroniza a lista real do backend, mas uma eventual falha
         * deste refresh não desfaz a operação que já foi concluída.
         */
        try {
          setProviderAccounts(
            await window.coach.provider.listAccounts(),
          )
        } catch {
          // Mantemos o estado otimista aplicado acima.
        }
      },
      onListModels: async (
        accountId,
      ) =>
        window.coach.provider
          .listAvailableModels(
            accountId,
          ),

      onUpdate: async (
        accountId,
        label,
        model,
        reasoningEffort,
      ) => {
        /*
         * A mutação concluída pelo backend é a autoridade.
         * O refresh posterior é apenas best-effort.
         */
        const account =
          providerAccounts.find(
            (item) =>
              item.id === accountId,
          )

        if (!account) {
          throw new Error(
            'Provider account not found',
          )
        }

        /*
         * Trocar o modelo da IA ativa é uma nova
         * configuração funcional.
         *
         * Depois que o backend confirmar a alteração,
         * a interface entra em "Conectando..." até o
         * probe barato validar a nova configuração.
         */
        const modelChangedForActiveAccount =
          account.isActive
          && (
            account.model.trim()
              !== model.trim()
            || account.reasoningEffort
              !== reasoningEffort
          )

        const previousConnectingAccountId =
          providerConnectingAccountId

        if (modelChangedForActiveAccount) {
          /*
           * A troca visual começa imediatamente ao salvar.
           * O estado de conexão definitivo vem do probe
           * barato do novo modelo.
           */
          setProviderConnectingAccountId(
            accountId,
          )
        }

        let status

        try {
          status =
            await window.coach.provider.updateAccount({
              accountId,
              label,
              identityLabel:
                account.identityLabel ?? undefined,
              model,
              reasoningEffort,
            })
        } catch (error) {
          if (modelChangedForActiveAccount) {
            setProviderConnectingAccountId(
              (current) =>
                current === accountId
                  ? previousConnectingAccountId
                  : current,
            )
          }

          throw error
        }

        setProviderStatus(status)

        if (modelChangedForActiveAccount) {
          /*
           * Um resultado funcional do modelo anterior
           * não vale para a nova configuração.
           */
          setProviderConnectingAccountId(
            accountId,
          )

          setProviderRuntimeIssues(
            (current) => {
              if (!(accountId in current)) {
                return current
              }

              const next = {
                ...current,
              }

              delete next[
                accountId
              ]

              return next
            },
          )

          setProviderHealthSnapshots(
            (current) => {
              if (!(accountId in current)) {
                return current
              }

              const next = {
                ...current,
              }

              delete next[
                accountId
              ]

              return next
            },
          )
        }

        setProviderAccounts((current) =>
          current.map((item) =>
            item.id === accountId
              ? {
                  ...item,
                  label,
                  model,
                  reasoningEffort,
                }
              : item,
          ),
        )

        if (modelChangedForActiveAccount) {
          await verifyActiveProviderOnce(
            accountId,
          )
        }

        try {
          setProviderAccounts(
            await window.coach.provider.listAccounts(),
          )
        } catch {
          // A edição já foi aplicada no backend.
        }
      },

      onRemove: async (accountId) => {
        /*
         * Remover também não depende da disponibilidade do provider.
         */
        const status =
          await window.coach.provider.removeAccount(
            accountId,
          )

        setProviderStatus(status)

        setProviderAccounts((current) =>
          current.filter(
            (account) =>
              account.id !== accountId,
          ),
        )

        try {
          setProviderAccounts(
            await window.coach.provider.listAccounts(),
          )
        } catch {
          // A conta já foi removida; mantemos a UI coerente.
        }
      },
    }} onSection={setHomeSection} onSettings={() => setHomeSection('ai')} onCreate={() => { setWorkspaceCreationInitial(null); setDialogOpen(true) }} onOpen={(id) => void openWorkspace(id)} onPlanNavigate={(dateKey) => { void window.coach.planning.getWeeklyPlan(dateKey).then(setWeeklyPlan).catch(() => setPlannerError('Não foi possível carregar esse período do plano.')) }} onArchive={(id) => void archiveWorkspace(id)} onRetryProvisioning={(id) => { void window.coach.workspace.retryProvisioning(id).then(() => loadWorkspaces()) }} onPlannerInput={setPlannerInput} onPlannerSend={() => void sendPlannerMessage()} onRefreshAcademicLife={(affectsPlanning) => affectsPlanning ? refreshDependentProjections().then(() => undefined) : refreshAfterAcademicMutation(false, { replan: () => Promise.resolve(), read: () => window.coach.academicLife.getProjection() }).then(setAcademicLife)} onResolveAction={(actionId, decision) => void resolveHomePlannerAction(actionId, decision)} />
    {dialogOpen && <WorkspaceCreationScreen open={dialogOpen} submitting={submitting} initial={workspaceCreationInitial} onClose={() => { setDialogOpen(false); setWorkspaceCreationInitial(null) }} onSubmit={createWorkspace} />}
  </>
}
