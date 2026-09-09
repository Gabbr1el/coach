const FNV_OFFSET_LOW = 0x811c9dc5
const FNV_OFFSET_HIGH = 0x9e3779b9
const FNV_PRIME = 0x01000193

function fnv1a(value: string, seed: number): string {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function interactiveSourceRevision(code: string, prediction: string | null): string {
  const value = `${code}\0${prediction ?? ''}`
  return `${fnv1a(value, FNV_OFFSET_LOW)}${fnv1a(value, FNV_OFFSET_HIGH)}`
}

export function normalizeInteractiveOutput(value: string): string {
  return value.replaceAll('\r\n', '\n').trimEnd()
}
