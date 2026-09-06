import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CoachDatabase } from '../database/connection'
import type { MaterialSearchResult, MaterialSummary } from '../../shared/contracts/material-contract'
import { createHash } from 'node:crypto'

export class PdfMaterialService {
  constructor(private readonly database: CoachDatabase) {}
  async importPdf(workspaceId: string, path: string): Promise<MaterialSummary> {
    const handle = await open(path, 'r')
    let data: Uint8Array
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > 20_000_000) throw new Error('PDF exceeds 20 MB or is not a regular file')
      data = new Uint8Array(stat.size)
      let offset = 0
      while (offset < stat.size) {
        const read = await handle.read(data, offset, stat.size - offset, offset)
        if (read.bytesRead === 0) throw new Error('PDF file changed while being read')
        offset += read.bytesRead
      }
    } finally { await handle.close() }
    if (process.platform !== 'linux') throw new Error('PDF import is available on Linux in this version')
    const directory = await mkdtemp(join(tmpdir(), 'coach-pdf-'))
    const privatePdf = join(directory, 'material.pdf')
    let stdout: string
    try {
      await writeFile(privatePdf, data, { mode: 0o400 })
      const result = await promisify(execFile)('/usr/bin/bwrap', ['--die-with-parent', '--unshare-all', '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64', '--ro-bind', privatePdf, '/material.pdf', '--tmpfs', '/tmp', '--proc', '/proc', '--dev', '/dev', '/usr/bin/prlimit', '--cpu=15:15', '--as=536870912:536870912', '--fsize=8388608:8388608', '--nofile=32:32', '--nproc=8:8', '/usr/bin/pdftotext', '-layout', '-enc', 'UTF-8', '/material.pdf', '-'], { timeout: 20_000, maxBuffer: 6_000_000 })
      stdout = result.stdout
    } finally { await rm(directory, { recursive: true, force: true }) }
    const rawPages = stdout.split('\f')
    if (rawPages.at(-1)?.trim() === '') rawPages.pop()
    const pages = rawPages.map((page) => page.replace(/\s+/g, ' ').trim())
    if (pages.length > 500) throw new Error('PDF exceeds 500 pages')
    const material: MaterialSummary = { id: crypto.randomUUID(), name: basename(path).slice(0, 240), pageCount: pages.length, status: 'ready', relevance: 50, sourceUrl: null, createdAt: Date.now() }
    const chunks: Array<{ id: string; pageNumber: number; content: string }> = []
    let extractedCharacters = 0
    for (let pageNumber = 1; pageNumber <= pages.length; pageNumber += 1) {
      const content = pages[pageNumber - 1]!.slice(0, 100_000)
      extractedCharacters += content.length
      if (extractedCharacters > 5_000_000) throw new Error('PDF extracted text exceeds the Coach limit')
      if (content) chunks.push({ id: crypto.randomUUID(), pageNumber, content })
    }
    this.database.sqlite.transaction(() => {
      const hash = createHash('sha256').update(data).digest('hex')
      this.database.sqlite.prepare('INSERT INTO materials (id, workspace_id, name, media_type, page_count, status, relevance, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(material.id, workspaceId, material.name, 'application/pdf', material.pageCount, material.status, material.relevance, hash, material.createdAt)
      const insert = this.database.sqlite.prepare('INSERT INTO material_chunks (id, material_id, page_number, content) VALUES (?, ?, ?, ?)')
      for (const chunk of chunks) insert.run(chunk.id, material.id, chunk.pageNumber, chunk.content)
    })()
    return material
  }
  list(workspaceId: string): MaterialSummary[] { return this.database.sqlite.prepare("SELECT id, name, page_count AS pageCount, status, relevance, source_url AS sourceUrl, created_at AS createdAt FROM materials WHERE workspace_id = ? AND status != 'archived' ORDER BY relevance DESC, created_at DESC").all(workspaceId) as MaterialSummary[] }
  updateRelevance(workspaceId: string, materialId: string, relevance: number): MaterialSummary { const changed = this.database.sqlite.prepare('UPDATE materials SET relevance = ? WHERE id = ? AND workspace_id = ?').run(relevance, materialId, workspaceId); if (changed.changes !== 1) throw new Error('Material not found'); return this.database.sqlite.prepare('SELECT id, name, page_count AS pageCount, status, relevance, source_url AS sourceUrl, created_at AS createdAt FROM materials WHERE id = ?').get(materialId) as MaterialSummary }
  search(workspaceId: string, query: string): MaterialSearchResult[] {
    const terms = query.toLocaleLowerCase('pt-BR').split(/\s+/).filter((term) => term.length >= 3).slice(0, 8)
    if (!terms.length) return []
    const clauses = terms.map(() => 'lower(c.content) LIKE ?').join(' OR ')
    const escapeLike = (term: string) => term.replace(/[\\%_]/g, '\\$&')
    const rows = this.database.sqlite.prepare(`SELECT m.id AS materialId, m.name AS materialName, c.page_number AS pageNumber, c.content FROM material_chunks c JOIN materials m ON m.id = c.material_id WHERE m.workspace_id = ? AND m.status = 'ready' AND m.relevance > 0 AND (${clauses.replaceAll('LIKE ?', "LIKE ? ESCAPE '\\'")}) ORDER BY m.relevance DESC LIMIT 50`).all(workspaceId, ...terms.map((term) => `%${escapeLike(term)}%`)) as MaterialSearchResult[]
    return rows.map((row) => ({ row, score: terms.reduce((sum, term) => sum + (row.content.toLocaleLowerCase('pt-BR').includes(term) ? 1 : 0), 0) })).sort((a, b) => b.score - a.score).slice(0, 6).map(({ row }) => { const lower = row.content.toLocaleLowerCase('pt-BR'); const index = Math.max(0, Math.min(...terms.map((term) => { const found = lower.indexOf(term); return found < 0 ? lower.length : found }))); const start = Math.max(0, index - 400); return { ...row, content: row.content.slice(start, start + 1600) } })
  }
}
