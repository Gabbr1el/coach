import { Send } from 'lucide-react'
import { useLayoutEffect, useRef, type FormEvent, type KeyboardEvent } from 'react'
import { resizeChatComposer, shouldSendChatKey } from './chat-experience'

export function ChatComposer({ id, value, busy, placeholder, label, sendLabel, accentClass, accessory, onChange, onSend }: {
  id: string
  value: string
  busy: boolean
  placeholder: string
  label: string
  sendLabel: string
  accentClass: string
  accessory?: React.ReactNode
  onChange(value: string): void
  onSend(): void
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => { if (inputRef.current) resizeChatComposer(inputRef.current) }, [value])
  const submit = (event: FormEvent) => { event.preventDefault(); if (!busy && value.trim()) onSend() }
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!shouldSendChatKey(event)) return
    event.preventDefault()
    if (!busy && value.trim()) onSend()
  }
  return <form onSubmit={submit} className="shrink-0 border-t border-[#242730] p-3"><label htmlFor={id} className="sr-only">{label}</label><div className={`flex items-end gap-2 rounded-xl border border-[#30333c] bg-[#0b0c10] p-2 ${accentClass}`}><textarea ref={inputRef} id={id} aria-label={label} rows={1} maxLength={4000} value={value} disabled={busy} onChange={(event) => onChange(event.target.value)} onKeyDown={keyDown} placeholder={placeholder} className="min-h-9 max-h-28 min-w-0 flex-1 resize-none overflow-y-hidden bg-transparent px-2 py-2 text-xs leading-5 text-white outline-none placeholder:text-[#555b68]" /><div className="flex shrink-0 items-center gap-2">{accessory}<button disabled={busy || !value.trim()} aria-label={sendLabel} className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#8c7cff] text-[#0c0d10] disabled:cursor-not-allowed disabled:opacity-40"><Send size={15} aria-hidden="true" /></button></div></div></form>
}
