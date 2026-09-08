import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PdfMaterialService, assessLexicalRelevance, type MinimalMaterialReviewRequest } from '../../src/main/materials/pdf-material-service'
import type { CoachDatabase } from '../../src/main/database/connection'

let sqlite: Database.Database
let database: CoachDatabase
let sequence: number

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, objective TEXT NOT NULL);
    CREATE TABLE materials (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, media_type TEXT NOT NULL, page_count INTEGER NOT NULL, status TEXT NOT NULL, relevance INTEGER NOT NULL, source_url TEXT, content_hash TEXT, error_message TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE material_chunks (id TEXT PRIMARY KEY, material_id TEXT NOT NULL, page_number INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE TABLE roadmaps (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE roadmap_modules (id TEXT PRIMARY KEY, roadmap_id TEXT NOT NULL, topics_json TEXT NOT NULL);
  `)
  sqlite.prepare('INSERT INTO workspaces (id, name, objective) VALUES (?, ?, ?)').run('workspace-1', 'Estruturas de Dados', 'Aprender árvores binárias e algoritmos de busca')
  database = { sqlite, orm: {} as CoachDatabase['orm'], path: ':memory:', close: () => sqlite.close() }
  sequence = 0
})

afterEach(() => sqlite.close())

function service(pages: string[], reviewAmbiguous?: (request: MinimalMaterialReviewRequest) => Promise<{ decision: 'relevant' | 'irrelevant' | 'ambiguous'; confidence: number }>): PdfMaterialService {
  return new PdfMaterialService(database, { extractPages: vi.fn(async () => pages), reviewAmbiguous, now: () => 10, createId: () => `id-${++sequence}` })
}

async function importPdf(materialService: PdfMaterialService, name = 'apostila.pdf'): Promise<Awaited<ReturnType<PdfMaterialService['importPdf']>>> {
  const fs = await import('node:fs/promises')
  const path = `/tmp/${name}`
  await fs.writeFile(path, '%PDF-test')
  try { return await materialService.importPdf('workspace-1', path) } finally { await fs.rm(path, { force: true }) }
}

describe('PDF material pipeline', () => {
  it('assesses relevance from workspace vocabulary without document-type regexes', () => {
    expect(assessLexicalRelevance({ name: 'Estruturas de Dados', objective: 'Árvores binárias' }, 'fatura.pdf', ['Árvores binárias usam nós e estruturas encadeadas.']).decision).toBe('relevant')
    expect(assessLexicalRelevance({ name: 'Estruturas de Dados', objective: 'Árvores binárias' }, 'conta-de-luz.pdf', ['Vencimento energia consumo kWh código de barras pagamento mensal.']).decision).toBe('irrelevant')
  })

  it('persists irrelevant documents as failed instead of ready', async () => {
    const result = await importPdf(service(['Vencimento energia consumo mensal código de barras pagamento residencial.']))
    expect(result).toMatchObject({ status: 'failed', relevance: 0 })
    expect(result.errorMessage).toContain('não apresentou evidência lexical')
    expect(service([]).search('workspace-1', 'energia')).toEqual([])
  })

  it('keeps ambiguous documents staged and sends only a bounded excerpt for review', async () => {
    let request: MinimalMaterialReviewRequest | undefined
    const result = await importPdf(service(['Árvores '.repeat(2_000)], async (value) => { request = value; return { decision: 'ambiguous', confidence: 0.6 } }))
    expect(result.status).toBe('staged')
    expect(request?.excerpt.length).toBeLessThanOrEqual(4_000)
    expect(request).not.toHaveProperty('pdf')
  })

  it('keeps ambiguous material staged when contextual review is unavailable', async () => {
    const result = await importPdf(service(['Árvores e conteúdos introdutórios.'], async () => { throw new Error('provider unavailable') }))
    expect(result.status).toBe('staged')
  })

  it('indexes only after approval and labels LIKE retrieval as lexical', async () => {
    sqlite.prepare("UPDATE workspaces SET name = 'C', objective = 'Aprender C' WHERE id = 'workspace-1'").run()
    sqlite.prepare("INSERT INTO roadmaps (id, workspace_id, status) VALUES ('roadmap-1', 'workspace-1', 'accepted')").run()
    sqlite.prepare("INSERT INTO roadmap_modules (id, roadmap_id, topics_json) VALUES ('module-1', 'roadmap-1', '[\"ponteiros em C\"]')").run()
    const materialService = service(['Curso de C sobre ponteiros em C, memória e endereços. '.repeat(100)])
    const result = await importPdf(materialService)
    expect(result.status).toBe('ready')
    expect(materialService.search('workspace-1', 'ponteiros')).toEqual([expect.objectContaining({ materialId: result.id, pageNumber: 1, topicId: 'module-1:ponteiros em C', retrieval: 'lexical' })])
  })

  it('deduplicates PDFs by workspace and content hash', async () => {
    sqlite.prepare("UPDATE workspaces SET name = 'C', objective = 'Aprender C' WHERE id = 'workspace-1'").run()
    const extractPages = vi.fn(async () => ['Curso completo de C e compilação.'])
    const materialService = new PdfMaterialService(database, { extractPages, now: () => 10, createId: () => `id-${++sequence}` })
    const first = await importPdf(materialService, 'duplicate.pdf')
    const second = await importPdf(materialService, 'duplicate.pdf')
    expect(second.id).toBe(first.id)
    expect(extractPages).toHaveBeenCalledTimes(1)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM materials').get()).toEqual({ count: 1 })
  })

  it('does not map a chunk to a topic when multiple topics match', async () => {
    sqlite.prepare("UPDATE workspaces SET name = 'C', objective = 'Aprender C' WHERE id = 'workspace-1'").run()
    sqlite.prepare("INSERT INTO roadmaps (id, workspace_id, status) VALUES ('roadmap-1', 'workspace-1', 'accepted')").run()
    sqlite.prepare("INSERT INTO roadmap_modules (id, roadmap_id, topics_json) VALUES ('module-1', 'roadmap-1', '[\"ponteiros\",\"ponteiros em C\"]')").run()
    const materialService = service(['Curso de C com ponteiros em C, memória e endereços.'])
    await importPdf(materialService)
    expect(materialService.search('workspace-1', 'ponteiros')[0]?.topicId).toBeNull()
  })
})
