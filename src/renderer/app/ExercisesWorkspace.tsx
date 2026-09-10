import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, Circle, HelpCircle, LockKeyhole, Play, Send, TriangleAlert } from 'lucide-react'
import type { ExerciseExecution, ExerciseSet } from '../../shared/contracts/exercise-contract'
import type { Roadmap } from '../../shared/contracts/roadmap-contract'
import { EmbeddedCodeEditor } from './EmbeddedCodeEditor'
import { ExerciseDraftSaver } from './exercise-draft-saver'
import { ExerciseSetLoadGate } from './exercise-set-load-gate'

type Exercise = ExerciseSet['exercises'][number]
type ExerciseProgress = ExerciseSet['progress'][number]

export type ActiveExerciseContext = { exerciseId: string; flushDraft(): Promise<void> }

type TopicLocation = { module: Roadmap['modules'][number]; topic: string; topicId: string }
const topicIdFor = (moduleId: string, topic: string) => `${moduleId}:${topic}`
function exerciseStatus(progress: ExerciseProgress | undefined) {
  if (progress?.status === 'passed') return <CheckCircle2 size={15} aria-label="Aprovado" className="shrink-0 text-coach-green" />
  if (progress?.status === 'in_progress') return <TriangleAlert size={15} aria-label="Em andamento" className="shrink-0 text-coach-orange" />
  return <Circle size={15} aria-label="Não iniciado" className="shrink-0 text-coach-muted" />
}

function executionMessage(execution: ExerciseExecution): string {
  if (execution.passed) return 'Solução aprovada pelos testes.'
  if (execution.status === 'executed') return 'Execução livre concluída. Envie a solução para avaliá-la.'
  if (execution.status === 'compile_error') return 'O código não compilou.'
  if (execution.status === 'runtime_error') return 'O programa terminou com erro de execução.'
  if (execution.status === 'timed_out') return 'O programa excedeu o tempo permitido.'
  return 'A solução ainda não passou em todos os testes.'
}

export function ExercisesWorkspace({ workspaceId, roadmap, initialTopicId, onBack, onContext }: {
  workspaceId: string
  roadmap: Roadmap
  initialTopicId: string
  onBack(): void
  onContext(context: ActiveExerciseContext | null): void
}) {
  const locations = useMemo<TopicLocation[]>(() => roadmap.modules.flatMap((module) => module.topics.map((topic) => ({ module, topic, topicId: topicIdFor(module.id, topic) }))), [roadmap])
  const fallbackTopicId = locations.find((item) => item.module.status !== 'locked')?.topicId ?? locations[0]?.topicId ?? ''
  const [topicId, setTopicId] = useState(locations.some((item) => item.topicId === initialTopicId && item.module.status !== 'locked') ? initialTopicId : fallbackTopicId)
  const [sets, setSets] = useState<Record<string, ExerciseSet | null | undefined>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [prediction, setPrediction] = useState('')
  const [stdin, setStdin] = useState('')
  const [result, setResult] = useState<ExerciseExecution | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [busy, setBusy] = useState<'load' | 'run' | 'submit' | 'help' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadEpoch = useRef(0)
  const selectionEpoch = useRef(0)
  const submitIdentity = useRef<{ exerciseId: string; revision: string; key: string } | null>(null)
  const draftSaver = useRef<ExerciseDraftSaver | null>(null)
  const loadGate = useRef(new ExerciseSetLoadGate())
  if (!draftSaver.current) draftSaver.current = new ExerciseDraftSaver((draft) => window.coach.exercise.saveDraft(draft))
  const location = locations.find((item) => item.topicId === topicId) ?? null
  const set = sets[topicId] ?? null
  const active = set?.exercises.find((exercise) => exercise.id === activeId) ?? set?.exercises[0] ?? null
  const progress = active && set ? set.progress.find((item) => item.exerciseId === active.id) : undefined

  useEffect(() => {
    let current = true
    void Promise.all(locations.map(async ({ topicId: id }) => { try { return [id, await window.coach.exercise.getSet({ workspaceId, topicId: id })] as const } catch { return [id, null] as const } })).then((entries) => { if (current) setSets(Object.fromEntries(entries)) })
    return () => { current = false }
  }, [workspaceId, roadmap.id, locations])

  useEffect(() => () => { void draftSaver.current?.flush() }, [workspaceId, topicId])

  useEffect(() => {
    if (!location || location.module.status === 'locked') return
    const loadKey = `${workspaceId}:${topicId}`
    if (!loadGate.current.canEnsure(loadKey)) return
    const epoch = ++loadEpoch.current
    setBusy('load'); setError(null); setResult(null); setHint(null); setActiveId(null)
    void window.coach.exercise.ensureSet({ workspaceId, roadmapId: roadmap.id, moduleId: location.module.id, topicId, lessonId: `${topicId}:lesson` }).then((next) => {
      if (loadEpoch.current !== epoch) return
      setSets((current) => ({ ...current, [topicId]: next }))
      loadGate.current.record(loadKey, next)
      const first = next.exercises[0]
      setActiveId(first?.id ?? null)
      if (first) { setCode(next.progress.find((item) => item.exerciseId === first.id)?.currentCode ?? first.starterCode); setPrediction(''); submitIdentity.current = null }
    }).catch((cause: unknown) => { loadGate.current.recordFailure(loadKey); if (loadEpoch.current === epoch) setError(cause instanceof Error ? cause.message : 'Não foi possível preparar os exercícios.') }).finally(() => { if (loadEpoch.current === epoch) setBusy(null) })
  }, [workspaceId, roadmap.id, topicId, location?.module.id, location?.module.status])

  useEffect(() => {
    if (!active) { onContext(null); return }
    onContext({ exerciseId: active.id, flushDraft: () => draftSaver.current?.flush() ?? Promise.resolve() })
    return () => onContext(null)
  }, [active, onContext])

  async function selectExercise(exercise: Exercise) {
    const epoch = ++selectionEpoch.current
    setBusy('load')
    await draftSaver.current?.flush()
    if (selectionEpoch.current !== epoch) return
    const refreshed = await window.coach.exercise.getSet({ workspaceId, topicId })
    if (selectionEpoch.current !== epoch) return
    if (refreshed) setSets((current) => ({ ...current, [topicId]: refreshed }))
    setActiveId(exercise.id)
    setCode(refreshed?.progress.find((item) => item.exerciseId === exercise.id)?.currentCode ?? set?.progress.find((item) => item.exerciseId === exercise.id)?.currentCode ?? exercise.starterCode)
    setPrediction('')
    submitIdentity.current = null
    setResult(null); setHint(null); setError(null); setStdin(''); setBusy(null)
  }

  async function selectTopic(nextTopicId: string) {
    if (nextTopicId === topicId) return
    const epoch = ++selectionEpoch.current
    await draftSaver.current?.flush()
    if (selectionEpoch.current !== epoch) return
    setActiveId(null); setCode(''); setPrediction(''); setResult(null); setHint(null)
    setTopicId(nextTopicId)
  }

  function updateCode(value: string) { setCode(value); if (active) draftSaver.current?.schedule({ workspaceId, exerciseId: active.id, code: value }); submitIdentity.current = null }
  function updatePrediction(value: string) { setPrediction(value); submitIdentity.current = null }
  async function refreshSet() { const refreshed = await window.coach.exercise.getSet({ workspaceId, topicId }); if (refreshed) setSets((current) => ({ ...current, [topicId]: refreshed })) }
  async function run() { if (!active || busy || (active.kind === 'PREDICT_OUTPUT' ? !prediction.trim() : !code.trim())) return; setBusy('run'); setError(null); try { await draftSaver.current?.flush(); setResult(await window.coach.exercise.run({ workspaceId, exerciseId: active.id, code: active.kind === 'PREDICT_OUTPUT' ? '' : code, stdin })); await refreshSet() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível executar o código.') } finally { setBusy(null) } }
  async function submit() { if (!active || busy || (active.kind === 'PREDICT_OUTPUT' ? !prediction.trim() : !code.trim())) return; const revision = `${code}\0${prediction}`; const previous = submitIdentity.current; const identity = previous?.exerciseId === active.id && previous.revision === revision ? previous : { exerciseId: active.id, revision, key: crypto.randomUUID() }; submitIdentity.current = identity; setBusy('submit'); setError(null); try { await draftSaver.current?.flush(); const execution = await window.coach.exercise.submit({ workspaceId, exerciseId: active.id, code: active.kind === 'PREDICT_OUTPUT' ? '' : code, prediction: active.kind === 'PREDICT_OUTPUT' ? prediction : null, idempotencyKey: identity.key }); setResult(execution); await refreshSet() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível avaliar a solução.') } finally { setBusy(null) } }
  async function requestHelp() { if (!active || busy) return; setBusy('help'); setError(null); try { const response = await window.coach.exercise.requestHelp({ workspaceId, exerciseId: active.id }); setHint(response.hint); await refreshSet() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a dica.') } finally { setBusy(null) } }
  const nextExercise = active && set ? set.exercises.find((item) => item.position > active.position) ?? null : null

  return <div className="flex h-full min-h-0 bg-[#0b0c10] text-coach-ink">
    <aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-coach-line bg-[#0e1014] p-4 lg:block"><p className="px-2 text-[10px] font-black uppercase tracking-[.18em] text-coach-green">Trilha de exercícios</p>{roadmap.modules.map((module) => <section key={module.id} className="mt-4"><div className="flex items-center gap-2 px-2"><strong className="min-w-0 flex-1 truncate text-xs text-white">{module.position}. {module.title}</strong>{module.status === 'locked' && <LockKeyhole size={13} aria-label="Módulo bloqueado" className="text-coach-muted" />}</div>{module.topics.map((topic) => { const id = topicIdFor(module.id, topic); const selected = id === topicId; const topicSet = sets[id]; const count = topicSet?.status === 'ready' ? `${topicSet.progress.filter((item) => item.status === 'passed').length}/${topicSet.exercises.length}` : null; return <button key={id} disabled={module.status === 'locked'} onClick={() => { void selectTopic(id) }} className={`mt-1 flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-xs ${selected ? 'bg-coach-green/15 text-coach-green' : 'text-coach-muted hover:bg-white/5'} disabled:cursor-not-allowed disabled:opacity-35`}><span className="truncate">{topic}</span><span className="shrink-0" aria-label={count ? `${count} exercícios aprovados` : 'Exercícios ainda não gerados'}>{count ?? (module.status === 'locked' ? <LockKeyhole size={12} /> : '—')}</span></button> })}</section>)}</aside>
    <main className="coach-scroll-pane min-w-0 flex-1 p-5 lg:p-7"><button onClick={onBack} className="flex items-center gap-2 text-xs font-black text-coach-green"><ArrowLeft size={14} /> Voltar aos Estudos</button><p className="mt-6 text-xs font-black uppercase tracking-[.18em] text-coach-orange">Exercícios · {location?.topic ?? 'Tópico'}</p><h2 className="mt-2 font-display text-3xl font-black">Prática estruturada</h2><p className="mt-2 text-sm text-coach-muted"><strong className="text-coach-ink">Executar</strong> testa livremente com a entrada informada. <strong className="text-coach-ink">Enviar</strong> registra uma tentativa e avalia a solução em testes públicos e ocultos.</p>
      {error && <p role="alert" className="mt-6 rounded-lg border border-red-400/35 bg-red-500/10 p-4 text-sm text-red-200">{error}</p>}{busy === 'load' && !set && <p className="mt-6 rounded-lg border border-coach-line bg-[#111217] p-5 text-sm text-coach-muted">Preparando os exercícios deste tópico somente agora…</p>}{set && set.status !== 'ready' && <p className="mt-6 rounded-lg border border-coach-line bg-[#111217] p-5 text-sm text-coach-muted">{set.status === 'generating' ? 'Preparando exercícios…' : set.status === 'waiting_for_provider' ? 'Conecte o provedor para gerar os exercícios deste tópico.' : 'A preparação falhou temporariamente. Abra o tópico novamente após alguns instantes.'}</p>}
      {set?.status === 'ready' && active && <div className="mt-6 grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)]"><nav aria-label="Exercícios do tópico" className="space-y-2">{set.exercises.map((exercise) => { const state = set.progress.find((item) => item.exerciseId === exercise.id); return <button key={exercise.id} onClick={() => selectExercise(exercise)} aria-current={exercise.id === active.id ? 'true' : undefined} className={`flex w-full items-start gap-2 rounded-lg border p-3 text-left text-xs ${exercise.id === active.id ? 'border-coach-green bg-coach-green/10' : 'border-coach-line bg-[#111217]'}`}>{exerciseStatus(state)}<span><strong>{exercise.position}. {exercise.title}</strong><small className="mt-1 block text-coach-muted">{state?.attempts ? `${state.attempts} envio${state.attempts === 1 ? '' : 's'}` : 'Ainda não enviado'}</small></span></button>})}</nav><section className="min-w-0 rounded-xl border border-coach-line bg-[#111217] p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase text-coach-green">Problema {active.position} · {active.language}</p><h3 className="mt-1 text-xl font-black">{active.title}</h3></div>{active.requiredForTopicCompletion && <span className="rounded-full bg-coach-orange/10 px-3 py-1 text-[10px] font-black text-coach-orange">Obrigatório</span>}</div><p className="mt-4 whitespace-pre-line text-sm leading-7 text-coach-muted">{active.statement}</p>{active.kind === 'PREDICT_OUTPUT' ? <><div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-4"><p className="text-xs font-black uppercase text-coach-muted">Código para observar</p><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-sm text-coach-ink">{active.codeToObserve}</pre></div><label className="mt-4 block text-xs font-black uppercase text-coach-muted">{active.predictionPrompt}<textarea value={prediction} disabled={Boolean(busy)} onChange={(event) => updatePrediction(event.target.value.slice(0, 20_000))} className="mt-2 min-h-24 w-full rounded-lg border border-coach-line bg-[#0b0c10] p-3 font-mono text-sm font-normal normal-case text-coach-ink" /></label></> : <><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-black/20 p-3 text-xs"><strong>Entrada</strong><p className="mt-2 whitespace-pre-line text-coach-muted">{active.inputDescription}</p></div><div className="rounded-lg bg-black/20 p-3 text-xs"><strong>Saída</strong><p className="mt-2 whitespace-pre-line text-coach-muted">{active.outputDescription}</p></div></div><div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3 text-xs"><strong>Exemplo público</strong><div className="mt-2 grid gap-3 sm:grid-cols-2"><pre className="whitespace-pre-wrap text-coach-muted">Entrada{`\n`}{active.publicTests[0]?.input || '(sem entrada)'}</pre><pre className="whitespace-pre-wrap text-coach-muted">Saída esperada{`\n`}{active.publicTests[0]?.expectedOutput}</pre></div></div><div className="mt-4 h-72 overflow-hidden rounded-lg border border-white/10"><EmbeddedCodeEditor value={code} language={active.language} path={active.language === 'java' ? 'Main.java' : active.language === 'python' ? 'main.py' : 'main.c'} disabled={Boolean(busy)} maxLength={20_000} onChange={updateCode} /></div><label className="mt-3 block text-xs font-black uppercase text-coach-muted">Entrada para executar<textarea value={stdin} disabled={Boolean(busy)} onChange={(event) => setStdin(event.target.value.slice(0, 20_000))} className="mt-2 min-h-16 w-full rounded-lg border border-coach-line bg-[#0b0c10] p-3 font-mono text-xs font-normal normal-case text-coach-ink" /></label></>}<div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" disabled={Boolean(busy)} onClick={() => void requestHelp()} className="flex items-center gap-2 rounded-lg border border-coach-line px-4 py-2 text-xs font-black disabled:opacity-50"><HelpCircle size={14} /> {busy === 'help' ? 'Carregando…' : 'Pedir dica'}</button><button type="button" disabled={Boolean(busy) || (active.kind === 'PREDICT_OUTPUT' ? !prediction.trim() : !code.trim())} onClick={() => void run()} className="flex items-center gap-2 rounded-lg border border-coach-green px-4 py-2 text-xs font-black text-coach-green disabled:opacity-50"><Play size={14} /> {busy === 'run' ? 'Executando…' : active.kind === 'PREDICT_OUTPUT' ? 'Observar execução' : 'Executar'}</button><button type="button" disabled={Boolean(busy) || (active.kind === 'PREDICT_OUTPUT' ? !prediction.trim() : !code.trim())} onClick={() => void submit()} className="flex items-center gap-2 rounded-lg bg-coach-orange px-4 py-2 text-xs font-black text-white disabled:opacity-50"><Send size={14} /> {busy === 'submit' ? 'Avaliando…' : active.kind === 'PREDICT_OUTPUT' ? 'Enviar previsão' : 'Enviar solução'}</button></div>{hint && <p className="mt-4 rounded-lg border border-coach-yellow/40 bg-coach-yellow/[.07] p-4 text-sm text-coach-muted"><strong className="text-coach-yellow">Dica</strong><span className="mt-1 block">{hint}</span></p>}{result && <div className={`mt-4 rounded-lg border p-4 text-sm ${result.passed ? 'border-coach-green/40 bg-coach-green/10' : result.mode === 'run' && result.status === 'executed' ? 'border-white/10 bg-black/20' : 'border-coach-orange/40 bg-coach-orange/10'}`}><strong>{result.mode === 'run' ? 'Resultado da execução' : 'Resultado do envio'}</strong><p className="mt-1 text-coach-muted">{executionMessage(result)}</p>{result.mode === 'submit' && result.cases.length > 0 && <p className="mt-2 text-xs text-coach-muted">{result.cases.filter((item) => item.passed).length}/{result.cases.length} resultados de teste aprovados</p>}{result.stdout && <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap rounded bg-black/25 p-3 text-xs">{result.stdout}</pre>}{result.stderr && <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap rounded bg-black/25 p-3 text-xs text-red-200">{result.stderr}</pre>}{result.passed && nextExercise && <button type="button" onClick={() => selectExercise(nextExercise)} className="mt-4 rounded-lg bg-coach-green px-4 py-2 text-xs font-black text-white">Próximo exercício</button>}{result.passed && !nextExercise && <p className="mt-3 text-xs font-black text-coach-green">Todos os exercícios disponíveis deste tópico foram percorridos.</p>}</div>}</section></div>}
    </main>
  </div>
}
