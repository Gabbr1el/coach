import { describe, expect, it } from 'vitest'
import { academicEventPhase } from '../../src/application/planning/academic-time'
import { deriveDailyPlan } from '../../src/application/study-workspaces/daily-plan'
import type { Roadmap } from '../../src/shared/contracts/roadmap-contract'
import type { StudyProgressState } from '../../src/shared/contracts/study-progress-contract'

const now = new Date('2026-09-07T10:00:00').getTime()
const moduleId = '00000000-0000-4000-8000-000000000003'
const topic = (name: string) => `${moduleId}:${name}`
const roadmap: Roadmap = { id: crypto.randomUUID(), workspaceId: crypto.randomUUID(), title: 'C', status: 'accepted', version: 1, providerId: null, modelId: null, createdAt: now, updatedAt: now, modules: [{ id: moduleId, title: 'C', objective: 'Aprender C', estimatedMinutes: 240, position: 1, status: 'active', topics: ['Ponteiros', 'Structs', 'Arquivos'], outcomes: [], practice: 'Código C', completionCriteria: [], resources: [] }] }
const progress: StudyProgressState = { workspaceId: roadmap.workspaceId, roadmapId: roadmap.id, moduleId, topicId: topic('Ponteiros'), lessonId: 'lesson', checkpointId: null, topicStatuses: { [topic('Ponteiros')]: 'IN_PROGRESS' }, lessonPositions: {}, currentPosition: null, updatedAt: now }
const plan = (phase: 'upcoming' | 'near' | 'today' | 'passed' | null, availableMinutes: number) => deriveDailyPlan({ workspaceId: roadmap.workspaceId, roadmap, progress, availableMinutes, phase, difficultyTopicIds: new Set([topic('Ponteiros')]), startMinutes: 1080 }, [], () => crypto.randomUUID())

describe('live plan temporal adaptation', () => {
  it('classifies three days before, prior day, exam day and following day', () => { expect(academicEventPhase(now + 3 * 86_400_000, now)).toBe('near'); expect(academicEventPhase(now + 86_400_000, now)).toBe('near'); expect(academicEventPhase(now, now)).toBe('today'); expect(academicEventPhase(now - 86_400_000, now)).toBe('passed') })
  it('increases consolidation near the exam', () => { expect(plan('near', 90).every((item) => item.activityType !== 'introduction')).toBe(true) })
  it('uses only review and retrieval exercises on exam day', () => { const today = plan('today', 80); expect(today.every((item) => item.activityType === 'review' || item.activityType === 'exercise')).toBe(true); expect(today[0]?.topicId).toBe(topic('Ponteiros')) })
  it('respects exact daily availability', () => { expect(plan('near', 240).reduce((sum, item) => sum + item.durationMinutes, 0)).toBeLessThanOrEqual(240); expect(plan('near', 360).reduce((sum, item) => sum + item.durationMinutes, 0)).toBeLessThanOrEqual(360); expect(plan('today', 0)).toHaveLength(0) })
  it('preserves completed work while replanning the future', () => { const previous = plan('upcoming', 90); const completed = { ...previous[0]!, status: 'completed' as const }; const replanned = deriveDailyPlan({ workspaceId: roadmap.workspaceId, roadmap, progress, availableMinutes: 90, phase: 'today', difficultyTopicIds: new Set([topic('Ponteiros')]), startMinutes: 1080 }, [completed], () => crypto.randomUUID()); expect(replanned.some((item) => item.id === completed.id && item.status === 'completed')).toBe(true) })
})
