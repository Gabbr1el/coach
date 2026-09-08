import { useCallback, useEffect, useRef, useState } from 'react'
import type { Roadmap, RoadmapModule } from '../../shared/contracts/roadmap-contract'
import type { PersistedStudyLesson, StudyCheckpointEvaluation, StudyLessonAdaptation, StudyLessonBlock } from '../../shared/contracts/study-lesson-contract'
import type { StudyCheckpointState, StudyLessonPosition, StudyProgressState } from '../../shared/contracts/study-progress-contract'

const labels: Record<StudyLessonBlock['type'], string> = { explanation: 'Explicação', codeExample: 'Exemplo de código', analogy: 'Analogia', warning: 'Atenção', commonError: 'Erro comum', comparison: 'Comparação', checkpoint: 'Verificação', miniExercise: 'Prática' }
const reviewTypes = new Set<StudyLessonBlock['type']>(['commonError', 'warning', 'comparison', 'checkpoint', 'miniExercise'])
const blockStyles: Record<StudyLessonBlock['type'], string> = {
  explanation: 'border-coach-line bg-[#111217]',
  codeExample: 'border-[#315b4f] bg-[#0d1715]',
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
}

function stageFor(block: StudyLessonBlock): StudyLessonPosition['currentStage'] {
  if (block.type === 'checkpoint') return 'verification'
  if (block.type === 'miniExercise') return 'exercise'
  if (block.type === 'codeExample') return 'example'
  return 'explanation'
}

export function StudyLessonView({ workspaceId, roadmap, module, lesson, progress, reviewMode, onPosition, onCheckpoint, onLessonChanged, onComplete, onPractice }: Props) {
  const [checkpointStates, setCheckpointStates] = useState<Record<string, StudyCheckpointState>>(progress.checkpointStates ?? {})
  const [adaptations, setAdaptations] = useState<Record<string, StudyLessonAdaptation[]>>({})
  const [displayedBlocks, setDisplayedBlocks] = useState(lesson.blocks)
  const [adaptationBusy, setAdaptationBusy] = useState<string | null>(null)
  const scrollPaneRef = useRef<HTMLElement | null>(null)
  const blockRefs = useRef(new Map<string, HTMLElement>())
  const visibility = useRef(new Map<string, number>())
  const restoredLessonIds = useRef(new Set<string>())
  const positionTimer = useRef<number | null>(null)
  const pendingBlock = useRef<StudyLessonBlock | null>(null)
  const checkpointStatesRef = useRef(checkpointStates)
  const positionRef = useRef(progress.currentPosition)
  const topic = module.topics.find((item) => `${module.id}:${item}` === progress.topicId) ?? module.title
  const checkpoints = displayedBlocks.reduce<Array<Extract<StudyLessonBlock, { type: 'checkpoint' }>>>((items, block) => block.type === 'checkpoint' ? [...items, block] : items, [])
  const canComplete = checkpoints.length > 0 && checkpoints.every((block) => checkpointStates[block.id]?.correct === true)

  useEffect(() => { checkpointStatesRef.current = checkpointStates }, [checkpointStates])
  useEffect(() => { positionRef.current = progress.currentPosition }, [progress.currentPosition])
  useEffect(() => { setCheckpointStates(progress.checkpointStates ?? {}) }, [lesson.id, progress.checkpointStates])
  useEffect(() => {
    setDisplayedBlocks(lesson.blocks)
    let cancelled = false
    void Promise.all(lesson.blocks.map(async (block) => [block.id, await window.coach.studyLesson.listAdaptations({ workspaceId, lessonId: lesson.id, blockId: block.id })] as const)).then((entries) => { if (!cancelled) setAdaptations(Object.fromEntries(entries)) })
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
      selectedAnswer: checkpoint?.selectedAnswer ?? null,
      attempt: checkpoint?.attempt ?? 0,
      feedback: checkpoint?.feedback ?? null,
      reinforcementBlocks: checkpoint?.reinforcementBlocks ?? [],
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

  async function answer(checkpoint: Extract<StudyLessonBlock, { type: 'checkpoint' }>, selectedAnswer: number) {
    const previous = checkpointStatesRef.current[checkpoint.id]
    const attempt = (previous?.attempt ?? 0) + 1
    const evaluation = await window.coach.studyLesson.evaluate({ workspaceId, roadmapId: roadmap.id, moduleId: module.id, topicId: progress.topicId, lessonId: lesson.id, checkpointId: checkpoint.id, selectedIndex: selectedAnswer, attempt })
    const reinforcementBlocks = evaluation.reinforcement ? [...(previous?.reinforcementBlocks ?? []), evaluation.reinforcement] : previous?.reinforcementBlocks ?? []
    const state: StudyCheckpointState = { selectedAnswer, attempt, correct: evaluation.correct, feedback: evaluation.feedback, reinforcementBlocks }
    const nextStates = { ...checkpointStatesRef.current, [checkpoint.id]: state }
    checkpointStatesRef.current = nextStates
    setCheckpointStates(nextStates)
    const position = positionFor(checkpoint, nextStates)
    positionRef.current = position
    onPosition(position, nextStates)
    onCheckpoint(checkpoint.id, evaluation, selectedAnswer, attempt)
  }

  function openPractice(block: Extract<StudyLessonBlock, { type: 'miniExercise' }>) {
    const position = positionFor(block)
    positionRef.current = position
    onPosition(position, checkpointStatesRef.current)
    onPractice()
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
            {block.type === 'checkpoint' && <>
              <p className="mt-4 text-sm leading-6 text-coach-muted">{block.question}</p>
              <div className="mt-4 grid gap-2">{block.options.map((option, index) => <button key={`${block.id}:${index}`} type="button" onClick={() => void answer(block, index)} className={`rounded-lg border p-3 text-left text-xs transition ${state?.selectedAnswer === index ? state.correct ? 'border-coach-green bg-coach-green/10' : 'border-coach-orange bg-coach-orange/10' : 'border-coach-line hover:border-coach-orange/60'}`}>{String.fromCharCode(65 + index)}. {option}</button>)}</div>
              {state?.feedback && <div className={`mt-4 rounded-lg border p-4 text-sm leading-6 ${state.correct ? 'border-coach-green/40 bg-coach-green/10' : 'border-coach-orange/40 bg-coach-orange/10'}`}><strong>{state.correct ? 'Compreensão confirmada' : `Tentativa ${state.attempt}`}</strong><p className="mt-1 text-coach-muted">{state.feedback}</p>{!state.correct && <p className="mt-2 text-xs text-coach-muted">Dica: {block.hint}</p>}</div>}
              {state?.reinforcementBlocks.map((reinforcement, index) => <div key={`${block.id}:reinforcement:${index}`} role="note" className="mt-3 rounded-lg border-l-4 border-coach-yellow bg-coach-yellow/[.08] p-4 text-sm leading-6"><strong className="text-coach-yellow">Reforço</strong><p className="mt-1 text-coach-muted">{reinforcement}</p></div>)}
            </>}
            {block.type === 'miniExercise' && <><p className="mt-4 text-sm leading-7 text-coach-muted">{block.instruction}</p><button type="button" onClick={() => openPractice(block)} className="mt-4 rounded-xl bg-coach-green px-5 py-3 text-xs font-black text-white">Abrir Prática</button></>}
          </section>
        })}
      </div>

      <footer className="mt-8 rounded-xl border border-coach-line bg-[#111217] p-5">
        {canComplete ? <div className="flex flex-wrap items-center justify-between gap-4"><p className="text-sm text-coach-muted">Todos os checkpoints foram respondidos corretamente.</p><button type="button" onClick={onComplete} className="rounded-xl bg-coach-orange px-5 py-3 text-sm font-black text-white">Concluir tópico</button></div> : <p className="text-sm text-coach-muted">Responda corretamente {checkpoints.length === 0 ? 'ao menos um checkpoint para habilitar a conclusão' : `os ${checkpoints.length} checkpoints para concluir o tópico`}.</p>}
      </footer>
      {lesson.sources.length > 0 && <footer className="mt-5 border-t border-coach-line pt-6"><p className="text-[10px] font-black uppercase tracking-[.16em] text-coach-muted">Fontes consultadas</p><div className="mt-3 flex flex-wrap gap-2">{lesson.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="rounded-lg border border-coach-line px-3 py-2 text-xs font-bold text-coach-green hover:bg-white/[.03]">{source.title}</a>)}</div></footer>}
    </div>
  </article>
}
