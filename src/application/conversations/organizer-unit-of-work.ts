import type { ConversationMessage } from '../../shared/contracts/conversation-contract'
import type { OrganizerConversationState } from '../../shared/contracts/organizer-conversation-state-contract'
import type { PlannerAction } from '../../shared/contracts/planner-action-contract'
import type { HomeOrganizerResult } from '../../shared/contracts/planning-contract'
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
  readonly requestId: string
  readonly turn: StagedOrganizerTurn
  readonly actions: readonly StagedPlannerAction[]
  readonly state?: OrganizerConversationState
  readonly result: HomeOrganizerResult
}

export interface OrganizerCommitResult {
  readonly messages: ConversationMessage[]
  readonly actions: PlannerAction[]
  readonly result: HomeOrganizerResult
}

export interface OrganizerUnitOfWork {
  find(requestId: string, threadId: string, content: string): Promise<OrganizerCommitResult | null>
  commit(input: OrganizerCommit, signal?: AbortSignal): Promise<OrganizerCommitResult>
}
