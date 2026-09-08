import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ROADMAP_CHANNELS } from '../../src/shared/contracts/roadmap-channels'

const appSource = readFileSync(new URL('../../src/renderer/app/App.tsx', import.meta.url), 'utf8')
const drawerSource = readFileSync(new URL('../../src/renderer/app/LearningPathDrawer.tsx', import.meta.url), 'utf8')
const lessonSource = readFileSync(new URL('../../src/renderer/app/StudyLessonView.tsx', import.meta.url), 'utf8')

describe('learning path UI integration', () => {
  it('exposes a read-only lifecycle channel and never polls generation', () => {
    expect(ROADMAP_CHANNELS.getLearningPathState).toBe('roadmap:get-learning-path-state')
    expect(appSource).toContain('window.coach.roadmap.getLearningPathState(workspaceId)')
    expect(appSource).not.toContain('window.coach.roadmap.generate')
    expect(appSource).toContain("const interval = window.setInterval(() => void poll(), 2500)")
    expect(appSource).toContain('window.clearInterval(interval)')
  })

  it('keeps the canonical module and topic identifier through selection', () => {
    expect(appSource).toContain('const topicId = `${module.id}:${topic}`')
    expect(appSource).toContain('studyLesson.getOrCreate({ workspaceId: selected.id, roadmapId: roadmap.id, moduleId: module.id, topicId })')
    expect(appSource).toContain("if (lessonLoad.status !== 'ready')")
    expect(appSource).toContain('studyProgress.select({ workspaceId: selected.id, roadmapId: roadmap.id, moduleId: module.id, topicId, lessonId: lessonLoad.lesson.id')
    expect(drawerSource).toContain('const topicId = `${module.id}:${topic}`')
  })

  it('contains the drawer in Studies and removes the permanent curriculum sidebar', () => {
    expect(appSource).toContain('relative flex h-full min-h-0 flex-col overflow-hidden')
    expect(drawerSource).toContain('absolute inset-0')
    expect(drawerSource).not.toContain('fixed inset-0')
    expect(drawerSource).toContain('aria-labelledby="learning-path-title"')
    expect(drawerSource).toContain("event.key === 'Escape'")
    expect(lessonSource).not.toContain('<aside')
    expect(lessonSource).not.toContain('Voltar ao plano')
    expect(lessonSource).not.toContain('Roteiro')
  })

  it('shows lifecycle-specific empty states without manual actions', () => {
    expect(appSource).toContain('Preparando sua Trilha de Aprendizado…')
    expect(appSource).toContain('A Trilha será preparada quando a IA estiver disponível.')
    expect(appSource).toContain('Não foi possível concluir a Trilha agora. O Coach tentará novamente automaticamente.')
    expect(appSource).not.toContain('Gere ou aceite')
  })

  it('renders a continuous knowledge page and persists independent checkpoints', () => {
    expect(lessonSource).toContain('lesson.blocks.map')
    expect(lessonSource).toContain('new IntersectionObserver')
    expect(lessonSource).toContain('checkpointStatesRef.current')
    expect(lessonSource).toContain('onPosition(position, nextStates)')
    expect(lessonSource).toContain('Concluir tópico')
    expect(lessonSource).not.toContain('blockIndex')
    expect(lessonSource).not.toContain('completedBlockIds: [...')
    expect(appSource).toContain('checkpointStates }).then(setStudyProgress)')
  })

  it('keeps review mode non-destructive and Practice non-completing', () => {
    expect(lessonSource).toContain('lesson.blocks.map')
    expect(lessonSource).not.toContain('lesson.blocks.filter')
    expect(lessonSource).toContain('reviewMode && reviewTypes.has(block.type)')
    expect(lessonSource).toContain('currentExerciseId: block.type === \'miniExercise\' ? block.id')
    expect(appSource).toContain("onPractice={() => setWorkspacePage('practice')}")
    expect(appSource).not.toContain('onComplete={(exerciseCompleted)')
  })
})
