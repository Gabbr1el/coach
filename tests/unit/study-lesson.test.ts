import { describe, expect, it } from 'vitest'
import type { RoadmapModule } from '../../src/shared/contracts/roadmap-contract'
import { lessonFor, nextStudyStage } from '../../src/renderer/app/study-lesson'

const module: RoadmapModule = { id: 'm1', title: 'Memoria', objective: 'Compreender memoria em C', estimatedMinutes: 60, position: 1, status: 'active', topics: ['Ponteiros'], outcomes: ['Manipular enderecos'], practice: 'Criar um programa em C', completionCriteria: ['Explicar valor e endereco'], resources: [] }

describe('adaptive study lesson', () => {
  it('teaches pointers before presenting verification', () => {
    const lesson = lessonFor('Ponteiros', module)
    expect(lesson.concept).toContain('endereco de memoria')
    expect(lesson.steps).toHaveLength(4)
    expect(lesson.walkthrough[2]).toContain('endereco')
    expect(lesson.verification.question).toContain('representa p')
  })

  it('requires explanation and example before verification', () => {
    expect(nextStudyStage('explanation')).toBe('example')
    expect(nextStudyStage('example')).toBe('verification')
    expect(nextStudyStage('verification', true)).toBe('exercise')
  })

  it('returns an incorrect answer to a new attempt and a correct one to exercise', () => {
    expect(nextStudyStage('feedback', false)).toBe('verification')
    expect(nextStudyStage('exercise')).toBe('feedback')
  })
})
