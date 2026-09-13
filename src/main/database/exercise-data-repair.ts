import type Database from 'better-sqlite3'
import { publicExerciseTestSchema } from '../../shared/contracts/exercise-contract'

const REPAIR_COOLDOWN_MS = 5 * 60_000
export const EXERCISE_DATA_INVALID = 'EXERCISE_DATA_INVALID'

type ExerciseDataRow = {
  id: string
  setId: string
  kind: string
  starterCode: string
  predictionPrompt: string | null
  codeToObserve: string | null
  publicTestsJson: string
  privateTestsJson: string
  referenceSolution: string | null
  expectedPrediction: string | null
}

function tests(value: string): unknown[] | null {
  try {
    const parsed = publicExerciseTestSchema.array().safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function validExerciseData(row: ExerciseDataRow): boolean {
  const publicTests = tests(row.publicTestsJson)
  const privateTests = tests(row.privateTestsJson)
  if (!publicTests || !privateTests) return false
  if (row.kind === 'PREDICT_OUTPUT') {
    return row.starterCode.length === 0 && Boolean(row.predictionPrompt?.trim()) && Boolean(row.codeToObserve?.trim()) && row.expectedPrediction !== null && publicTests.length === 0 && privateTests.length === 0 && row.referenceSolution === null
  }
  if (!['PROGRAMMING_PROBLEM', 'FIX_CODE', 'COMPLETE_CODE'].includes(row.kind)) return false
  return Boolean(row.starterCode.trim()) && Boolean(row.referenceSolution?.trim()) && publicTests.length >= 1 && privateTests.length >= 3 && row.predictionPrompt === null && row.codeToObserve === null && row.expectedPrediction === null
}

function isLegacyCodeExercise(row: ExerciseDataRow): boolean {
  if (row.kind !== 'PREDICT_OUTPUT' || row.predictionPrompt !== null || row.codeToObserve !== null || row.expectedPrediction !== null) return false
  const publicTests = tests(row.publicTestsJson)
  const privateTests = tests(row.privateTestsJson)
  return Boolean(row.starterCode.trim()) && Boolean(row.referenceSolution?.trim()) && Boolean(publicTests?.length) && (privateTests?.length ?? 0) >= 3
}

export type ExerciseDataRepairResult = { transformed: number; quarantinedSets: number }

export function repairLegacyExerciseData(sqlite: Database.Database, now = Date.now()): ExerciseDataRepairResult {
  const table = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='exercises'").get()
  if (!table) return { transformed: 0, quarantinedSets: 0 }
  return sqlite.transaction(() => {
    const rows = sqlite.prepare(`SELECT id,set_id AS setId,kind,starter_code AS starterCode,prediction_prompt AS predictionPrompt,code_to_observe AS codeToObserve,public_tests_json AS publicTestsJson,private_tests_json AS privateTestsJson,reference_solution AS referenceSolution,expected_prediction AS expectedPrediction FROM exercises`).all() as ExerciseDataRow[]
    let transformed = 0
    const invalidSetIds = new Set<string>()
    for (const row of rows) {
      if (isLegacyCodeExercise(row)) {
        sqlite.prepare("UPDATE exercises SET kind='PROGRAMMING_PROBLEM' WHERE id=? AND kind='PREDICT_OUTPUT'").run(row.id)
        transformed++
      } else if (!validExerciseData(row)) {
        invalidSetIds.add(row.setId)
      }
    }
    const quarantine = sqlite.prepare("UPDATE exercise_sets SET status='failed_retryable',retry_after=?,last_error_code=?,updated_at=? WHERE id=? AND status='ready'")
    let quarantinedSets = 0
    for (const setId of invalidSetIds) quarantinedSets += quarantine.run(now + REPAIR_COOLDOWN_MS, EXERCISE_DATA_INVALID, now, setId).changes
    return { transformed, quarantinedSets }
  })()
}
