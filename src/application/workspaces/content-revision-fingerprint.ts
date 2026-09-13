import { createHash } from 'node:crypto'
import { CONTENT_GENERATOR_VERSIONS } from './workspace-content-repository'

export function canonicalContentSnapshot(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalContentSnapshot).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalContentSnapshot(item)}`).join(',')}}`
  return JSON.stringify(value)
}

export function contentRevisionFingerprint(snapshot: unknown): string {
  return createHash('sha256').update(canonicalContentSnapshot({ generatorVersions: CONTENT_GENERATOR_VERSIONS, snapshot })).digest('hex')
}

export const NO_CONTENT_MUTATION = 'none'

export function effectiveContentRevisionFingerprint(baseInputHash: string, mutationFingerprint = NO_CONTENT_MUTATION): string {
  return contentRevisionFingerprint({ baseInputHash, mutationFingerprint })
}

export function roadmapMutationFingerprint(roadmap: { title: string; modules: unknown }): string {
  return contentRevisionFingerprint({ kind: 'approved-roadmap-rebuild', title: roadmap.title, modules: roadmap.modules })
}
