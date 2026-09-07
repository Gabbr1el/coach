import type { CurriculumSource } from '../../shared/contracts/roadmap-contract'
import type { Workspace } from '../../shared/contracts/workspace-contract'

export interface CurriculumSourceGateway { retrieve(source: CurriculumSource): Promise<CurriculumSource> }

const references: Array<{ match: RegExp; sources: CurriculumSource[] }> = [
  { match: /\bpython\b/i, sources: [{ id: 'python-tutorial', title: 'Python Tutorial', url: 'https://docs.python.org/3/tutorial/', type: 'documentation', authority: 'Python Software Foundation', retrieved: false, retrievedAt: null, excerpt: null }] },
  { match: /javafx/i, sources: [{ id: 'openjfx-docs', title: 'OpenJFX Documentation', url: 'https://openjfx.io/openjfx-docs/', type: 'documentation', authority: 'OpenJFX', retrieved: false, retrievedAt: null, excerpt: null }] },
  { match: /\bjava\b/i, sources: [{ id: 'oracle-java-tutorials', title: 'Java Tutorials', url: 'https://docs.oracle.com/javase/tutorial/', type: 'documentation', authority: 'Oracle', retrieved: false, retrievedAt: null, excerpt: null }] },
  { match: /html|css|javascript|typescript|web/i, sources: [{ id: 'mdn-web-docs', title: 'MDN Web Docs', url: 'https://developer.mozilla.org/en-US/docs/Web', type: 'documentation', authority: 'Mozilla', retrieved: false, retrievedAt: null, excerpt: null }] },
  { match: /linguagem c|programa.+\bc\b|^c$/i, sources: [
    { id: 'cppreference-c', title: 'C language reference', url: 'https://en.cppreference.com/w/c', type: 'reference', authority: 'cppreference', retrieved: false, retrievedAt: null, excerpt: null },
    { id: 'gnu-c-manual', title: 'GNU C Language Manual', url: 'https://www.gnu.org/software/c-intro-and-ref/manual/html_node/index.html', type: 'documentation', authority: 'GNU Project', retrieved: false, retrievedAt: null, excerpt: null },
  ] },
]

export class CurriculumSourceService {
  constructor(private readonly gateway: CurriculumSourceGateway) {}
  async sourcesFor(workspace: Workspace): Promise<CurriculumSource[]> {
    const subject = workspace.name.trim().toLocaleLowerCase() === 'c' ? 'linguagem c' : `${workspace.name} ${workspace.objective}`
    const selected = references.find((entry) => entry.match.test(subject))?.sources ?? []
    return Promise.all(selected.slice(0, 3).map(async (source) => { try { return await this.gateway.retrieve(source) } catch { return source } }))
  }
}
