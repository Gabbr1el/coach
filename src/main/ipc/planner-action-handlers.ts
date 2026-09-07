import { ipcMain } from 'electron'
import type { PlannerActionService } from '../../application/planning/planner-action-service'
import { PLANNER_ACTION_CHANNELS } from '../../shared/contracts/planner-action-channels'
import { resolvePlannerActionInputSchema } from '../../shared/contracts/planner-action-contract'
import { assertTrustedSender } from './trusted-sender'
export function registerPlannerActionHandlers(service: PlannerActionService): void { ipcMain.handle(PLANNER_ACTION_CHANNELS.listPending, (event) => { assertTrustedSender(event); return service.listPending() }); ipcMain.handle(PLANNER_ACTION_CHANNELS.resolve, (event, payload: unknown) => { assertTrustedSender(event); const input = resolvePlannerActionInputSchema.parse(payload); return service.resolve(input.actionId, input.decision) }) }
