import { ipcMain } from 'electron'
import type { WorkspaceOnboardingService } from '../../application/workspaces/workspace-onboarding-service'
import { WORKSPACE_ONBOARDING_CHANNELS } from '../../shared/contracts/workspace-onboarding-channels'
import { analyzeWorkspaceTopicInputSchema } from '../../shared/contracts/workspace-onboarding-contract'
import { assertTrustedSender } from './trusted-sender'
export function registerWorkspaceOnboardingHandlers(service: WorkspaceOnboardingService): void { ipcMain.handle(WORKSPACE_ONBOARDING_CHANNELS.analyze, (event, payload) => { assertTrustedSender(event); const input = analyzeWorkspaceTopicInputSchema.parse(payload); return service.analyze(input.topic, input.diagnosticAnswer) }) }
