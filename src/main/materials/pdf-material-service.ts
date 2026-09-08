import { constants } from 'node:fs'
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import type { CoachDatabase } from '../database/connection'
import { materialSemanticAnalysisSchema, type MaterialSearchResult, type MaterialSemanticAnalysis, type MaterialSummary } from '../../shared/contracts/material-contract'

const MAX_PDF_BYTES = 20_000_000
const MAX_PAGES = 500
const MAX_EXTRACTED_CHARACTERS = 5_000_000
const MAX_PAGE_CHARACTERS = 100_000
const MAX_REVIEW_CHARACTERS = 4_000
const CHUNK_CHARACTERS = 2_400
const CHUNK_OVERLAP = 300
const STOP_WORDS = new Set(['a', 'as', 'o', 'os', 'de', 'da', 'das', 'do', 'dos', 'e', 'em', 'no', 'nos', 'na', 'nas', 'para', 'por', 'com', 'uma', 'um', 'aprender', 'estudar', 'basico', 'avancado'])

type RelevanceDecision = 'relevant' | 'irrelevant' | 'ambiguous'

export interface MinimalMaterialReviewRequest {
  readonly workspaceName: string
  readonly workspaceObjective: string
  readonly fileName: string
  readonly excerpt: string
  readonly lexicalRelevance: number
}

export interface MinimalMaterialReviewResult {
  readonly decision: RelevanceDecision
  readonly confidence: number
}

export interface PdfMaterialServiceOptions {
  readonly extractPages?: (data: Uint8Array) => Promise<string[]>
  readonly reviewAmbiguous?: (request: MinimalMaterialReviewRequest) => Promise<MinimalMaterialReviewResult>
  readonly now?: () => number
  readonly createId?: () => string
  readonly analyzeSemantic?: (request: MinimalMaterialReviewRequest) => Promise<MaterialSemanticAnalysis>
  readonly extractPptxSlides?: (path: string) => Promise<string[]>
}

export interface LexicalRelevanceAssessment {
  readonly decision: RelevanceDecision
  readonly relevance: number
  readonly matchedTerms: readonly string[]
}

type WorkspaceContext = { name: string; objective: string }
type MaterialRow = MaterialSummary & { readonly semanticAnalysisJson?: string | null; readonly errorMessage: string | null }
type SearchRow = Omit<MaterialSearchResult, 'topicId' | 'retrieval'> & { readonly chunkId: string; readonly relevance: number }
type TopicCandidate = { readonly moduleId: string; readonly topic: string }

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')
}

function tokens(value: string): string[] {
  return normalize(value).split(/[^\p{L}\p{N}+#]+/u).filter((term) => term.length > 0)
}

function contextTerms(workspace: WorkspaceContext): string[] {
  return [...new Set(tokens(`${workspace.name} ${workspace.objective}`).filter((term) => !STOP_WORDS.has(term) && (term.length >= 2 || ['c', 'r'].includes(term))))].slice(0, 24)
}

export function assessLexicalRelevance(workspace: WorkspaceContext, fileName: string, pages: readonly string[]): LexicalRelevanceAssessment {
  const terms = contextTerms(workspace)
  if (!terms.length) return { decision: 'ambiguous', relevance: 50, matchedTerms: [] }
  const sample = normalize(`${fileName} ${samplePages(pages, 32_000)}`)
  const vocabulary = new Set(tokens(sample))
  const matchedTerms = terms.filter((term) => vocabulary.has(term))
  const coverage = matchedTerms.length / terms.length
  const relevance = Math.min(100, Math.round(coverage * 80 + Math.min(matchedTerms.length, 4) * 5))
  if ((terms.length <= 2 && matchedTerms.length === terms.length) || (matchedTerms.length >= 2 && coverage >= 0.4)) return { decision: 'relevant', relevance: Math.max(60, relevance), matchedTerms }
  if (matchedTerms.length === 0 && (sample.length >= 120 || vocabulary.size >= 8)) return { decision: 'irrelevant', relevance: 0, matchedTerms }
  return { decision: 'ambiguous', relevance: Math.max(10, relevance), matchedTerms }
}

function samplePages(pages: readonly string[], limit: number): string {
  if (!pages.length || limit <= 0) return ''
  const indexes = [...new Set([0, 1, Math.floor(pages.length / 2), pages.length - 2, pages.length - 1].filter((index) => index >= 0 && index < pages.length))]
  const perPage = Math.max(1, Math.floor(limit / indexes.length))
  return indexes.map((index) => pages[index]!.slice(0, perPage)).join(' ').slice(0, limit)
}

function mapMaterial(row: MaterialRow): MaterialSummary {
  return { id: row.id, name: row.name, mediaType: row.mediaType, pageCount: row.pageCount, status: row.status, relevance: row.relevance, role: row.role ?? 'reference', semanticAnalysis: row.semanticAnalysisJson ? materialSemanticAnalysisSchema.parse(JSON.parse(row.semanticAnalysisJson)) : null, sourceUrl: row.sourceUrl, errorMessage: row.errorMessage, createdAt: row.createdAt }
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Falha desconhecida durante a importação'
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 500)
}

export class PdfMaterialService {
  private readonly extractPages: (data: Uint8Array) => Promise<string[]>
  private readonly now: () => number
  private readonly createId: () => string

  constructor(private readonly database: CoachDatabase, private readonly options: PdfMaterialServiceOptions = {}) {
    this.extractPages = options.extractPages ?? extractPdfPages
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? randomUUID
  }

  async importPdf(workspaceId: string, path: string): Promise<MaterialSummary> {
    return this.importFile(workspaceId, path)
  }

  async importFile(workspaceId: string, path: string): Promise<MaterialSummary> {
    const workspace = this.getWorkspace(workspaceId)
    const lower = path.toLocaleLowerCase(); const isPdf = lower.endsWith('.pdf'); const isPptx = lower.endsWith('.pptx')
    if (!isPdf && !isPptx) throw new Error('Somente arquivos PDF e PPTX são suportados')
    const data = isPdf ? await readPdf(path) : await readPptx(path)
    const hash = createHash('sha256').update(data).digest('hex')
    const duplicate = this.findDuplicate(workspaceId, hash)
    if (duplicate) {
      data.fill(0)
      return duplicate
    }
    const materialId = this.createId()
    const createdAt = this.now()
    const name = basename(path).slice(0, 240)
    const mediaType = isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    this.database.sqlite.prepare("INSERT INTO materials (id, workspace_id, name, media_type, page_count, status, relevance, content_hash, error_message, created_at) VALUES (?, ?, ?, ?, 0, 'staged', 0, ?, NULL, ?)").run(materialId, workspaceId, name, mediaType, hash, createdAt)
    try {
      const pages = isPdf ? await this.extractPages(data) : await (this.options.extractPptxSlides ? this.options.extractPptxSlides(path) : extractPptxSlides(data))
      const extracted = prepareExtractedPages(pages)
      this.persistExtraction(materialId, extracted)
      const assessment = assessLexicalRelevance(workspace, name, extracted)
      this.database.sqlite.prepare('UPDATE materials SET relevance = ? WHERE id = ?').run(assessment.relevance, materialId)
      const request = { workspaceName: workspace.name, workspaceObjective: workspace.objective, fileName: name, excerpt: extracted.join('\n').slice(0, MAX_REVIEW_CHARACTERS), lexicalRelevance: assessment.relevance }
      let semantic: MaterialSemanticAnalysis | null = null
      try { semantic = this.options.analyzeSemantic ? materialSemanticAnalysisSchema.parse(await this.options.analyzeSemantic(request)) : null } catch { semantic = null }
      if (semantic) this.database.sqlite.prepare('UPDATE materials SET semantic_analysis_json = ? WHERE id = ?').run(JSON.stringify(semantic), materialId)
      if (semantic?.relevance === 'unrelated' && semantic.confidence >= 0.8) return this.rejectMaterial(materialId, 'Este documento não parece relacionado ao estudo.')
      return this.getMaterial(materialId)
    } catch (error) {
      this.database.sqlite.prepare("UPDATE materials SET status = 'failed', error_message = ? WHERE id = ?").run(safeErrorMessage(error), materialId)
      throw error
    } finally {
      data.fill(0)
    }
  }

  decide(workspaceId: string, materialId: string, decision: 'approve' | 'discard', role: 'base' | 'priority' | 'reference'): MaterialSummary { this.getWorkspace(workspaceId); const current = this.database.sqlite.prepare("SELECT status, (SELECT COUNT(*) FROM material_chunks WHERE material_id = materials.id) AS chunkCount FROM materials WHERE id = ? AND workspace_id = ?").get(materialId, workspaceId) as { status: string; chunkCount: number } | undefined; if (!current) throw new Error('Material not found'); if (current.status !== 'staged') throw new Error('Material decision is no longer available'); if (decision === 'discard') { const result = this.database.sqlite.prepare("UPDATE materials SET status = 'failed', relevance = 0, error_message = ? WHERE id = ? AND workspace_id = ? AND status = 'staged'").run('Descartado pelo estudante.', materialId, workspaceId); if (result.changes !== 1) throw new Error('Material decision conflict'); return this.getMaterial(materialId) } if (current.chunkCount === 0) throw new Error('Material has no extracted text to approve'); const result = this.database.sqlite.prepare("UPDATE materials SET status = 'ready', role = ?, error_message = NULL WHERE id = ? AND workspace_id = ? AND status = 'staged'").run(role, materialId, workspaceId); if (result.changes !== 1) throw new Error('Material decision conflict'); return this.getMaterial(materialId) }

  list(workspaceId: string): MaterialSummary[] {
    return (this.database.sqlite.prepare("SELECT id, name, media_type AS mediaType, page_count AS pageCount, status, relevance, role, semantic_analysis_json AS semanticAnalysisJson, source_url AS sourceUrl, error_message AS errorMessage, created_at AS createdAt FROM materials WHERE workspace_id = ? AND status != 'archived' ORDER BY created_at DESC").all(workspaceId) as MaterialRow[]).map(mapMaterial)
  }

  updateRelevance(workspaceId: string, materialId: string, relevance: number): MaterialSummary {
    const existing = this.database.sqlite.prepare("SELECT status, (SELECT COUNT(*) FROM material_chunks WHERE material_id = materials.id) AS chunkCount FROM materials WHERE id = ? AND workspace_id = ? AND status != 'archived'").get(materialId, workspaceId) as { status: MaterialSummary['status']; chunkCount: number } | undefined
    if (!existing) throw new Error('Material not found')
    if (existing.status !== 'ready') throw new Error('Use the material decision flow for staged content')
    if (relevance > 0 && existing.chunkCount === 0) throw new Error('Material has no extracted text to approve')
    const status: MaterialSummary['status'] = relevance > 0 ? 'ready' : 'failed'
    const errorMessage = relevance > 0 ? null : 'Material rejeitado manualmente por baixa relevância.'
    this.database.sqlite.prepare('UPDATE materials SET relevance = ?, status = ?, error_message = ? WHERE id = ? AND workspace_id = ?').run(relevance, status, errorMessage, materialId, workspaceId)
    return this.getMaterial(materialId)
  }

  search(workspaceId: string, query: string): MaterialSearchResult[] {
    const searchTerms = [...new Set(tokens(query).filter((term) => term.length >= 2))].slice(0, 8)
    if (!searchTerms.length) return []
    const clauses = searchTerms.map(() => "lower(c.content) LIKE ? ESCAPE '\\'").join(' OR ')
    const escapeLike = (term: string) => term.replace(/[\\%_]/g, '\\$&')
    const rows = this.database.sqlite.prepare(`SELECT c.id AS chunkId, m.id AS materialId, m.name AS materialName, m.relevance, c.page_number AS pageNumber, c.content FROM material_chunks c JOIN materials m ON m.id = c.material_id WHERE m.workspace_id = ? AND m.status = 'ready' AND m.relevance > 0 AND (${clauses}) ORDER BY m.relevance DESC LIMIT 100`).all(workspaceId, ...searchTerms.map((term) => `%${escapeLike(term)}%`)) as SearchRow[]
    const topics = this.topicCandidates(workspaceId)
    const bestByPage = new Map<string, { row: SearchRow; score: number }>()
    for (const row of rows) {
      const content = normalize(row.content)
      const score = searchTerms.reduce((sum, term) => sum + (content.includes(term) ? 1 : 0), 0)
      const key = `${row.materialId}:${row.pageNumber}`
      if (score > (bestByPage.get(key)?.score ?? -1)) bestByPage.set(key, { row, score })
    }
    return [...bestByPage.values()].sort((a, b) => b.score - a.score || b.row.relevance - a.row.relevance).slice(0, 6).map(({ row }) => {
      const lower = normalize(row.content)
      const positions = searchTerms.map((term) => lower.indexOf(term)).filter((index) => index >= 0)
      const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 400)
      return { chunkId: row.chunkId, materialId: row.materialId, materialName: row.materialName, pageNumber: row.pageNumber, topicId: reliableTopicId(row.content, topics), retrieval: 'lexical', content: row.content.slice(start, start + 1_600) }
    })
  }

  private getWorkspace(workspaceId: string): WorkspaceContext {
    const workspace = this.database.sqlite.prepare('SELECT name, objective FROM workspaces WHERE id = ?').get(workspaceId) as WorkspaceContext | undefined
    if (!workspace) throw new Error('Workspace not found')
    return workspace
  }

  private findDuplicate(workspaceId: string, hash: string): MaterialSummary | null {
    const row = this.database.sqlite.prepare("SELECT id, name, media_type AS mediaType, page_count AS pageCount, status, relevance, role, semantic_analysis_json AS semanticAnalysisJson, source_url AS sourceUrl, error_message AS errorMessage, created_at AS createdAt FROM materials WHERE workspace_id = ? AND content_hash = ? AND status != 'archived' ORDER BY created_at DESC LIMIT 1").get(workspaceId, hash) as MaterialRow | undefined
    return row ? mapMaterial(row) : null
  }

  private persistExtraction(materialId: string, pages: readonly string[]): void {
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare('UPDATE materials SET page_count = ? WHERE id = ?').run(pages.length, materialId)
      const insert = this.database.sqlite.prepare('INSERT INTO material_chunks (id, material_id, page_number, content) VALUES (?, ?, ?, ?)')
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        const page = pages[pageIndex]!
        for (let start = 0; start < page.length; start += CHUNK_CHARACTERS - CHUNK_OVERLAP) insert.run(this.createId(), materialId, pageIndex + 1, page.slice(start, start + CHUNK_CHARACTERS))
      }
    })()
  }

  private async reviewAmbiguous(workspace: WorkspaceContext, fileName: string, pages: readonly string[], relevance: number): Promise<MinimalMaterialReviewResult | null> {
    if (!this.options.reviewAmbiguous) return null
    try {
      return await this.options.reviewAmbiguous({ workspaceName: workspace.name.slice(0, 240), workspaceObjective: workspace.objective.slice(0, 1_000), fileName, excerpt: samplePages(pages, MAX_REVIEW_CHARACTERS), lexicalRelevance: relevance })
    } catch {
      return null
    }
  }

  private approveMaterial(workspaceId: string, materialId: string, relevance: number): MaterialSummary {
    const changed = this.database.sqlite.prepare("UPDATE materials SET status = 'ready', relevance = ?, error_message = NULL WHERE id = ? AND workspace_id = ? AND status = 'staged'").run(Math.max(1, relevance), materialId, workspaceId)
    if (changed.changes !== 1) throw new Error('Material is not awaiting approval')
    return this.getMaterial(materialId)
  }

  private rejectMaterial(materialId: string, reason: string): MaterialSummary {
    this.database.sqlite.prepare("UPDATE materials SET status = 'failed', relevance = 0, error_message = ? WHERE id = ? AND status = 'staged'").run(reason, materialId)
    return this.getMaterial(materialId)
  }

  private getMaterial(materialId: string): MaterialSummary {
    const row = this.database.sqlite.prepare('SELECT id, name, media_type AS mediaType, page_count AS pageCount, status, relevance, role, semantic_analysis_json AS semanticAnalysisJson, source_url AS sourceUrl, error_message AS errorMessage, created_at AS createdAt FROM materials WHERE id = ?').get(materialId) as MaterialRow | undefined
    if (!row) throw new Error('Material not found')
    return mapMaterial(row)
  }

  private topicCandidates(workspaceId: string): TopicCandidate[] {
    const rows = this.database.sqlite.prepare("SELECT m.id AS moduleId, m.topics_json AS topicsJson FROM roadmap_modules m JOIN roadmaps r ON r.id = m.roadmap_id WHERE r.workspace_id = ? AND r.status = 'accepted'").all(workspaceId) as Array<{ moduleId: string; topicsJson: string }>
    const result: TopicCandidate[] = []
    for (const row of rows) {
      try {
        const topics = JSON.parse(row.topicsJson) as unknown
        if (Array.isArray(topics)) for (const topic of topics) if (typeof topic === 'string' && topic.trim()) result.push({ moduleId: row.moduleId, topic: topic.trim() })
      } catch {}
    }
    return result
  }
}

function reliableTopicId(content: string, candidates: readonly TopicCandidate[]): string | null {
  const vocabulary = new Set(tokens(content))
  const matches = candidates.filter(({ topic }) => {
    const topicTerms = tokens(topic).filter((term) => !STOP_WORDS.has(term))
    return topicTerms.length > 0 && topicTerms.every((term) => vocabulary.has(term))
  })
  return matches.length === 1 ? `${matches[0]!.moduleId}:${matches[0]!.topic}` : null
}

function prepareExtractedPages(rawPages: readonly string[]): string[] {
  if (rawPages.length > MAX_PAGES) throw new Error(`PDF exceeds ${MAX_PAGES} pages`)
  let extractedCharacters = 0
  const pages = rawPages.map((page) => {
    const content = page.replace(/\s+/g, ' ').trim().slice(0, MAX_PAGE_CHARACTERS)
    extractedCharacters += content.length
    if (extractedCharacters > MAX_EXTRACTED_CHARACTERS) throw new Error('PDF extracted text exceeds the Coach limit')
    return content
  })
  if (!pages.some((page) => page.length > 0)) throw new Error('PDF does not contain extractable text')
  return pages
}

async function readPdf(path: string): Promise<Uint8Array> {
  if (process.platform !== 'linux') throw new Error('PDF import is available on Linux in this version')
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size < 5 || before.size > MAX_PDF_BYTES) throw new Error('PDF exceeds 20 MB or is not a regular file')
    const data = new Uint8Array(before.size)
    let offset = 0
    while (offset < before.size) {
      const read = await handle.read(data, offset, before.size - offset, offset)
      if (read.bytesRead === 0) throw new Error('PDF file changed while being read')
      offset += read.bytesRead
    }
    const after = await handle.stat()
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('PDF file changed while being read')
    if (Buffer.from(data.subarray(0, 5)).toString('ascii') !== '%PDF-') throw new Error('Selected file is not a valid PDF')
    return data
  } finally {
    await handle.close()
  }
}

async function readPptx(path: string): Promise<Uint8Array> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { const before = await handle.stat(); if (!before.isFile() || before.size < 4 || before.size > MAX_PDF_BYTES) throw new Error('PPTX inválido ou maior que 20 MB'); const data = new Uint8Array(before.size); let offset = 0; while (offset < before.size) { const read = await handle.read(data, offset, before.size - offset, offset); if (!read.bytesRead) throw new Error('PPTX alterado durante a leitura'); offset += read.bytesRead } const after = await handle.stat(); if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino || after.dev !== before.dev) { data.fill(0); throw new Error('PPTX alterado durante a leitura') } if (String.fromCharCode(...data.slice(0, 4)) !== 'PK\u0003\u0004') { data.fill(0); throw new Error('A estrutura real do arquivo não é PPTX') } return data } finally { await handle.close() }
}

async function extractPptxSlides(data: Uint8Array): Promise<string[]> {
  const directory = await mkdtemp(join(tmpdir(), 'coach-pptx-')); const privatePptx = join(directory, 'material.pptx')
  try { await writeFile(privatePptx, data, { mode: 0o400 }); const script = "import sys,zipfile,re,html; z=zipfile.ZipFile('/material.pptx'); i=z.infolist(); assert len(i)<=2000 and all(x.flag_bits&1==0 and x.file_size<=5000000 and x.compress_size>0 and x.file_size/max(x.compress_size,1)<=100 for x in i) and sum(x.file_size for x in i)<=20000000 and '[Content_Types].xml' in z.namelist() and 'ppt/presentation.xml' in z.namelist(); n=sorted([x for x in z.namelist() if re.fullmatch(r'ppt/slides/slide[0-9]+.xml',x)],key=lambda x:int(re.search(r'[0-9]+',x).group())); assert 0<len(n)<=500; print('\\f'.join(' '.join(html.unescape(v) for v in re.findall(r'<a:t>(.*?)</a:t>',z.read(x).decode('utf-8','replace'))) for x in n))"; const { stdout } = await promisify(execFile)('/usr/bin/bwrap', ['--die-with-parent','--unshare-all','--clearenv','--setenv','PATH','/usr/bin','--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind-try','/lib64','/lib64','--ro-bind',privatePptx,'/material.pptx','--tmpfs','/tmp','--proc','/proc','--dev','/dev','/usr/bin/prlimit','--cpu=15:15','--as=536870912:536870912','--fsize=8388608:8388608','--nofile=32:32','--nproc=8:8','/usr/bin/python3','-c',script], { timeout: 20_000, killSignal: 'SIGKILL', maxBuffer: MAX_EXTRACTED_CHARACTERS + 1024, windowsHide: true }); const slides = stdout.split('\f'); if (!slides.length || slides.every((slide: string) => !slide.trim())) throw new Error('PPTX sem texto extraível'); return slides } finally { await rm(directory, { recursive: true, force: true }) }
}

async function extractPdfPages(data: Uint8Array): Promise<string[]> {
  const directory = await mkdtemp(join(tmpdir(), 'coach-pdf-'))
  const privatePdf = join(directory, 'material.pdf')
  try {
    await writeFile(privatePdf, data, { mode: 0o400, flag: 'wx' })
    const result = await promisify(execFile)('/usr/bin/bwrap', ['--die-with-parent', '--unshare-all', '--clearenv', '--setenv', 'PATH', '/usr/bin', '--setenv', 'LANG', 'C.UTF-8', '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64', '--ro-bind', privatePdf, '/material.pdf', '--tmpfs', '/tmp', '--proc', '/proc', '--dev', '/dev', '/usr/bin/prlimit', '--cpu=15:15', '--as=536870912:536870912', '--fsize=8388608:8388608', '--nofile=32:32', '--nproc=8:8', '/usr/bin/pdftotext', '-layout', '-enc', 'UTF-8', '/material.pdf', '-'], { timeout: 20_000, killSignal: 'SIGKILL', maxBuffer: 6_000_000, windowsHide: true })
    const pages = result.stdout.split('\f')
    if (pages.at(-1)?.trim() === '') pages.pop()
    return pages
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
