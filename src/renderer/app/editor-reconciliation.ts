export type EditorViewport = {
  selection: unknown
  scrollTop: number
  scrollLeft: number
  hadTextFocus: boolean
}

export type ReconcileEditor = {
  getModel(): {
    getValue(): string
    getFullModelRange(): unknown
  } | null
  getSelection(): unknown
  getScrollTop(): number
  getScrollLeft(): number
  hasTextFocus(): boolean
  executeEdits: (...args: any[]) => boolean
  setSelection(selection: unknown): void
  setScrollTop(scrollTop: number): void
  setScrollLeft(scrollLeft: number): void
  focus(): void
}

export function reconcileEditorValue(editor: ReconcileEditor, externalValue: string): boolean {
  const model = editor.getModel()
  if (!model || model.getValue() === externalValue) return false
  const viewport: EditorViewport = {
    selection: editor.getSelection(),
    scrollTop: editor.getScrollTop(),
    scrollLeft: editor.getScrollLeft(),
    hadTextFocus: editor.hasTextFocus(),
  }
  editor.executeEdits('external-reconciliation', [{ range: model.getFullModelRange(), text: externalValue, forceMoveMarkers: true }])
  if (viewport.selection) editor.setSelection(viewport.selection)
  editor.setScrollTop(viewport.scrollTop)
  editor.setScrollLeft(viewport.scrollLeft)
  if (viewport.hadTextFocus) editor.focus()
  return true
}

export function stableEditorPath(scope: string, identity: string, fileName: string): string {
  const encode = (value: string) => encodeURIComponent(value).replaceAll('%2F', '/')
  return `file:///coach/${encode(scope)}/${encode(identity)}/${encode(fileName)}`
}
