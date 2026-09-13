import { createHash } from 'node:crypto'
import type { CoachDatabase } from '../../main/database/connection'
import type { PrivateExercise } from '../exercises/exercise-service'
import type { PersistedStudyLesson, StudyLessonBlock } from '../../shared/contracts/study-lesson-contract'

const stableId = (prefix: string, ...parts: string[]) => `${prefix}:${createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32)}`
const revision = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32)

type IntentRow = { id: string; conceptId: string; difficulty: 'introductory' | 'standard' | 'challenge' | null; prerequisites: string }

function declaredIntent(database: CoachDatabase, workspaceId: string, key: string): IntentRow {
  const row = database.sqlite.prepare('SELECT id,concept_id AS conceptId,difficulty,prerequisite_concept_ids_json AS prerequisites FROM assessment_intents WHERE workspace_id=? AND stable_key=?').get(workspaceId, key) as IntentRow | undefined
  if (!row) throw new Error(`Assessment intent ${key} is not declared by the accepted curriculum`)
  return row
}

function saveVariant(database: CoachDatabase, input: { workspaceId: string; intentKey: string; environment: 'checkpoint' | 'exercise' | 'study_interactive'; sourceRef: string; sourceRevision: string; difficulty?: 'introductory' | 'standard' | 'challenge'; publicMetadata: unknown; publicPayload: unknown; evaluator: unknown; now: number }): void {
  const intent = declaredIntent(database, input.workspaceId, input.intentKey)
  const id = stableId('variant', input.workspaceId, intent.id, input.environment, input.sourceRef, input.sourceRevision)
  database.sqlite.prepare(`INSERT INTO assessment_variants (id,workspace_id,intent_id,environment,source_ref,source_revision,difficulty,prerequisite_concept_ids_json,public_metadata_json,public_payload_json,evaluator_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,intent_id,environment,source_ref,source_revision) DO UPDATE SET difficulty=excluded.difficulty,prerequisite_concept_ids_json=excluded.prerequisite_concept_ids_json,public_metadata_json=excluded.public_metadata_json,public_payload_json=excluded.public_payload_json,evaluator_json=excluded.evaluator_json,updated_at=excluded.updated_at`).run(id, input.workspaceId, intent.id, input.environment, input.sourceRef, input.sourceRevision, input.difficulty ?? intent.difficulty ?? 'standard', intent.prerequisites, JSON.stringify(input.publicMetadata), JSON.stringify(input.publicPayload), JSON.stringify(input.evaluator), input.now, input.now)
}

export function registerLessonAssessments(database: CoachDatabase, lesson: PersistedStudyLesson): void {
  const persist = (block: StudyLessonBlock) => {
    if (block.type === 'checkpoint' && block.assessmentIntentKey) {
      const sourceRevision = revision({ question: block.question, options: block.options.map(({ id, text }) => ({ id, text })) })
      saveVariant(database, { workspaceId: lesson.workspaceId, intentKey: block.assessmentIntentKey, environment: 'checkpoint', sourceRef: block.id, sourceRevision, publicMetadata: { title: block.title, reasoningRequirement: block.reasoningRequirement }, publicPayload: { type: 'multiple_choice', prompt: block.question, options: block.options.map(({ id, text }) => ({ id, label: text })) }, evaluator: { correctOptionId: block.correctOptionId, rationales: Object.fromEntries(block.options.map((option) => [option.id, option.rationale])) }, now: lesson.createdAt })
    }
    if (block.type === 'interactiveCode' && block.evidenceMode === 'validated' && block.assessmentIntentKey) {
      const sourceRevision = revision({ initialCode: block.initialCode, expectedOutput: block.expectedOutput })
      saveVariant(database, { workspaceId: lesson.workspaceId, intentKey: block.assessmentIntentKey, environment: 'study_interactive', sourceRef: block.id, sourceRevision, publicMetadata: { title: block.title, interactionType: block.interactionType }, publicPayload: { type: 'code_observation', prompt: block.predictionPrompt ?? block.instruction, language: block.language, code: block.initialCode }, evaluator: { type: 'exact_text', expected: block.expectedOutput }, now: lesson.createdAt })
    }
  }
  for (const block of lesson.blocks) persist(block)
}

export function registerExerciseAssessments(database: CoachDatabase, exercises: PrivateExercise[], now: number): void {
  for (const exercise of exercises) {
    if (!exercise.assessmentIntentKey) continue
    const sourceRevision = revision({ kind: exercise.kind, statement: exercise.statement, publicTests: exercise.publicTests, codeToObserve: exercise.codeToObserve })
    saveVariant(database, { workspaceId: exercise.workspaceId, intentKey: exercise.assessmentIntentKey, environment: 'exercise', sourceRef: exercise.id, sourceRevision, difficulty: exercise.difficulty, publicMetadata: { title: exercise.title, kind: exercise.kind, language: exercise.language, conceptKeys: exercise.conceptKeys ?? [] }, publicPayload: { statement: exercise.statement, inputDescription: exercise.inputDescription, outputDescription: exercise.outputDescription, starterCode: exercise.starterCode, predictionPrompt: exercise.predictionPrompt, codeToObserve: exercise.codeToObserve, publicTests: exercise.publicTests }, evaluator: { exerciseId: exercise.id }, now })
  }
}
