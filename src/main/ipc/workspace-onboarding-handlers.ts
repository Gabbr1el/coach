import { ipcMain } from 'electron'
import type { WorkspaceOnboardingService } from '../../application/workspaces/workspace-onboarding-service'
import { WORKSPACE_ONBOARDING_CHANNELS } from '../../shared/contracts/workspace-onboarding-channels'
import { analyzeWorkspaceTopicInputSchema } from '../../shared/contracts/workspace-onboarding-contract'
import { assertTrustedSender } from './trusted-sender'
import { academicSubjectDeclarationSchema } from '../../shared/contracts/academic-subject-context-contract'
export function registerWorkspaceOnboardingHandlers(service: WorkspaceOnboardingService, replaceAcademicContext?: (input: ReturnType<typeof academicSubjectDeclarationSchema.parse>) => unknown): void { ipcMain.handle(WORKSPACE_ONBOARDING_CHANNELS.analyze, (event, payload) => { assertTrustedSender(event); const input = analyzeWorkspaceTopicInputSchema.parse(payload); return service.analyze(input.topic, input.diagnosticAnswer) }); if (replaceAcademicContext) ipcMain.handle('workspace-onboarding:replace-academic-context', (event, payload) => { assertTrustedSender(event); return replaceAcademicContext(academicSubjectDeclarationSchema.parse(payload)) }) }
