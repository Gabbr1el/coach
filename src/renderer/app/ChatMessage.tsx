import { Fragment, type ReactNode } from 'react'
import type { ConversationMessage } from '../../shared/contracts/conversation-contract'

function inlineMarkdown(content: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(content))) {
    if (match.index > cursor) nodes.push(content.slice(cursor, match.index))
    const token = match[0]
    const key = `${keyPrefix}-${match.index}`
    if (token.startsWith('`')) nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    else if (token.startsWith('**') || token.startsWith('__')) nodes.push(<strong key={key}>{inlineMarkdown(token.slice(2, -2), key)}</strong>)
    else nodes.push(<em key={key}>{inlineMarkdown(token.slice(1, -1), key)}</em>)
    cursor = match.index + token.length
  }

  if (cursor < content.length) nodes.push(content.slice(cursor))
  return nodes
}

function MarkdownContent({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = line.match(/^\s*```([^\s`]*)\s*$/)
    if (fence) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push(<pre key={`code-${index}`}><code data-language={fence[1] || undefined}>{code.join('\n')}</code></pre>)
      continue
    }

    const listMatch = line.match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/)
    if (listMatch) {
      const ordered = Boolean(listMatch[2])
      const items: string[] = []
      while (index < lines.length) {
        const item = (lines[index] ?? '').match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/)
        if (!item || Boolean(item[2]) !== ordered) break
        items.push(item[3] ?? '')
        index += 1
      }
      const children = items.map((item, itemIndex) => <li key={`${index}-${itemIndex}`}>{inlineMarkdown(item, `list-${index}-${itemIndex}`)}</li>)
      blocks.push(ordered ? <ol key={`list-${index}`}>{children}</ol> : <ul key={`list-${index}`}>{children}</ul>)
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length && (lines[index] ?? '').trim() && !/^\s*```/.test(lines[index] ?? '') && !/^\s*(?:[-+*]|\d+[.)])\s+/.test(lines[index] ?? '')) {
      paragraph.push((lines[index] ?? '').trim())
      index += 1
    }
    blocks.push(<p key={`paragraph-${index}`}>{paragraph.map((part, partIndex) => <Fragment key={`${index}-${partIndex}`}>{partIndex > 0 ? ' ' : null}{inlineMarkdown(part, `paragraph-${index}-${partIndex}`)}</Fragment>)}</p>)
  }

  return <>{blocks}</>
}

export function ChatMessage({ message, dark = false, streamed = false }: { message: Pick<ConversationMessage, 'role' | 'content'>; dark?: boolean; streamed?: boolean }) {
  const user = message.role === 'user'
  return <div className={`coach-chat-message coach-message-enter rounded-lg px-4 py-3 text-sm leading-6 ${user ? 'ml-auto max-w-[88%] bg-coach-green text-[#0c0d10]' : `mr-auto max-w-[94%] ${dark ? 'bg-[#191b21] text-[#c7cad2]' : 'bg-[#191b21] text-[#e4e6eb]'}`} ${streamed ? 'opacity-90' : ''}`}><MarkdownContent content={message.content} /></div>
}
