import { describe, expect, it, vi } from 'vitest'
import { exactTopic, navigateNextStep } from '../../src/renderer/app/next-step-navigation'

const handlers = () => ({ openStudies: vi.fn(), openExercises: vi.fn(), openMaterial: vi.fn(), openPage: vi.fn() })
const base = { label: 'Open', description: 'Description', moduleId: 'm2', topicId: 'm2:exact', exerciseSetId: 'set-7', materialId: 'material-9' }

describe('next-step navigation', () => {
  it('passes exact study and exercise identities to App route handlers', () => {
    const studies = handlers(); navigateNextStep({ ...base, route: 'studies' }, studies)
    expect(studies.openStudies).toHaveBeenCalledWith({ moduleId: 'm2', topicId: 'm2:exact' })
    const exercises = handlers(); navigateNextStep({ ...base, route: 'exercises' }, exercises)
    expect(exercises.openExercises).toHaveBeenCalledWith({ moduleId: 'm2', topicId: 'm2:exact', exerciseSetId: 'set-7' })
  })

  it('opens a specific material and supports video', () => {
    const material = handlers(); navigateNextStep({ ...base, route: 'materials' }, material); expect(material.openMaterial).toHaveBeenCalledWith('material-9')
    const video = handlers(); navigateNextStep({ ...base, route: 'videos' }, video); expect(video.openPage).toHaveBeenCalledWith('videos')
  })

  it('resolves only the exact available roadmap topic', () => {
    const roadmap = { modules: [{ id: 'm1', status: 'active', topics: ['other'] }, { id: 'm2', status: 'available', topics: ['exact'] }] } as never
    expect(exactTopic(roadmap, 'm2', 'm2:exact')?.topicId).toBe('m2:exact')
    expect(exactTopic(roadmap, 'm1', 'm2:exact')).toBeNull()
  })
})
