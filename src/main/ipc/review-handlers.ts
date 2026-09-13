import { ipcMain } from 'electron'
import type { ReviewService } from '../../application/review/review-service'
import { REVIEW_CHANNELS } from '../../shared/contracts/review-channels'
import { helpReviewInputSchema, reviewSessionSchema, startReviewInputSchema, submitReviewInputSchema } from '../../shared/contracts/review-contract'
import { workspaceIdSchema } from '../../shared/contracts/workspace-contract'
import { assertTrustedSender } from './trusted-sender'

export function registerReviewHandlers(service: ReviewService): void {
  ipcMain.handle(REVIEW_CHANNELS.getActive, (event, payload) => { assertTrustedSender(event); const value = service.getActive(workspaceIdSchema.parse(payload?.workspaceId)); return value ? reviewSessionSchema.parse(value) : null })
  ipcMain.handle(REVIEW_CHANNELS.start, (event, payload) => { assertTrustedSender(event); return reviewSessionSchema.parse(service.start(startReviewInputSchema.parse(payload))) })
  ipcMain.handle(REVIEW_CHANNELS.submit, (event, payload) => { assertTrustedSender(event); return reviewSessionSchema.parse(service.submit(submitReviewInputSchema.parse(payload))) })
  ipcMain.handle(REVIEW_CHANNELS.requestHelp, (event, payload) => { assertTrustedSender(event); return reviewSessionSchema.parse(service.requestHelp(helpReviewInputSchema.parse(payload))) })
}
