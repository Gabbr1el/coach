import { ipcMain } from 'electron'
import type { AcademicLifeService } from '../../application/academic-life/academic-life-service'
import { academicLifeMutationInputSchema, academicLifeTransitionInputSchema } from '../../shared/contracts/academic-life-contract'
import { ACADEMIC_LIFE_CHANNELS } from '../../shared/contracts/academic-life-channels'
import { assertTrustedSender } from './trusted-sender'

export function registerAcademicLifeHandlers(service: AcademicLifeService): void {
  ipcMain.handle(ACADEMIC_LIFE_CHANNELS.getProjection, (event) => { assertTrustedSender(event); return service.getProjection() })
  ipcMain.handle(ACADEMIC_LIFE_CHANNELS.save, (event, payload) => { assertTrustedSender(event); return service.save(academicLifeMutationInputSchema.parse(payload)) })
  ipcMain.handle(ACADEMIC_LIFE_CHANNELS.transition, (event, payload) => { assertTrustedSender(event); const input = academicLifeTransitionInputSchema.parse(payload); return service.transition(input.id, input.status) })
}
