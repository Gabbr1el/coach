import { useEffect, useState } from 'react'
import { BookOpen, ChevronDown, ChevronRight, X } from 'lucide-react'
import type { Roadmap, RoadmapModule } from '../../shared/contracts/roadmap-contract'
import type { StudyProgressState } from '../../shared/contracts/study-progress-contract'
import { curriculumStateLabel, projectCurriculum } from './curriculum-projection'
import { useDialogFocus } from './dialog-focus'

type Props = {
  open: boolean
  roadmap: Roadmap
  progress: StudyProgressState | null
  reviewTopicIds?: readonly string[]
  onClose(): void
  onSelect(module: RoadmapModule, topicIndex: number): Promise<void> | void
}

export function LearningPathDrawer({ open, roadmap, progress, reviewTopicIds = [], onClose, onSelect }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(roadmap.modules.map((module) => module.id)))
  const dialogRef = useDialogFocus<HTMLElement>(open, onClose, 'button[aria-label="Fechar"]')
  const projected = projectCurriculum(roadmap, progress)

  useEffect(() => { if (open) setExpanded(new Set(roadmap.modules.map((module) => module.id))) }, [open, roadmap.id])

  if (!open) return null
  return <div className="absolute inset-0 z-30 overflow-hidden" role="presentation">
    <button aria-label="Fechar trilha" onClick={onClose} className="absolute inset-0 bg-black/60" />
    <aside ref={dialogRef} id="learning-path-drawer" role="dialog" aria-modal="true" aria-labelledby="learning-path-title" className="absolute inset-y-0 right-0 flex w-full max-w-[430px] flex-col border-l border-coach-line bg-[#0d0e12] shadow-2xl">
      <header className="flex items-start justify-between border-b border-coach-line px-5 py-5">
        <div><h2 id="learning-path-title" className="font-display text-xl font-black text-coach-ink">Estudos</h2><p className="mt-1 text-sm font-bold text-coach-green">{roadmap.title}</p></div>
        <button onClick={onClose} aria-label="Fechar" className="rounded-lg p-2 text-coach-muted hover:bg-white/5 hover:text-coach-ink"><X size={18} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {roadmap.modules.map((module, moduleIndex) => {
          const topics = projected.filter((item) => item.module.id === module.id)
          const complete = topics.every((item) => item.state === 'completed')
          const moduleState = complete ? 'completed' : module.id === progress?.moduleId ? 'in_progress' : module.status === 'locked' ? 'locked' : 'available'
          const isExpanded = expanded.has(module.id)
          return <section key={module.id} className="mb-3 overflow-hidden rounded-xl border border-coach-line bg-[#111217]">
            <button onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(module.id)) next.delete(module.id); else next.add(module.id); return next })} className="flex w-full items-center gap-3 px-4 py-4 text-left">
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black ${complete ? 'bg-coach-green text-[#07110d]' : moduleState === 'locked' ? 'bg-white/5 text-coach-muted' : 'bg-coach-green/15 text-coach-green'}`}>{moduleIndex + 1}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-black text-coach-ink">{module.title}</span><span className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-coach-muted">{curriculumStateLabel[moduleState]}</span></span>
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            {isExpanded && <div className="border-t border-coach-line px-3 py-2">{topics.map((item, topicIndex) => {
              const topic = item.topic
              const topicId = `${module.id}:${topic}`
              const disabled = item.state === 'locked'
              const current = item.state === 'current' || item.state === 'in_progress'
              return <button key={topicId} disabled={disabled} onClick={() => { void onSelect(module, topicIndex); onClose() }} className={`my-1 flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left ${current ? 'bg-coach-green/10 text-coach-green' : disabled ? 'cursor-not-allowed text-coach-muted/55' : 'text-coach-ink hover:bg-white/[.04]'}`}>
                <BookOpen size={15} className="shrink-0" /><span className="min-w-0 flex-1 text-sm font-bold">{topic}</span>
                {reviewTopicIds.includes(item.topicId) && <span className="rounded bg-coach-orange/15 px-2 py-1 text-[9px] font-black uppercase text-coach-orange">Revisar</span>}
                <span className="text-[10px] font-black uppercase tracking-wider">{curriculumStateLabel[item.state]}</span>
              </button>
            })}</div>}
          </section>
        })}
      </div>
    </aside>
  </div>
}
