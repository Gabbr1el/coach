import type { AcademicSubjectContext, AcademicSubjectDeclaration, DeclaredAcademicLevel } from '../../shared/contracts/academic-subject-context-contract'
import { academicSubjectDeclarationSchema } from '../../shared/contracts/academic-subject-context-contract'
import { normalizeSubject } from './subject-normalizer'

export interface AcademicSubjectContextRepository {
  find(subject: string): AcademicSubjectContext | null
  upsert(input: AcademicSubjectDeclaration, now: number): AcademicSubjectContext
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export function academicDeclarationFromMessage(message: string): AcademicSubjectDeclaration | null {
  const normalized = normalizeSubject(message)
  const subject = normalized.subject
  if (!subject || subject === message.trim().slice(0, 80)) return null
  const lower = message.toLocaleLowerCase('pt-BR')
  const declaresKnowledge = /\b(?:sei|domino|conheço|conheco|entendo|já uso|ja uso|uso)\b/i.test(message)
  const declaresDifficulty = /\b(?:não sei|nao sei|não entendo|nao entendo|tenho dificuldade|confundo)\b/i.test(message)
  const declaresGoal = /\b(?:quero|preciso|objetivo|para a faculdade|para minha prova)\b/i.test(message)
  if (!declaresKnowledge && !declaresDifficulty && !declaresGoal && !/\b(?:iniciante|intermedi[aá]rio|avançad|avancad|nunca programei)\b/i.test(message)) return null
  let declaredLevel: DeclaredAcademicLevel | null = null
  if (/\b(?:avançad|avancad|domino|sei bastante)\b/i.test(lower)) declaredLevel = 'advanced'
  else if (/\b(?:intermedi[aá]rio|já uso|ja uso|tenho alguma experiência|tenho alguma experiencia)\b/i.test(lower)) declaredLevel = 'intermediate'
  else if (/\b(?:iniciante|nunca programei|começando|comecando)\b/i.test(lower)) declaredLevel = 'beginner'
  return academicSubjectDeclarationSchema.parse({
    subject,
    declaredLevel,
    declaredKnowledge: declaresKnowledge && !declaresDifficulty ? [message] : [],
    declaredDifficulties: declaresDifficulty ? [message] : [],
    goals: declaresGoal ? [message] : [],
    sourceEvidence: [message],
  })
}

export class AcademicSubjectContextService {
  constructor(private readonly repository: AcademicSubjectContextRepository, private readonly now = Date.now) {}
  get(subject: string): AcademicSubjectContext | null { return this.repository.find(normalizeSubject(subject).subject) }
  record(input: AcademicSubjectDeclaration): AcademicSubjectContext {
    const current = this.get(input.subject)
    return this.repository.upsert({
      subject: normalizeSubject(input.subject).subject,
      declaredLevel: input.declaredLevel ?? current?.declaredLevel ?? null,
      declaredKnowledge: unique([...(current?.declaredKnowledge ?? []), ...input.declaredKnowledge]),
      declaredDifficulties: unique([...(current?.declaredDifficulties ?? []), ...input.declaredDifficulties]),
      goals: unique([...(current?.goals ?? []), ...input.goals]),
      sourceEvidence: unique([...(current?.sourceEvidence ?? []), ...input.sourceEvidence]),
    }, this.now())
  }
  recordMessage(message: string): AcademicSubjectContext | null {
    const declaration = academicDeclarationFromMessage(message)
    return declaration ? this.record(declaration) : null
  }
}
