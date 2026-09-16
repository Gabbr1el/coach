import Editor, { loader, type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import { useEffect, useRef } from 'react'
import { reconcileEditorValue } from './editor-reconciliation'

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
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const onChangeRef = useRef(onChange)
  const reconciling = useRef(false)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    reconciling.current = true
    reconcileEditorValue(editor, value)
    reconciling.current = false
  }, [value, path])
  const mount: OnMount = (editor) => {
    editorRef.current = editor
    reconciling.current = true
    reconcileEditorValue(editor, value)
    reconciling.current = false
  }
  return <Editor height={height} language={language === 'c' ? 'cpp' : language} path={path} theme="vs-dark" defaultValue={value} onMount={mount} onChange={(next) => { if (!reconciling.current) onChangeRef.current((next ?? '').slice(0, maxLength)) }} options={{ readOnly: disabled, minimap: { enabled: false }, fontSize: 14, fontFamily: 'JetBrains Mono, Fira Code, monospace', lineHeight: 22, padding: { top: 16 }, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 4, wordWrap: 'on' }} />
}
