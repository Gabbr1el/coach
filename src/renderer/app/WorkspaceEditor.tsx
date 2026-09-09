import { EmbeddedCodeEditor } from './EmbeddedCodeEditor'

export function WorkspaceEditor({ value, language = 'plaintext', path = 'untitled.txt', onChange }: { value: string; language?: string; path?: string; onChange(value: string): void }) {
  return <EmbeddedCodeEditor value={value} language={language} path={path} onChange={onChange} />
}
