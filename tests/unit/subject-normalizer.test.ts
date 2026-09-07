import { describe, expect, it } from 'vitest'
import { normalizeSubject } from '../../src/application/workspaces/subject-normalizer'
import { hasGenericModules } from '../../src/application/roadmaps/roadmap-service'

describe('workspace subject normalization', () => {
  it('separates C from user context', () => { expect(normalizeSubject('Quero C usando tudo que eu já expliquei sobre meu nível')).toEqual({ subject: 'C', userContext: 'usando tudo que eu já expliquei sobre meu nível' }) })
  it('keeps canonical subjects', () => { expect(normalizeSubject('JavaFX considerando minha dificuldade com layouts').subject).toBe('JavaFX'); expect(normalizeSubject('Redes de Computadores para minha prova').subject).toBe('Redes de Computadores') })
  it('rejects the former universal roadmap template', () => { expect(hasGenericModules({ title: 'C', modules: [{ title: 'Vocabulário e mapa de C', objective: 'Mapa', estimatedMinutes: 100, topics: ['termos de C', 'relações'], outcomes: ['mapa'], practice: 'Construir um mapa de 10 conceitos de C', completionCriteria: ['feito'], resources: [] }, { title: 'Mecanismos centrais de C', objective: 'Mecanismos', estimatedMinutes: 100, topics: ['processo', 'causa'], outcomes: ['prever'], practice: 'casos', completionCriteria: ['feito'], resources: [] }] })).toBe(true) })
})
