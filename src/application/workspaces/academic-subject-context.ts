import type { AcademicSubjectContext, AcademicSubjectDeclaration, DeclaredAcademicLevel } from '../../shared/contracts/academic-subject-context-contract'
import { academicSubjectDeclarationSchema } from '../../shared/contracts/academic-subject-context-contract'
import { normalizeSubject } from './subject-normalizer'

export interface AcademicSubjectContextRepository {
  find(subject: string): AcademicSubjectContext | null
  list?(): AcademicSubjectContext[]
  upsert(input: AcademicSubjectDeclaration, now: number): AcademicSubjectContext
  replace?(input: AcademicSubjectDeclaration, now: number): AcademicSubjectContext
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function declarationForMessage(message: string): AcademicSubjectDeclaration | null {
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
export function academicDeclarationsFromMessage(message: string): AcademicSubjectDeclaration[] {
  const segments = message.split(/\b(?:mas|porém|porem|e também|e tambem)\b|[.;]/i).map((item) => item.trim().replace(/^[,;:\s]+|[,;:\s]+$/g, '')).filter(Boolean)
  const expanded = segments.flatMap((segment) => { const parts = segment.split(/\s+e\s+(?=(?:quero|preciso|sei|domino|conheço|conheco|entendo|uso)\b)/i).map((item) => item.trim()); return parts.length > 1 ? parts : [segment] })
  return expanded.flatMap((item) => { const value = declarationForMessage(item); return value ? [value] : [] })
}
export function academicDeclarationFromMessage(message: string): AcademicSubjectDeclaration | null { return academicDeclarationsFromMessage(message)[0] ?? null }

export class AcademicSubjectContextService {
  constructor(private readonly repository: AcademicSubjectContextRepository, private readonly now = Date.now) {}
  get(subject: string): AcademicSubjectContext | null { return this.repository.find(normalizeSubject(subject).subject) }
  list(): AcademicSubjectContext[] { return this.repository.list?.() ?? [] }
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
  replace(input: AcademicSubjectDeclaration): AcademicSubjectContext { const parsed = academicSubjectDeclarationSchema.parse(input); const normalized = { ...parsed, subject: normalizeSubject(parsed.subject).subject }; return this.repository.replace?.(normalized, this.now()) ?? this.repository.upsert(normalized, this.now()) }
  recordMessage(message: string): AcademicSubjectContext | null { const results = academicDeclarationsFromMessage(message).map((declaration) => this.record(declaration)); return results[0] ?? null }
}
