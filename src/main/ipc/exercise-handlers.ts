import { ipcMain } from 'electron'
import type { ExerciseService } from '../../application/exercises/exercise-service'
import { EXERCISE_CHANNELS } from '../../shared/contracts/exercise-channels'
import { ensureExerciseSetInputSchema, exerciseExecutionSchema, exerciseHelpInputSchema, exerciseRunInputSchema, exerciseSetSchema, exerciseSubmitInputSchema, getExerciseSetInputSchema } from '../../shared/contracts/exercise-contract'
import { assertTrustedSender } from './trusted-sender'

export function registerExerciseHandlers(service: ExerciseService): void {
  ipcMain.handle(EXERCISE_CHANNELS.ensureSet, async (event, payload) => { assertTrustedSender(event); return exerciseSetSchema.parse(await service.ensureSet(ensureExerciseSetInputSchema.parse(payload))) })
  ipcMain.handle(EXERCISE_CHANNELS.getSet, (event, payload) => { assertTrustedSender(event); const set = service.getSet(getExerciseSetInputSchema.parse(payload)); return set ? exerciseSetSchema.parse(set) : null })
  ipcMain.handle(EXERCISE_CHANNELS.run, async (event, payload) => { assertTrustedSender(event); return exerciseExecutionSchema.parse(await service.run(exerciseRunInputSchema.parse(payload))) })
  ipcMain.handle(EXERCISE_CHANNELS.submit, async (event, payload) => { assertTrustedSender(event); return exerciseExecutionSchema.parse(await service.submit(exerciseSubmitInputSchema.parse(payload))) })
  ipcMain.handle(EXERCISE_CHANNELS.requestHelp, (event, payload) => { assertTrustedSender(event); return service.requestHelp(exerciseHelpInputSchema.parse(payload)) })
}
