import { useEffect, useRef, useState } from 'react'
import { FileCode2, FolderOpen, Plus, Play } from 'lucide-react'
import type { CodeExecutionResult } from '../../shared/contracts/code-execution-contract'
import type { ProjectLanguage, WorkspaceProject } from '../../shared/contracts/project-contract'
import { WorkspaceEditor } from './WorkspaceEditor'

function editorLanguage(path: string): string {
  if (path.endsWith('.java')) return 'java'
  if (path.endsWith('.c') || path.endsWith('.h')) return 'c'
  return 'python'
}

export function ProjectWorkspace({ workspaceId, workspaceName, onError, onContextChange }: { workspaceId: string; workspaceName: string; onError(message: string): void; onContextChange?(context: { fileName: string; language: string; code: string; execution: CodeExecutionResult | null }): void }) {
  const [project, setProject] = useState<WorkspaceProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [execution, setExecution] = useState<CodeExecutionResult | null>(null)
  const [draft, setDraft] = useState('')
  const saveTimer = useRef<number | null>(null)
  const executionEpoch = useRef(0)
  const active = project?.files.find((file) => file.id === project.activeFileId) ?? null
  useEffect(() => { if (active) onContextChange?.({ fileName: active.path, language: editorLanguage(active.path), code: draft, execution }) }, [active?.id, active?.path, draft, execution])
  useEffect(() => { executionEpoch.current += 1; setBusy(false); setExecution(null) }, [workspaceId, active?.id, draft])

  useEffect(() => {
    setLoading(true)
    void window.coach.project.get(workspaceId).then((next) => { setProject(next); setDraft(next?.files.find((file) => file.id === next.activeFileId)?.content ?? '') }).catch(() => onError('Não foi possível carregar o projeto.')).finally(() => setLoading(false))
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current) }
  }, [workspaceId])

  function apply(next: WorkspaceProject, fileId = next.activeFileId): void { setProject(next); setDraft(next.files.find((file) => file.id === fileId)?.content ?? '') }
  async function flushActiveFile(): Promise<WorkspaceProject | null> {
    if (!project || !active || draft === active.content) return project
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null }
    const saved = await window.coach.project.saveFile({ projectId: project.id, fileId: active.id, content: draft, expectedRevision: active.revision })
    setProject(saved)
    return saved
  }
  function open(fileId: string): void { if (project) void flushActiveFile().then((saved) => saved ? window.coach.project.openFile({ projectId: saved.id, fileId }) : null).then((next) => { if (next) apply(next, fileId) }).catch(() => onError('Não foi possível abrir o arquivo.')) }
  function edit(content: string): void {
    if (!project || !active) return
    setDraft(content)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    const { id: projectId } = project
    const { id: fileId, revision: expectedRevision } = active
    saveTimer.current = window.setTimeout(() => { void window.coach.project.saveFile({ projectId, fileId, content, expectedRevision }).then(setProject).catch(() => onError('O arquivo mudou. Reabra-o antes de continuar.')) }, 700)
  }
  async function create(language: ProjectLanguage): Promise<void> { setBusy(true); try { apply(await window.coach.project.create({ workspaceId, name: workspaceName, language })) } catch { onError('Não foi possível criar o projeto.') } finally { setBusy(false) } }

  if (loading) return <div className="grid h-full min-h-0 place-items-center bg-[#102724] text-white/50">Carregando projeto…</div>
  if (!project) return <div className="grid h-full min-h-0 place-items-center bg-[#102724] p-8 text-white"><div className="max-w-lg text-center"><FolderOpen className="mx-auto text-coach-yellow" size={42} /><h2 className="mt-5 font-display text-3xl font-black">Comece uma prática real</h2><p className="mt-3 text-sm leading-6 text-white/55">Crie uma estrutura multi-arquivo. Java inicia com `Main.java` e `Pessoa.java`; C e Python recebem um projeto mínimo executável.</p><div className="mt-7 flex justify-center gap-3">{(['java', 'c', 'python'] as const).map((language) => <button key={language} disabled={busy} onClick={() => void create(language)} className="rounded-xl bg-coach-green px-5 py-3 text-sm font-black uppercase disabled:opacity-50">{language}</button>)}</div></div></div>

  return <section className="grid h-full min-h-0 min-w-0 grid-cols-[200px_minmax(0,1fr)] overflow-hidden bg-[#102724] text-white"><aside className="min-h-0 overflow-y-auto border-r border-white/10 bg-[#0b1e1b] p-3"><div className="flex items-center justify-between px-2 py-2"><span className="text-[10px] font-black uppercase tracking-widest text-white/35">Arquivos</span><button onClick={() => { const path = window.prompt('Caminho relativo, ex.: src/Animal.java'); if (path) void window.coach.project.createFile({ projectId: project.id, path, content: '' }).then(apply).catch(() => onError('Caminho inválido ou arquivo já existente.')) }} aria-label="Novo arquivo"><Plus size={15} /></button></div>{project.files.map((file) => <button key={file.id} onClick={() => open(file.id)} className={`mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${file.id === project.activeFileId ? 'bg-coach-green' : 'text-white/60 hover:bg-white/5'}`}><FileCode2 size={14} /><span className="truncate">{file.path}</span></button>)}</aside><div className="flex min-w-0 flex-col"><div className="flex items-center justify-between border-b border-white/10"><div className="flex overflow-x-auto">{project.openFileIds.map((id) => { const file = project.files.find((candidate) => candidate.id === id); return file ? <button key={id} onClick={() => open(id)} className={`border-r border-white/10 px-4 py-3 text-xs ${id === project.activeFileId ? 'bg-white/8' : 'text-white/45'}`}>{file.path.split('/').at(-1)}</button> : null })}</div><button disabled={busy} onClick={() => { const epoch = ++executionEpoch.current; setBusy(true); setExecution(null); void flushActiveFile().then((saved) => { if (!saved) throw new Error('Project not found'); return window.coach.codeExecution.executeProject({ workspaceId, projectId: saved.id }) }).then((result) => { if (executionEpoch.current === epoch) setExecution(result) }).catch(() => onError('Falha ao compilar. Verifique a toolchain e o sandbox.')).finally(() => { if (executionEpoch.current === epoch) setBusy(false) }) }} className="m-2 flex shrink-0 items-center gap-2 rounded-lg bg-coach-green px-4 py-2 text-xs font-black disabled:opacity-50"><Play size={13} />{busy ? 'Compilando…' : 'Compilar e executar'}</button></div><div className="min-h-[360px] flex-1">{active && <WorkspaceEditor value={draft} language={editorLanguage(active.path)} path={active.path} onChange={edit} />}</div>{execution && <div className="max-h-48 overflow-auto border-t border-white/10 bg-[#06120f] p-4 font-mono text-xs"><div className="mb-2 flex justify-between text-white/35"><span>$ {execution.command}</span><span>{execution.phase} · exit {execution.exitCode ?? '—'} · {execution.durationMs}ms</span></div>{execution.stdout && <pre className="whitespace-pre-wrap text-emerald-300">{execution.stdout}</pre>}{execution.stderr && <pre className="whitespace-pre-wrap text-red-300">{execution.stderr}</pre>}{execution.diagnostics?.map((diagnostic, index) => <button key={`${diagnostic.filePath}-${index}`} onClick={() => { const file = project.files.find((candidate) => candidate.path === diagnostic.filePath); if (file) open(file.id) }} className="mt-2 block w-full rounded bg-red-950/50 p-2 text-left text-red-200">{diagnostic.filePath}:{diagnostic.line}:{diagnostic.column} {diagnostic.message}</button>)}</div>}</div></section>
}
