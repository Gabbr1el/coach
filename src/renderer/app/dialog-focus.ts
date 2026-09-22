/// <reference lib="dom" />

import { useEffect, useRef } from 'react'

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])'

export function dialogFocusable(container: HTMLElement | null): HTMLElement[] {
  return container ? Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true') : []
}

export function trapDialogTab(event: KeyboardEvent, elements: readonly HTMLElement[], activeElement: Element | null): boolean {
  if (event.key !== 'Tab' || elements.length === 0) return false
  const first = elements[0]!
  const last = elements.at(-1)!
  if (event.shiftKey && (activeElement === first || !elements.includes(activeElement as HTMLElement))) {
    event.preventDefault()
    last.focus()
    return true
  }
  if (!event.shiftKey && (activeElement === last || !elements.includes(activeElement as HTMLElement))) {
    event.preventDefault()
    first.focus()
    return true
  }
  return false
}

export function useDialogFocus<T extends HTMLElement>(open: boolean, onClose: () => void, initialFocus = 'input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)') {
  const dialogRef = useRef<T | null>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    const background: HTMLElement[] = []
    let branch: HTMLElement | null = dialog
    while (branch?.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling !== branch && sibling instanceof HTMLElement) background.push(sibling)
      }
      branch = branch.parentElement
      if (branch === document.body) break
    }
    const previousInert = background.map((element) => element.inert)
    background.forEach((element) => { element.inert = true })
    const frame = window.requestAnimationFrame(() => {
      const target = dialogRef.current?.querySelector<HTMLElement>(initialFocus) ?? dialogFocusable(dialogRef.current)[0]
      target?.focus()
    })
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      trapDialogTab(event, dialogFocusable(dialogRef.current), document.activeElement)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', handleKeyDown)
      background.forEach((element, index) => { element.inert = previousInert[index] ?? false })
      if (previous?.isConnected) previous.focus()
    }
  }, [open, initialFocus])
  return dialogRef
}
