import { describe, expect, it } from 'vitest'
import { workspaceDistinctionKey, workspaceEquivalenceKey } from '../../src/application/workspaces/workspace-equivalence'

describe('workspace equivalence', () => {
  it.each(['POO', 'Programação Orientada a Objetos', 'Orientacao a objetos'])('unifies %s', (value) => {
    expect(workspaceEquivalenceKey(value)).toBe('programacao-orientada-a-objetos')
  })

  it.each(['JS', 'JavaScript', 'Java Script'])('unifies %s', (value) => {
    expect(workspaceEquivalenceKey(value)).toBe('javascript')
  })

  it('preserves a meaningful level qualifier in runtime identity', () => {
    expect(workspaceEquivalenceKey('JavaScript avançado')).toBe('javascript-avancado')
    expect(workspaceEquivalenceKey('Java Script avancado')).toBe('javascript-avancado')
  })

  it.each(['Cálculo', 'CALCULO', 'Cálculo!!!', '  cálculo  '])('normalizes accented and punctuated %s deterministically', (value) => {
    expect(workspaceEquivalenceKey(value)).toBe('calculo')
  })

  it('persists a meaningful distinction in the active uniqueness key', () => {
    expect(workspaceDistinctionKey('javascript', 'Foco em Node.js')).toBe('javascript::foco-em-node-js')
  })
})
