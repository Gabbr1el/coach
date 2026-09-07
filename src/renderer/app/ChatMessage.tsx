import type { ConversationMessage } from '../../shared/contracts/conversation-contract'

function segments(content: string): Array<{ code: boolean; value: string }> {
  return content.split(/(```[\s\S]*?```)/g).filter(Boolean).map((value) => value.startsWith('```') ? { code: true, value: value.replace(/^```[^\n]*\n?/, '').replace(/```$/, '') } : { code: false, value })
}

export function ChatMessage({ message, dark = false, streamed = false }: { message: Pick<ConversationMessage, 'role' | 'content'>; dark?: boolean; streamed?: boolean }) {
  const user = message.role === 'user'
  return <div className={`coach-chat-message rounded-lg px-4 py-3 text-sm leading-6 ${user ? 'ml-auto max-w-[88%] bg-coach-green text-[#0c0d10]' : `mr-auto max-w-[94%] ${dark ? 'bg-[#191b21] text-[#b6bac3]' : 'bg-[#191b21] text-[#e4e6eb]'}`} ${streamed ? 'opacity-90' : ''}`}>{segments(message.content).map((segment, index) => segment.code ? <pre key={index} className="my-2 max-w-full overflow-x-auto rounded-md bg-black/40 p-3 font-mono text-xs"><code>{segment.value}</code></pre> : <span key={index}>{segment.value}</span>)}</div>
}
