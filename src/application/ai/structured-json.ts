import { ZodError } from 'zod'

export function extractJsonDocument(content: string): unknown {
  const trimmed = content.trim()
  if (!trimmed) throw new Error('Provider response was empty')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1]
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  const candidate = fenced ?? (start >= 0 && end > start ? trimmed.slice(start, end + 1) : '')
  if (!candidate) throw new Error('No JSON object was found in provider response')
  return JSON.parse(candidate)
}

export function structuredErrorDetail(error: unknown): string {
  if (error instanceof ZodError) return error.issues.slice(0, 12).map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`).join('; ')
  return error instanceof Error ? error.message : String(error)
}

export function normalizeGeneratedLessonJson(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const lesson = value as Record<string, unknown>
  if (!Array.isArray(lesson.blocks)) return value
  return { ...lesson, blocks: lesson.blocks.map((item) => {
    if (!item || typeof item !== 'object') return item
    const block = { ...(item as Record<string, unknown>) }
    if (block.type === 'codeExample') {
      if (typeof block.walkthrough === 'string') block.walkthrough = [block.walkthrough]
      if (!('expectedOutput' in block)) block.expectedOutput = null
    }
    if (block.type === 'miniExercise') {
      if (!('instruction' in block) && typeof block.prompt === 'string') block.instruction = block.prompt
      if (!['NEXT_TOPIC', 'RETRY', 'REVIEW', 'PRACTICE', 'WATCH_VIDEO', 'CONTINUE'].includes(String(block.nextAction))) block.nextAction = 'PRACTICE'
      for (const key of ['language', 'prompt', 'starterCode', 'solution', 'walkthrough']) delete block[key]
    }
    return block
  }) }
}

export function sanitizedResponsePreview(content: string, limit = 1500): string {
  const sanitized = content
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|key|token)[-_][A-Za-z0-9_-]{8,}\b/gi, '[REDACTED]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .slice(0, limit)
  return process.env.COACH_DEBUG_AI_CONTENT === '1' ? sanitized : `[content redacted; length=${content.length}]`
}

export function structuredOutputDebugEnabled(): boolean {
  return process.env.NODE_ENV === 'development' || Boolean(process.env.ELECTRON_RENDERER_URL) || process.env.COACH_DEBUG_AI === '1'
}
