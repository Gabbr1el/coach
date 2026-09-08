import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('renderer UI safeguards', () => {
  it('renders planner actions only in the decision card', () => {
    const home = read('src/renderer/app/HomeScreen.tsx')
    expect(home.match(/plannerActions\.map/g)).toHaveLength(1)
    expect(home).not.toContain('plannerActions.filter')
    expect(home).toContain("onResolveAction(action.id, 'apply')")
    expect(home).toContain("onResolveAction(action.id, 'reject')")
  })

  it('uses a neutral local profile', () => {
    const home = read('src/renderer/app/HomeScreen.tsx')
    expect(home).not.toMatch(/GB|Gabriel|Plano pessoal/)
    expect(home).toContain('Perfil local')
  })

  it('renders supported Markdown without raw HTML injection', () => {
    const chat = read('src/renderer/app/ChatMessage.tsx')
    expect(chat).toContain('<strong')
    expect(chat).toContain('<em')
    expect(chat).toContain('<ul')
    expect(chat).toContain('<ol')
    expect(chat).toContain('<pre')
    expect(chat).toContain('<code')
    expect(chat).toContain('<p')
    expect(chat).not.toMatch(/dangerouslySetInnerHTML|innerHTML|html-react-parser|rehypeRaw/)
  })

  it('exposes chat logs, input labels, current navigation and keyboard focus', () => {
    const home = read('src/renderer/app/HomeScreen.tsx')
    const workspace = read('src/renderer/app/WorkspaceShell.tsx')
    const css = read('src/renderer/styles/index.css')
    expect(home).toContain('role="log"')
    expect(workspace).toContain('role="log"')
    expect(home).toContain('aria-current')
    expect(workspace).toContain('aria-current')
    expect(home).toContain('aria-label="Mensagem para o organizador"')
    expect(workspace).toContain('aria-label="Mensagem para o Coach"')
    expect(css).toMatch(/textarea:focus-visible/)
  })
})
