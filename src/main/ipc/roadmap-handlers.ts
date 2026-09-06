import { ipcMain } from 'electron'
import type { RoadmapService } from '../../application/roadmaps/roadmap-service'
import { ROADMAP_CHANNELS } from '../../shared/contracts/roadmap-channels'
import { acceptRoadmapInputSchema, workspaceRoadmapInputSchema } from '../../shared/contracts/roadmap-contract'
import { assertTrustedSender } from './trusted-sender'
export function registerRoadmapHandlers(service: RoadmapService): void { ipcMain.handle(ROADMAP_CHANNELS.get, (event, payload: unknown) => { assertTrustedSender(event); return service.get(workspaceRoadmapInputSchema.parse(payload).workspaceId) }); ipcMain.handle(ROADMAP_CHANNELS.generate, (event, payload: unknown) => { assertTrustedSender(event); return service.generate(workspaceRoadmapInputSchema.parse(payload).workspaceId) }); ipcMain.handle(ROADMAP_CHANNELS.accept, (event, payload: unknown) => { assertTrustedSender(event); const input = acceptRoadmapInputSchema.parse(payload); return service.accept(input.workspaceId, input.roadmapId) }) }
