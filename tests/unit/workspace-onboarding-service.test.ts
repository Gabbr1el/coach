import { describe, expect, it } from 'vitest'
import { AIProviderManager } from '../../src/application/ai/ai-provider-manager'
import { WorkspaceOnboardingService } from '../../src/application/workspaces/workspace-onboarding-service'
import type { ConversationRepository } from '../../src/application/conversations/conversation-repository'
import type { ConversationMessage } from '../../src/shared/contracts/conversation-contract'

function repository(messages: ConversationMessage[]): ConversationRepository { return { ensureHomeThread: async () => {}, ensureWorkspaceThread: async () => {}, listMessages: async () => messages, addTurn: async () => [] } }

describe('WorkspaceOnboardingService', () => {
  it('asks for a diagnostic when the general memory has no knowledge of the topic', async () => { const service = new WorkspaceOnboardingService({ repository: repository([]), providerManager: new AIProviderManager() }); expect((await service.analyze('Cálculo')).needsDiagnostic).toBe(true) })
  it('does not repeat the diagnostic after the user answers', async () => { const service = new WorkspaceOnboardingService({ repository: repository([]), providerManager: new AIProviderManager() }); expect(await service.analyze('Cálculo', 'Já domino limites, mas não derivadas')).toMatchObject({ needsDiagnostic: false, contextSource: 'diagnostic' }) })
})
