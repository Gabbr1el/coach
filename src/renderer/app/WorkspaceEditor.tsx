import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker'

self.MonacoEnvironment = { getWorker: () => new editorWorker() }
loader.config({ monaco })

export function WorkspaceEditor({ value, onChange }: { value: string; onChange(value: string): void }) {
  return <Editor height="100%" language="python" theme="vs-dark" value={value} onChange={(next) => onChange((next ?? '').slice(0, 200_000))} options={{ minimap: { enabled: false }, fontSize: 14, fontFamily: 'JetBrains Mono, Fira Code, monospace', lineHeight: 22, padding: { top: 16 }, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 4, wordWrap: 'on' }} />
}
