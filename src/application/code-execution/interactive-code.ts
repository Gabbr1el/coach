import { createHash } from 'node:crypto'

export function interactiveSourceRevision(code: string, prediction: string | null): string {
  return createHash('sha256').update(`${code}\0${prediction ?? ''}`).digest('hex').slice(0, 32)
}

export function normalizeInteractiveOutput(value: string): string {
  return value.replaceAll('\r\n', '\n').trimEnd()
}
