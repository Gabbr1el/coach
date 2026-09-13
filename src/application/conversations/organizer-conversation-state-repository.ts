import type { OrganizerConversationState } from '../../shared/contracts/organizer-conversation-state-contract'

export interface OrganizerConversationStateRepository {
  load(threadId: string): OrganizerConversationState
  save(threadId: string, state: OrganizerConversationState): OrganizerConversationState
  clear(threadId: string): void
}
