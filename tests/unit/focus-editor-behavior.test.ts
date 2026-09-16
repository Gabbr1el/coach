/// <reference lib="dom" />

import { describe, expect, it, vi } from 'vitest'
import { trapDialogTab } from '../../src/renderer/app/dialog-focus'
import { reconcileEditorValue, stableEditorPath, type ReconcileEditor } from '../../src/renderer/app/editor-reconciliation'

function editor(value: string) {
  let current = value
  const selection = { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 7 }
  const fake: ReconcileEditor = {
    getModel: () => ({ getValue: () => current, getFullModelRange: () => ({ full: true }) }),
    getSelection: () => selection,
    getScrollTop: () => 180,
    getScrollLeft: () => 12,
    hasTextFocus: () => true,
    executeEdits: vi.fn((_source, edits) => { current = edits[0]?.text ?? current; return true }),
    setSelection: vi.fn(),
    setScrollTop: vi.fn(),
    setScrollLeft: vi.fn(),
    focus: vi.fn(),
  }
  return { fake, value: () => current }
}

describe('behavioral focus and editor scenarios 19-22', () => {
  it('19 skips identical external updates', () => {
    const { fake } = editor('print(1)')
    expect(reconcileEditorValue(fake, 'print(1)')).toBe(false)
    expect(fake.executeEdits).not.toHaveBeenCalled()
    expect(fake.focus).not.toHaveBeenCalled()
  })

  it('20 restores selection and viewport after genuine reconciliation', () => {
    const { fake, value } = editor('old')
    expect(reconcileEditorValue(fake, 'new')).toBe(true)
    expect(value()).toBe('new')
    expect(fake.setSelection).toHaveBeenCalledWith({ startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 7 })
    expect(fake.setScrollTop).toHaveBeenCalledWith(180)
    expect(fake.setScrollLeft).toHaveBeenCalledWith(12)
    expect(fake.focus).toHaveBeenCalledOnce()
  })

  it('21 creates stable collision-free model paths', () => {
    expect(stableEditorPath('project', 'workspace:file-1', 'src/Main.java')).toBe('file:///coach/project/workspace%3Afile-1/src/Main.java')
    expect(stableEditorPath('exercise', 'workspace:file-1', 'src/Main.java')).not.toBe(stableEditorPath('project', 'workspace:file-1', 'src/Main.java'))
  })

  it('22 traps boundary Tab without intercepting ordinary typing', () => {
    const first = { focus: vi.fn() } as unknown as HTMLElement
    const last = { focus: vi.fn() } as unknown as HTMLElement
    const typing = { key: 'a', shiftKey: false, preventDefault: vi.fn() } as unknown as KeyboardEvent
    expect(trapDialogTab(typing, [first, last], first)).toBe(false)
    expect(typing.preventDefault).not.toHaveBeenCalled()
    const tab = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() } as unknown as KeyboardEvent
    expect(trapDialogTab(tab, [first, last], last)).toBe(true)
    expect(first.focus).toHaveBeenCalledOnce()
  })
})
