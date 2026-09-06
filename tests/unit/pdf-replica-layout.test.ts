import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('PDF replica layout invariants', () => {
  it('locks the document viewport and delegates scrolling to panes', () => {
    const css = readFileSync('src/renderer/styles/index.css', 'utf8')
    expect(css).toContain('html,\nbody,\n#root')
    expect(css).toMatch(/#root\s*\{[\s\S]*?overflow:\s*hidden/)
    expect(css).toMatch(/\.coach-scroll-pane\s*\{[\s\S]*?overflow-y:\s*auto/)
  })

  it('contains long chat content inside message bubbles', () => {
    const css = readFileSync('src/renderer/styles/index.css', 'utf8')
    const shell = readFileSync('src/renderer/app/WorkspaceShell.tsx', 'utf8')
    expect(css).toMatch(/\.coach-chat-message\s*\{[\s\S]*?overflow-wrap:\s*anywhere/)
    expect(css).toMatch(/\.coach-chat-message\s*\{[\s\S]*?word-break:\s*break-word/)
    expect(shell).toContain('ref={conversationRef}')
    expect(shell).toContain('coach-chat-message')
  })

  it('exposes every referenced workspace page with a persistent coach', () => {
    const shell = readFileSync('src/renderer/app/WorkspaceShell.tsx', 'utf8')
    for (const label of ['Visão geral', 'Plano', 'Materiais', 'Prática', 'Relatórios']) expect(shell).toContain(label)
    expect(shell).toContain('Coach deste Workspace')
  })
})
