function plain(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9+#]+/g, ' ').trim()
}

export function workspaceEquivalenceKey(subject: string): string {
  const raw = plain(subject)
  const javascript = /^(?:js|javascript|java script)(?:\s+(.+))?$/.exec(raw)
  if (javascript) return ['javascript', javascript[1]?.replace(/\s+/g, '-')].filter(Boolean).join('-')
  const oop = /^(?:poo|programacao orientada a objetos|orientacao a objetos)(?:\s+(.+))?$/.exec(raw)
  if (oop) return ['programacao-orientada-a-objetos', oop[1]?.replace(/\s+/g, '-')].filter(Boolean).join('-')
  return raw.replace(/\s+/g, '-')
}

export function workspaceDistinctionKey(equivalenceKey: string, meaningfulDistinction?: string | null): string {
  const distinction = plain(meaningfulDistinction ?? '')
  return distinction ? `${equivalenceKey}::${distinction.replace(/\s+/g, '-')}` : equivalenceKey
}
