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

  it('keeps workspace chat scroll user-controlled and explains context sharing', () => {
    const app = read('src/renderer/app/App.tsx')
    const home = read('src/renderer/app/HomeScreen.tsx')
    const workspace = read('src/renderer/app/WorkspaceShell.tsx')
    expect(app).toContain('workspaceFollowLatest.current')
    expect(app).toContain('pane.scrollHeight - pane.scrollTop - pane.clientHeight < 72')
    expect(workspace).toContain('onScroll={onConversationScroll}')
    expect(workspace).toContain('contexto gerenciado e limitado')
    expect(workspace).toContain('contexto gerenciado e limitado')
    expect(workspace).not.toContain('Enviar contexto local ao provedor')
    expect(home).toContain('Dados acadêmicos mantidos localmente')
    expect(home).toContain("'Não avaliado'")
    expect(home).not.toContain('averageSuccessRate ?? 100')
    expect(app).toContain('a cota disponível foi esgotada')
    expect(app).toContain('provedor configurado está indisponível')
  })

  it('exposes dialogs and hidden row actions to keyboard users', () => {
    const app = read('src/renderer/app/App.tsx')
    const home = read('src/renderer/app/HomeScreen.tsx')
    expect(app).toContain("event.key === 'Escape'")
    expect(app).toContain('aria-labelledby="quick-notes-title"')
    expect(app).toContain('aria-label="Fechar notas"')
    expect(app).toContain('htmlFor="quick-notes"')
    expect(home).toContain('focus-visible:opacity-100')
  })

  it('invalidates execution evidence when source or workspace changes', () => {
    const app = read('src/renderer/app/App.tsx')
    const project = read('src/renderer/app/ProjectWorkspace.tsx')
    expect(project).toContain('setBusy(false); setExecution(null) }, [workspaceId, active?.id, draft]')
    expect(project).toContain('executionEpoch.current === epoch')
    expect(app).toMatch(/setExecution\(null\)\s+setPracticeContext\(null\)/)
  })
})
