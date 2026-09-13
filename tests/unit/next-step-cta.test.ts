import { describe, expect, it } from 'vitest'
import { deriveNextStepCta } from '../../src/application/study-workspaces/next-step-cta'
import type { StudyPlanItem } from '../../src/shared/contracts/study-workspace-contract'

const item = (activityType: NonNullable<StudyPlanItem['activityType']>): StudyPlanItem => ({ id: 'item', title: 'Ponteiros / etapa', durationMinutes: 30, position: 1, status: 'active', moduleId: 'module', topicId: 'module:Ponteiros', exerciseSetId: 'set', materialId: 'material', activityType })

describe('deriveNextStepCta', () => {
  it.each([
    ['study', 'studies', 'Abrir Estudos'], ['lesson', 'studies', 'Abrir Estudos'], ['introduction', 'studies', 'Abrir Estudos'],
    ['exercise', 'exercises', 'Abrir Exercícios'], ['assessment', 'exercises', 'Abrir Exercícios'], ['review', 'review', 'Abrir Revisão'],
    ['practice', 'practice', 'Abrir Prática'], ['coding', 'practice', 'Abrir Prática'], ['material', 'materials', 'Abrir Material'],
  ] as const)('maps %s to its real destination', (activityType, route, label) => {
    expect(deriveNextStepCta(item(activityType))).toMatchObject({ route, label, moduleId: 'module', topicId: 'module:Ponteiros', exerciseSetId: 'set', materialId: 'material' })
  })

  it('does not invent Practice for missing or unsupported activity types', () => {
    expect(deriveNextStepCta(undefined)).toBeNull()
    expect(deriveNextStepCta(item('video'))).toBeNull()
  })
})
