import { describe, expect, it } from 'vitest'
import { projectCurriculum } from '../../src/renderer/app/curriculum-projection'
import type { Roadmap } from '../../src/shared/contracts/roadmap-contract'

const roadmap = {
  id: 'roadmap', workspaceId: 'workspace', title: 'Estrutura de Dados', status: 'accepted', generationKind: 'ai_generated', version: 1, providerId: null, modelId: null, createdAt: 1, updatedAt: 1,
  modules: [
    { id: 'm1', title: 'Fundamentos', objective: 'Base', estimatedMinutes: 60, position: 1, status: 'active', topics: ['Vetores', 'Listas'], outcomes: [], practice: 'Praticar', completionCriteria: [], resources: [] },
    { id: 'm2', title: 'Arvores', objective: 'Avancar', estimatedMinutes: 60, position: 2, status: 'locked', topics: ['Busca', 'Balanceamento'], outcomes: [], practice: 'Praticar', completionCriteria: [], resources: [] },
  ],
} as Roadmap

describe('curriculum projection', () => {
  it('keeps accepted roadmap IDs and every future locked topic visible', () => {
    const items = projectCurriculum(roadmap, { workspaceId: 'workspace', roadmapId: 'roadmap', moduleId: 'm1', topicId: 'm1:Listas', lessonId: null, checkpointId: null, topicStatuses: { 'm1:Vetores': 'COMPLETED', 'm1:Listas': 'IN_PROGRESS' }, currentPosition: null, lessonPositions: {}, checkpointStates: {}, updatedAt: 1 })
    expect(items.map((item) => item.topicId)).toEqual(['m1:Vetores', 'm1:Listas', 'm2:Busca', 'm2:Balanceamento'])
    expect(items.map((item) => item.state)).toEqual(['completed', 'in_progress', 'locked', 'locked'])
  })

  it('projects explicit preparation instead of a dash for an available exercise topic', () => {
    const items = projectCurriculum(roadmap, null, { 'm1:Vetores': { topicId: 'm1:Vetores', setId: null, status: 'preparing', retryAfter: null, updatedAt: null } })
    expect(items[0]?.state).toBe('preparing')
    expect(items[0]?.exerciseSet?.status).toBe('preparing')
  })
})
