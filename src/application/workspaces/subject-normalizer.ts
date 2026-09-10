const SUBJECTS: Array<[RegExp, string]> = [[/\bjavafx\b/i, 'JavaFX'], [/\bpython\b/i, 'Python'], [/\bjavascript\b/i, 'JavaScript'], [/\btypescript\b/i, 'TypeScript'], [/\bjava\b/i, 'Java'], [/\b(?:linguagem\s+)?c\b/i, 'C'], [/redes? de computadores/i, 'Redes de Computadores']]
const CONTEXT_START = /\b(?:usando|utilizando|com tudo|considerando|levando em conta|porque|para (?:minha|a) prova|no meu nível|do meu nível|sobre meu nível|já expliquei|ja expliquei)\b/i
const DIAGNOSTIC_SIGNAL = /\b(?:sei|domino|entendo|conheço|conheco|aprendi|estudei|tenho dificuldade|não sei|nao sei|não entendo|nao entendo|erro|confundo|consigo|preciso revisar)\b/i

export interface SubjectLearningContext {
  readonly subject: string
  readonly declared: readonly string[]
  readonly observed: readonly string[]
}

export function normalizeSubject(input: string): { subject: string; userContext: string | null } { const raw = input.trim().replace(/\s+/g, ' '); const known = SUBJECTS.find(([pattern]) => pattern.test(raw)); if (known) { const match = known[0].exec(raw); const suffix = match ? raw.slice(match.index + match[0].length).replace(/^[\s,;:.\-]+/, '') : ''; const prefix = match ? raw.slice(0, match.index).replace(/^(quero|estudar|aprender|preciso estudar)\s*/i, '').trim() : ''; const context = [prefix, suffix].filter(Boolean).join(' ').trim(); return { subject: known[1], userContext: context || null } } const marker = raw.search(CONTEXT_START); const candidate = (marker > 0 ? raw.slice(0, marker) : raw).replace(/^(quero|estudar|aprender|preciso estudar|preparação para|preparacao para)\s+/i, '').trim(); return { subject: candidate.slice(0, 80), userContext: marker > 0 ? raw.slice(marker).trim() : null } }

export function createSubjectLearningContext(subject: string, declared: readonly string[] = [], observed: readonly string[] = []): SubjectLearningContext {
  const canonical = normalizeSubject(subject).subject
  const unique = (values: readonly string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))]
  return { subject: canonical, declared: unique(declared), observed: unique(observed) }
}

export function declaredSubjectKnowledge(message: string, subject: string): string | null {
  const canonical = normalizeSubject(subject).subject
  const mentioned = SUBJECTS.find(([pattern]) => pattern.test(message))?.[1] ?? null
  const sameKnownSubject = mentioned === null || mentioned.toLocaleLowerCase('pt-BR') === canonical.toLocaleLowerCase('pt-BR')
  const mentionsRequestedSubject = canonical.length <= 3 ? new RegExp(`\\b${canonical}\\b`, 'i').test(message) : message.toLocaleLowerCase('pt-BR').includes(canonical.toLocaleLowerCase('pt-BR'))
  if (!sameKnownSubject || !mentionsRequestedSubject || !DIAGNOSTIC_SIGNAL.test(message)) return null
  return message.trim()
}

export function semanticSubjectKey(subject: string, focus = '', context = ''): string {
  return [normalizeSubject(subject).subject, focus, context].map((value) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9+#]+/g, ' ').trim()).filter(Boolean).join('|')
}

export function workspaceAnalysisSignature(subject: string, focus = '', context = ''): string {
  let hash = 2166136261
  for (const character of semanticSubjectKey(subject, focus, context)) { hash ^= character.codePointAt(0) ?? 0; hash = Math.imul(hash, 16777619) }
  return (hash >>> 0).toString(36)
}

export function isProgrammingSubject(subject: string): boolean {
  return /\b(?:python|java(?:script|fx)?|typescript|linguagem c|programa(?:cao|ção)|algoritmos?|estrutura(?:s)? de dados|desenvolvimento de software)\b/i.test(subject.normalize('NFD').replace(/\p{M}/gu, ''))
}
