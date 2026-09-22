import type { ConversationMessage } from '../../shared/contracts/conversation-contract'
import type { OrganizerConversationState } from '../../shared/contracts/organizer-conversation-state-contract'
import type { PlannerAction } from '../../shared/contracts/planner-action-contract'
import type { CreateConversationMessageRecord } from './conversation-repository'

export interface StagedPlannerAction {
  readonly action: PlannerAction
  readonly idempotencyKey: string
}

export interface StagedOrganizerTurn {
  readonly threadId: string
  readonly now: number
  readonly user: Omit<CreateConversationMessageRecord, 'sequence'>
  readonly assistant: Omit<CreateConversationMessageRecord, 'sequence'>
}

export interface OrganizerCommit {
  readonly turn: StagedOrganizerTurn
  readonly actions: readonly StagedPlannerAction[]
  readonly state?: OrganizerConversationState
}

export interface OrganizerCommitResult {
  readonly messages: ConversationMessage[]
  readonly actions: PlannerAction[]
}

export interface OrganizerUnitOfWork {
  commit(input: OrganizerCommit, signal?: AbortSignal): Promise<OrganizerCommitResult>
}
