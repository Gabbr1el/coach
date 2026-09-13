import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker'

self.MonacoEnvironment = { getWorker: () => new editorWorker() }
loader.config({ monaco })

type Props = {
  value: string
  language?: 'python' | 'c' | 'java' | string
  path?: string
  height?: string | number
  disabled?: boolean
  maxLength?: number
  onChange(value: string): void
}

export function EmbeddedCodeEditor({ value, language = 'plaintext', path = 'untitled.txt', height = '100%', disabled = false, maxLength = 200_000, onChange }: Props) {
  return <Editor height={height} language={language === 'c' ? 'cpp' : language} path={path} theme="vs-dark" value={value} onChange={(next) => onChange((next ?? '').slice(0, maxLength))} options={{ readOnly: disabled, minimap: { enabled: false }, fontSize: 14, fontFamily: 'JetBrains Mono, Fira Code, monospace', lineHeight: 22, padding: { top: 16 }, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 4, wordWrap: 'on' }} />
}
