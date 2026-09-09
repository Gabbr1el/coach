import { useCallback, useEffect, useRef, useState } from 'react'
import type { Roadmap, RoadmapModule } from '../../shared/contracts/roadmap-contract'
import type { PersistedStudyLesson, StudyCheckpointEvaluation, StudyLessonAdaptation, StudyLessonBlock } from '../../shared/contracts/study-lesson-contract'
import type { StudyCheckpointState, StudyLessonPosition, StudyProgressState } from '../../shared/contracts/study-progress-contract'
import type { InteractiveCodeBlock, InteractiveCodeState } from '../../shared/contracts/code-execution-contract'
import type { ExerciseSet } from '../../shared/contracts/exercise-contract'
import { EmbeddedCodeEditor } from './EmbeddedCodeEditor'
import { interactiveSourceRevision } from '../../shared/interactive-source-revision'

const labels: Record<StudyLessonBlock['type'], string> = { explanation: 'Explicação', codeExample: 'Exemplo de código', interactiveCode: 'Laboratório inline', analogy: 'Analogia', warning: 'Atenção', commonError: 'Erro comum', comparison: 'Comparação', checkpoint: 'Verificação', miniExercise: 'Prática' }
const reviewTypes = new Set<StudyLessonBlock['type']>(['commonError', 'warning', 'comparison', 'interactiveCode', 'checkpoint', 'miniExercise'])
const blockStyles: Record<StudyLessonBlock['type'], string> = {
  explanation: 'border-coach-line bg-[#111217]',
  codeExample: 'border-[#315b4f] bg-[#0d1715]',
  interactiveCode: 'border-[#3b7767] bg-[#0a1714]',
  analogy: 'border-[#49406a] bg-[#181622]',
  warning: 'border-coach-yellow/60 bg-coach-yellow/[.06]',
  commonError: 'border-red-400/40 bg-red-500/[.06]',
  comparison: 'border-sky-400/35 bg-sky-500/[.05]',
  checkpoint: 'border-coach-orange/55 bg-coach-orange/[.06]',
  miniExercise: 'border-coach-green/50 bg-coach-green/[.06]',
}

export function studyLessonBlockExcerpt(block: StudyLessonBlock | undefined): string | null {
  if (!block) return null
  if ('content' in block) return block.content
  if (block.type === 'codeExample') return block.code
  if (block.type === 'interactiveCode') return block.instruction
  if (block.type === 'checkpoint') return block.question
  return block.instruction
}

type Props = {
  workspaceId: string
  roadmap: Roadmap
  module: RoadmapModule
  lesson: PersistedStudyLesson
  progress: StudyProgressState
  reviewMode?: boolean
  onPosition(position: StudyLessonPosition, checkpointStates: Record<string, StudyCheckpointState>): void
  onCheckpoint(checkpointId: string, evaluation: StudyCheckpointEvaluation, selectedAnswer: number, attempt: number): void
  onLessonChanged(lesson: PersistedStudyLesson): void
  onComplete(): void
  onPractice(): void
  onExercises(): void
  onInteractiveContext(block: InteractiveCodeBlock, state: InteractiveCodeState): void
}

function stageFor(block: StudyLessonBlock): StudyLessonPosition['currentStage'] {
  if (block.type === 'checkpoint') return 'verification'
  if (block.type === 'miniExercise') return 'exercise'
  if (block.type === 'codeExample' || block.type === 'interactiveCode') return 'example'
  return 'explanation'
}

export function StudyLessonView({ workspaceId, roadmap, module, lesson, progress, reviewMode, onPosition, onCheckpoint, onLessonChanged, onComplete, onPractice, onExercises, onInteractiveContext }: Props) {
  const [checkpointStates, setCheckpointStates] = useState<Record<string, StudyCheckpointState>>(progress.checkpointStates ?? {})
  const [adaptations, setAdaptations] = useState<Record<string, StudyLessonAdaptation[]>>({})
  const [displayedBlocks, setDisplayedBlocks] = useState(lesson.blocks)
  const [adaptationBusy, setAdaptationBusy] = useState<string | null>(null)
  const [answeringCheckpointId, setAnsweringCheckpointId] = useState<string | null>(null)
  const [checkpointDrafts, setCheckpointDrafts] = useState<Record<string, { optionId: string | null; justification: string }>>({})
  const [interactiveStates, setInteractiveStates] = useState<Record<string, InteractiveCodeState>>({})
  const [interactiveBusy, setInteractiveBusy] = useState<string | null>(null)
  const [exerciseSet, setExerciseSet] = useState<ExerciseSet | null>(null)
  const scrollPaneRef = useRef<HTMLElement | null>(null)
  const blockRefs = useRef(new Map<string, HTMLElement>())
  const visibility = useRef(new Map<string, number>())
  const restoredLessonIds = useRef(new Set<string>())
  const positionTimer = useRef<number | null>(null)
  const pendingBlock = useRef<StudyLessonBlock | null>(null)
  const checkpointStatesRef = useRef(checkpointStates)
  const interactiveStatesRef = useRef(interactiveStates)
  const interactiveSaveTimers = useRef<Record<string, number>>({})
  const positionRef = useRef(progress.currentPosition)
  const topic = module.topics.find((item) => `${module.id}:${item}` === progress.topicId) ?? module.title
  const checkpoints = displayedBlocks.reduce<Array<Extract<StudyLessonBlock, { type: 'checkpoint' }>>>((items, block) => block.type === 'checkpoint' ? [...items, block] : items, [])
  const canComplete = checkpoints.length > 0 && checkpoints.every((block) => checkpointStates[block.id]?.correct === true)
  const requiredInteractive: InteractiveCodeBlock[] = []
  for (const block of lesson.blocks) if (block.type === 'interactiveCode' && block.requiredForTopicCompletion) requiredInteractive.push(block)
  const pendingRequiredInteractive: InteractiveCodeBlock[] = []
  for (const block of requiredInteractive) { const state = interactiveStates[block.id]; if (state?.applicable !== false && (state?.validationResult?.status !== 'passed' || state.validationResult.sourceRevision !== state.currentSourceRevision)) pendingRequiredInteractive.push(block) }
  const pendingRequiredExercises = exerciseSet?.status === 'ready' ? exerciseSet.exercises.filter((exercise) => exercise.requiredForTopicCompletion && exerciseSet.progress.find((item) => item.exerciseId === exercise.id)?.status !== 'passed') : []
  const canCompleteTopic = canComplete && pendingRequiredInteractive.length === 0 && pendingRequiredExercises.length === 0

  useEffect(() => { let current = true; void window.coach.exercise.getSet({ workspaceId, topicId: progress.topicId }).then((value) => { if (current) setExerciseSet(value) }); return () => { current = false } }, [workspaceId, progress.topicId])

  useEffect(() => { checkpointStatesRef.current = checkpointStates }, [checkpointStates])
  useEffect(() => { interactiveStatesRef.current = interactiveStates }, [interactiveStates])
  useEffect(() => { positionRef.current = progress.currentPosition }, [progress.currentPosition])
  useEffect(() => { setCheckpointStates(progress.checkpointStates ?? {}) }, [lesson.id, progress.checkpointStates])
  useEffect(() => {
    setDisplayedBlocks(lesson.blocks)
    let cancelled = false
    void Promise.all(lesson.blocks.map(async (block) => [block.id, await window.coach.studyLesson.listAdaptations({ workspaceId, lessonId: lesson.id, blockId: block.id })] as const)).then((entries) => { if (!cancelled) setAdaptations(Object.fromEntries(entries)) })
    return () => { cancelled = true }
  }, [workspaceId, lesson.id, lesson.blocks])
  useEffect(() => {
    let cancelled = false
    void window.coach.codeExecution.listInteractiveStates({ workspaceId, lessonId: lesson.id }).then((states) => {
      if (cancelled) return
      const persisted = Object.fromEntries(states.map((state) => [state.blockId, state]))
      const initial: Record<string, InteractiveCodeState> = {}
      for (const block of lesson.blocks) if (block.type === 'interactiveCode') initial[block.id] = persisted[block.id] ?? { lessonId: lesson.id, blockId: block.id, currentCode: block.initialCode, prediction: null, currentSourceRevision: interactiveSourceRevision(block.initialCode, null), attempts: 0, lastExecution: null, validationResult: null, applicable: true, unavailableReason: null, updatedAt: 0 }
      setInteractiveStates(initial)
    })
    return () => { cancelled = true }
  }, [workspaceId, lesson.id, lesson.blocks])

  async function showOriginal(blockId: string) {
    setAdaptationBusy(blockId)
    try {
      const updated = await window.coach.studyLesson.restoreOriginal({ workspaceId, lessonId: lesson.id, blockId })
      setDisplayedBlocks(updated.blocks)
      onLessonChanged(updated)
      setAdaptations((current) => ({ ...current, [blockId]: (current[blockId] ?? []).map((item) => ({ ...item, isActive: false })) }))
    } finally { setAdaptationBusy(null) }
  }

  async function showAdapted(blockId: string) {
    const adaptation = adaptations[blockId]?.[0]
    if (!adaptation) return
    setAdaptationBusy(blockId)
    try {
      const updated = await window.coach.studyLesson.activateAdaptation({ workspaceId, lessonId: lesson.id, blockId, adaptationId: adaptation.id })
      setDisplayedBlocks(updated.blocks)
      onLessonChanged(updated)
      setAdaptations((current) => ({ ...current, [blockId]: (current[blockId] ?? []).map((item) => ({ ...item, isActive: item.id === adaptation.id })) }))
    } finally { setAdaptationBusy(null) }
  }

  const positionFor = useCallback((block: StudyLessonBlock, states = checkpointStatesRef.current): StudyLessonPosition => {
    const previous = positionRef.current
    const checkpoint = block.type === 'checkpoint' ? states[block.id] : undefined
    return {
      lessonId: lesson.id,
      currentBlockId: block.id,
      currentStage: checkpoint && !checkpoint.correct ? 'feedback' : stageFor(block),
      currentCheckpointId: block.type === 'checkpoint' ? block.id : previous?.currentCheckpointId ?? null,
      currentExerciseId: block.type === 'miniExercise' ? block.id : previous?.currentExerciseId ?? null,
      completedBlockIds: previous?.completedBlockIds ?? [],
      selectedAnswer: checkpoint && block.type === 'checkpoint' ? (() => { const index = block.options.findIndex((option) => option.id === checkpoint.selectedOptionId); return index >= 0 ? index : null })() : null,
      attempt: checkpoint?.attempt ?? 0,
      feedback: checkpoint?.currentFeedback ?? null,
      reinforcementBlocks: checkpoint?.currentReinforcement ? [checkpoint.currentReinforcement] : [],
    }
  }, [lesson.id])

  const reportDominantBlock = useCallback((block: StudyLessonBlock) => {
    pendingBlock.current = block
    if (positionTimer.current !== null) return
    positionTimer.current = window.setTimeout(() => {
      positionTimer.current = null
      const next = pendingBlock.current
      if (!next || positionRef.current?.currentBlockId === next.id) return
      const position = positionFor(next)
      positionRef.current = position
      onPosition(position, checkpointStatesRef.current)
    }, 250)
  }, [onPosition, positionFor])

  useEffect(() => {
    const root = scrollPaneRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) visibility.current.set((entry.target as HTMLElement).dataset.blockId ?? '', entry.intersectionRatio)
      const dominant = displayedBlocks.reduce<StudyLessonBlock | null>((best, block) => !best || (visibility.current.get(block.id) ?? 0) > (visibility.current.get(best.id) ?? 0) ? block : best, null)
      if (dominant && (visibility.current.get(dominant.id) ?? 0) > 0) reportDominantBlock(dominant)
    }, { root, threshold: [0, 0.25, 0.5, 0.75, 1] })
    for (const element of blockRefs.current.values()) observer.observe(element)
    return () => observer.disconnect()
  }, [lesson.id, displayedBlocks, reportDominantBlock])

  useEffect(() => {
    if (restoredLessonIds.current.has(lesson.id)) return
    restoredLessonIds.current.add(lesson.id)
    const target = progress.currentPosition?.lessonId === lesson.id ? blockRefs.current.get(progress.currentPosition.currentBlockId) : null
    if (!target) return
    const frame = window.requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }))
    return () => window.cancelAnimationFrame(frame)
  }, [lesson.id, progress.currentPosition])

  useEffect(() => () => { if (positionTimer.current !== null) window.clearTimeout(positionTimer.current) }, [])
  useEffect(() => () => {
    for (const timer of Object.values(interactiveSaveTimers.current)) window.clearTimeout(timer)
    for (const block of lesson.blocks) {
      if (block.type !== 'interactiveCode') continue
      const state = interactiveStatesRef.current[block.id]
      if (state) void window.coach.codeExecution.saveInteractiveState({ workspaceId, lessonId: lesson.id, blockId: block.id, currentCode: state.currentCode, prediction: state.prediction, previousSourceRevision: state.currentSourceRevision })
    }
  }, [workspaceId, lesson.id, lesson.blocks])

  function updateInteractiveDraft(block: InteractiveCodeBlock, state: InteractiveCodeState) {
    interactiveStatesRef.current = { ...interactiveStatesRef.current, [block.id]: state }
    setInteractiveStates(interactiveStatesRef.current)
    onInteractiveContext(block, state)
    if (interactiveSaveTimers.current[block.id]) window.clearTimeout(interactiveSaveTimers.current[block.id])
    interactiveSaveTimers.current[block.id] = window.setTimeout(() => {
      void window.coach.codeExecution.saveInteractiveState({ workspaceId, lessonId: lesson.id, blockId: block.id, currentCode: state.currentCode, prediction: state.prediction, previousSourceRevision: state.currentSourceRevision })
    }, 350)
  }

  async function answer(checkpoint: Extract<StudyLessonBlock, { type: 'checkpoint' }>) {
    const draft = checkpointDrafts[checkpoint.id]
    if (answeringCheckpointId || !draft?.optionId || draft.justification.trim().length < 3) return
    setAnsweringCheckpointId(checkpoint.id)
    const result = await window.coach.studyProgress.answerCheckpoint({ workspaceId, lessonId: lesson.id, checkpointId: checkpoint.id, selectedOptionId: draft.optionId, studentJustification: draft.justification }).finally(() => setAnsweringCheckpointId(null))
    const nextStates = result.state.checkpointStates ?? {}
    checkpointStatesRef.current = nextStates
    setCheckpointStates(nextStates)
    const position = positionFor(checkpoint, nextStates)
    positionRef.current = position
    onPosition(position, nextStates)
    onCheckpoint(checkpoint.id, result.evaluation, checkpoint.options.findIndex((option) => option.id === draft.optionId), result.evaluation.attempt)
  }

  function openPractice(block: Extract<StudyLessonBlock, { type: 'miniExercise' }>) {
    const position = positionFor(block)
    positionRef.current = position
    onPosition(position, checkpointStatesRef.current)
    onPractice()
  }

  async function executeInteractive(block: InteractiveCodeBlock) {
    const current = interactiveStates[block.id] ?? { lessonId: lesson.id, blockId: block.id, currentCode: block.initialCode, prediction: null, currentSourceRevision: interactiveSourceRevision(block.initialCode, null), attempts: 0, lastExecution: null, validationResult: null, applicable: true, unavailableReason: null, updatedAt: 0 }
    if (interactiveBusy || (block.interactionType === 'PREDICT_AND_RUN' && !current.prediction?.trim())) return
    setInteractiveBusy(block.id)
    try {
      const state = await window.coach.codeExecution.executeInteractive({ workspaceId, lessonId: lesson.id, blockId: block.id, currentCode: current.currentCode, prediction: current.prediction })
      setInteractiveStates((values) => ({ ...values, [block.id]: state }))
      onInteractiveContext(block, state)
    } finally { setInteractiveBusy(null) }
  }

  return <article ref={scrollPaneRef} className="coach-scroll-pane h-full px-5 py-7 lg:px-12">
    <div className="mx-auto max-w-4xl pb-16">
      <header className="border-b border-coach-line pb-7">
        <p className="text-[10px] font-black uppercase tracking-[.18em] text-coach-green">{lesson.level} · {topic}</p>
        <h2 className="mt-2 font-display text-3xl font-black">{lesson.title}</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-coach-muted">{lesson.objective}</p>
        {reviewMode && <p className="mt-4 inline-flex rounded-full border border-coach-orange/40 bg-coach-orange/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-coach-orange">Modo revisão · pontos-chave destacados</p>}
      </header>

      <div className="mt-7 space-y-5">
        {displayedBlocks.map((block, displayIndex) => {
          const state = block.type === 'checkpoint' ? checkpointStates[block.id] : undefined
          const highlighted = reviewMode && reviewTypes.has(block.type)
          const history = adaptations[block.id] ?? []
          const activeAdaptation = history.find((item) => item.isActive)
          return <section
            key={block.id}
            ref={(element) => { if (element) blockRefs.current.set(block.id, element); else blockRefs.current.delete(block.id) }}
            data-block-id={block.id}
            data-block-type={block.type}
            className={`rounded-xl border p-5 shadow-soft sm:p-6 ${blockStyles[block.type]} ${highlighted ? 'ring-1 ring-coach-orange/60' : ''}`}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2"><p className="text-[10px] font-black uppercase tracking-[.16em] text-coach-orange">{labels[block.type]}</p>{activeAdaptation && <span className="rounded-full border border-coach-green/40 bg-coach-green/10 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-coach-green">Adaptado para você</span>}</div>
              <span className="text-[10px] font-bold text-coach-muted">{String(displayIndex + 1).padStart(2, '0')}</span>
            </div>
            {history.length > 0 && <button type="button" disabled={adaptationBusy === block.id} onClick={() => void (activeAdaptation ? showOriginal(block.id) : showAdapted(block.id))} className="mt-3 text-xs font-black text-coach-green disabled:opacity-50">{activeAdaptation ? 'Ver original' : 'Voltar à versão adaptada'}</button>}
            <h3 className="mt-2 font-display text-xl font-black">{block.title}</h3>
            {'content' in block && <p className="mt-4 whitespace-pre-line text-sm leading-7 text-coach-muted">{block.content}</p>}
            {block.type === 'codeExample' && <>
              <pre className="mt-4 overflow-x-auto rounded-lg border border-white/5 bg-[#090a0d] p-4 text-xs leading-6"><code>{block.code}</code></pre>
              {block.expectedOutput && <div className="mt-3 rounded-lg border border-coach-line bg-black/10 p-3 text-xs"><strong>Saída esperada</strong><pre className="mt-2 whitespace-pre-wrap text-coach-muted">{block.expectedOutput}</pre></div>}
              <ol className="mt-4 space-y-2">{block.walkthrough.map((step, index) => <li key={`${block.id}:${index}`} className="text-sm leading-6 text-coach-muted"><strong className="mr-2 text-coach-green">{index + 1}.</strong>{step}</li>)}</ol>
            </>}
            {block.type === 'interactiveCode' && (() => {
              const interactive = interactiveStates[block.id] ?? { lessonId: lesson.id, blockId: block.id, currentCode: block.initialCode, prediction: null, currentSourceRevision: interactiveSourceRevision(block.initialCode, null), attempts: 0, lastExecution: null, validationResult: null, applicable: true, unavailableReason: null, updatedAt: 0 }
              const running = interactiveBusy === block.id
              return <div onFocus={() => onInteractiveContext(block, interactive)}>
                <p className="mt-4 text-sm leading-7 text-coach-muted">{block.instruction}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wider"><span className="rounded-full border border-coach-green/30 px-2 py-1 text-coach-green">{block.language}</span><span className="rounded-full border border-white/10 px-2 py-1 text-white/55">{block.interactionType.replaceAll('_', ' ')}</span><span className="rounded-full border border-white/10 px-2 py-1 text-white/55">Evidência: {block.evidenceMode}</span>{block.requiredForTopicCompletion && <span className="rounded-full border border-coach-orange/30 px-2 py-1 text-coach-orange">Necessário para concluir este tópico</span>}</div>
                {block.predictionPrompt && <label className="mt-4 block text-xs font-black uppercase text-coach-muted">{block.predictionPrompt}<textarea value={interactive.prediction ?? ''} disabled={running} onChange={(event) => { const prediction = event.target.value; updateInteractiveDraft(block, { ...interactive, prediction, currentSourceRevision: interactiveSourceRevision(interactive.currentCode, prediction) }) }} className="mt-2 min-h-16 w-full rounded-lg border border-coach-line bg-[#0b0c10] p-3 text-sm font-normal normal-case text-coach-ink" /></label>}
                <div className="mt-4 h-64 overflow-hidden rounded-lg border border-white/10 bg-[#060a09]"><EmbeddedCodeEditor value={interactive.currentCode} language={block.language} path={block.language === 'java' ? `${block.id}.Main.java` : `${block.id}.${block.language === 'python' ? 'py' : 'c'}`} disabled={running || !interactive.applicable} maxLength={20_000} onChange={(currentCode) => updateInteractiveDraft(block, { ...interactive, currentCode, currentSourceRevision: interactiveSourceRevision(currentCode, interactive.prediction) })} /></div>
                {!interactive.applicable && <p className="mt-3 rounded-lg border border-coach-orange/40 bg-coach-orange/10 p-3 text-xs font-bold text-coach-orange">Ambiente {block.language} não disponível neste computador.</p>}
                <div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-coach-muted">{interactive.attempts ? `${interactive.attempts} execução(ões) persistida(s)` : 'Ainda não executado'}</p><button type="button" disabled={running || !interactive.applicable || (block.interactionType === 'PREDICT_AND_RUN' && !interactive.prediction?.trim())} onClick={() => void executeInteractive(block)} className="rounded-lg bg-coach-green px-4 py-2 text-xs font-black text-white disabled:opacity-50">{running ? 'Executando...' : 'Executar aqui'}</button></div>
                {interactive.lastExecution && <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-white/10 bg-black/20 p-3"><strong className="text-xs">Saída</strong><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-coach-muted">{interactive.lastExecution.stdout || '(sem saída)'}</pre></div><div className="rounded-lg border border-white/10 bg-black/20 p-3"><strong className="text-xs">Erros · {interactive.lastExecution.phase ?? 'run'} · exit {interactive.lastExecution.exitCode ?? 'null'}</strong><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-red-200/75">{interactive.lastExecution.stderr || '(sem erros)'}</pre></div></div>}
                {interactive.validationResult?.predictionCorrect !== null && interactive.validationResult?.predictionCorrect !== undefined && <p className="mt-3 text-xs text-coach-muted">Previsão {interactive.validationResult.predictionCorrect ? 'correta' : 'diferente da saída real'}.</p>}
                {interactive.validationResult && <p className={`mt-3 rounded-lg border p-3 text-xs font-bold ${interactive.validationResult.status === 'passed' ? 'border-coach-green/40 bg-coach-green/10 text-coach-green' : interactive.validationResult.status === 'failed' || interactive.validationResult.status === 'stale' ? 'border-coach-orange/40 bg-coach-orange/10 text-coach-orange' : 'border-white/10 text-coach-muted'}`}>{interactive.validationResult.status === 'passed' ? '✓ Experimento concluído.' : interactive.validationResult.message}</p>}
              </div>
            })()}
            {block.type === 'checkpoint' && <>
              <p className="mt-4 text-sm leading-6 text-coach-muted">{block.question}</p>
              <div className="mt-4 grid gap-2">{block.options.map((option, index) => { const selected = (checkpointDrafts[block.id]?.optionId ?? state?.selectedOptionId) === option.id; return <button key={option.id} type="button" disabled={answeringCheckpointId === block.id} onClick={() => setCheckpointDrafts((current) => ({ ...current, [block.id]: { optionId: option.id, justification: current[block.id]?.justification ?? '' } }))} className={`rounded-lg border p-3 text-left text-xs transition disabled:opacity-60 ${selected ? 'border-coach-orange bg-coach-orange/10' : 'border-coach-line hover:border-coach-orange/60'}`}>{String.fromCharCode(65 + index)}. {option.text}</button> })}</div>
              <label className="mt-4 block text-xs font-black uppercase text-coach-muted">Por que você escolheu essa alternativa?<textarea value={checkpointDrafts[block.id]?.justification ?? ''} disabled={answeringCheckpointId === block.id} onChange={(event) => setCheckpointDrafts((current) => ({ ...current, [block.id]: { optionId: current[block.id]?.optionId ?? null, justification: event.target.value } }))} className="mt-2 min-h-20 w-full rounded-lg border border-coach-line bg-[#0b0c10] p-3 text-sm font-normal normal-case text-coach-ink" /></label>
              <button type="button" disabled={answeringCheckpointId === block.id || !checkpointDrafts[block.id]?.optionId || (checkpointDrafts[block.id]?.justification.trim().length ?? 0) < 3} onClick={() => void answer(block)} className="mt-3 rounded-lg bg-coach-orange px-4 py-2 text-xs font-black text-white disabled:opacity-50">{answeringCheckpointId === block.id ? 'Avaliando...' : 'Responder'}</button>
              {state?.currentFeedback && <div className={`mt-4 rounded-lg border p-4 text-sm leading-6 ${state.correct ? 'border-coach-green/40 bg-coach-green/10' : 'border-coach-orange/40 bg-coach-orange/10'}`}><strong>Sua resposta: {String.fromCharCode(65 + Math.max(0, block.options.findIndex((option) => option.id === state.selectedOptionId)))}</strong><p className="mt-1 font-bold">{state.correct ? 'Correto' : `Incorreto · tentativa ${state.attempt}`}</p><p className="mt-2 text-coach-muted">Por quê: {state.rationale}</p><p className="mt-2 text-coach-muted">{state.currentFeedback}</p>{!state.correct && <p className="mt-2 text-xs text-coach-muted">Orientação: {block.hint}</p>}</div>}
              {state?.currentReinforcement && <div role="note" className="mt-3 rounded-lg border-l-4 border-coach-yellow bg-coach-yellow/[.08] p-4 text-sm leading-6"><strong className="text-coach-yellow">Reforço</strong><p className="mt-1 text-coach-muted">{state.currentReinforcement}</p></div>}
            </>}
            {block.type === 'miniExercise' && <><p className="mt-4 text-sm leading-7 text-coach-muted">{block.instruction}</p><button type="button" onClick={() => openPractice(block)} className="mt-4 rounded-xl bg-coach-green px-5 py-3 text-xs font-black text-white">Abrir Prática</button></>}
          </section>
        })}
      </div>

      <footer className="mt-8 rounded-xl border border-coach-line bg-[#111217] p-5">
        {canCompleteTopic ? <div className="flex flex-wrap items-center justify-between gap-4"><p className="text-sm text-coach-muted">Verificações e práticas obrigatórias concluídas.</p><button type="button" onClick={onComplete} className="rounded-xl bg-coach-orange px-5 py-3 text-sm font-black text-white">Concluir tópico</button></div> : canComplete && pendingRequiredInteractive.length > 0 ? <p className="text-sm text-coach-muted">Verificações concluídas. Falta validar {pendingRequiredInteractive.length} experimento{pendingRequiredInteractive.length === 1 ? '' : 's'} obrigatório{pendingRequiredInteractive.length === 1 ? '' : 's'}.</p> : canComplete && pendingRequiredExercises.length > 0 ? <div className="flex flex-wrap items-center justify-between gap-4"><p className="text-sm text-coach-muted">Parte teórica concluída. Faltam {pendingRequiredExercises.length} exercício{pendingRequiredExercises.length === 1 ? '' : 's'} obrigatório{pendingRequiredExercises.length === 1 ? '' : 's'}.</p><button type="button" onClick={onExercises} className="rounded-xl bg-coach-green px-5 py-3 text-xs font-black text-white">Praticar agora</button></div> : <p className="text-sm text-coach-muted">Responda corretamente {checkpoints.length === 0 ? 'ao menos um checkpoint para habilitar a conclusão' : `os ${checkpoints.length} checkpoints para concluir o tópico`}.</p>}
      </footer>
      <section className="mt-5 rounded-xl border border-coach-green/35 bg-coach-green/[.06] p-5">
        <p className="text-[10px] font-black uppercase tracking-[.16em] text-coach-green">Prática do tópico</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4"><div><h3 className="font-display text-xl font-black">Resolva exercícios avaliativos</h3><p className="mt-1 text-sm text-coach-muted">Abra o conjunto ligado a {topic}. Os testes estruturados são separados da Prática livre.</p></div><button type="button" onClick={onExercises} className="rounded-xl bg-coach-green px-5 py-3 text-xs font-black text-white">Praticar este tópico</button></div>
      </section>
      {lesson.sources.length > 0 && <footer className="mt-5 border-t border-coach-line pt-6"><p className="text-[10px] font-black uppercase tracking-[.16em] text-coach-muted">Fontes consultadas</p><div className="mt-3 flex flex-wrap gap-2">{lesson.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="rounded-lg border border-coach-line px-3 py-2 text-xs font-bold text-coach-green hover:bg-white/[.03]">{source.title}</a>)}</div></footer>}
    </div>
  </article>
}
