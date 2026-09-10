export type LearningDifficulty = 'low' | 'medium' | 'high'
export type LearningConfidence = 'low' | 'medium' | 'high'
export interface TopicLearningState { workspaceId: string; topicId: string; evidenceCount: number; assessments: number; correctFirstTry: number; correctAfterHelp: number; incorrect: number; hintsUsed: number; reinforcementEvents: number; exercisesCompleted: number; lessonsCompleted: number; difficultyLevel: LearningDifficulty; masteryEstimate: number | null; confidence: LearningConfidence; needsReview: boolean; lastPracticedAt: number | null; lastAssessedAt: number | null; reasons: string[]; updatedAt: number }
export interface LearningEvidence { type: 'CHECKPOINT_ANSWERED' | 'TOPIC_COMPLETED' | 'HELP_USED' | 'INTERACTIVE_CODE_VALIDATED' | 'EXERCISE_PASSED' | 'EXERCISE_FAILED'; correct?: boolean; attempt?: number; hintUsed?: boolean; reinforcementUsed?: boolean; exerciseCompleted?: boolean; reasoningStatus?: 'coherent' | 'partial' | 'misconception' | 'insufficient' | 'off_topic'; misconception?: string | null; occurredAt: number }

export function emptyTopicLearningState(workspaceId: string, topicId: string, now: number): TopicLearningState { return { workspaceId, topicId, evidenceCount: 0, assessments: 0, correctFirstTry: 0, correctAfterHelp: 0, incorrect: 0, hintsUsed: 0, reinforcementEvents: 0, exercisesCompleted: 0, lessonsCompleted: 0, difficultyLevel: 'low', masteryEstimate: null, confidence: 'low', needsReview: false, lastPracticedAt: null, lastAssessedAt: null, reasons: [], updatedAt: now } }

export function applyLearningEvidence(current: TopicLearningState, evidence: LearningEvidence): TopicLearningState {
  const next = { ...current, reasons: [...current.reasons], evidenceCount: current.evidenceCount + 1, updatedAt: evidence.occurredAt }
  if (evidence.type === 'HELP_USED') next.hintsUsed++
  else if (evidence.type === 'CHECKPOINT_ANSWERED') {
    next.assessments++
    next.lastAssessedAt = evidence.occurredAt
    const supportsAnswer = evidence.reasoningStatus === undefined || evidence.reasoningStatus === 'coherent' || evidence.reasoningStatus === 'partial'
    if (!evidence.correct || evidence.reasoningStatus === 'misconception') next.incorrect++
    else if (supportsAnswer && evidence.reasoningStatus !== 'partial' && (evidence.attempt ?? 1) === 1 && !evidence.hintUsed && !evidence.reinforcementUsed) next.correctFirstTry++
    else if (supportsAnswer) next.correctAfterHelp++
    if (evidence.hintUsed) next.hintsUsed++
    if (evidence.reinforcementUsed) next.reinforcementEvents++
  } else if (evidence.type === 'EXERCISE_FAILED') { next.incorrect++; next.lastPracticedAt = evidence.occurredAt }
  else if (evidence.type === 'EXERCISE_PASSED') { next.exercisesCompleted++; next.lastPracticedAt = evidence.occurredAt; if ((evidence.attempt ?? 1) === 1 && !evidence.hintUsed) next.correctFirstTry++; else next.correctAfterHelp++ }
  else if (evidence.type === 'INTERACTIVE_CODE_VALIDATED') { next.exercisesCompleted++; next.lastPracticedAt = evidence.occurredAt }
  else { next.lessonsCompleted++; next.lastPracticedAt = evidence.occurredAt; if (evidence.exerciseCompleted) next.exercisesCompleted++ }
  const positive = next.correctFirstTry * 3 + next.correctAfterHelp + next.exercisesCompleted * 2
  const negative = next.incorrect * 3 + next.hintsUsed + next.reinforcementEvents * 2
  // Only evidence that can affect mastery unlocks an estimate. Insufficient or
  // off-topic reasoning remains useful review evidence without becoming mastery.
  const assessed = next.correctFirstTry + next.correctAfterHelp + next.incorrect + next.exercisesCompleted
  next.confidence = assessed >= 6 ? 'high' : assessed >= 3 ? 'medium' : 'low'
  next.masteryEstimate = assessed < 3 ? null : Math.max(0, Math.min(100, Math.round(50 + (positive - negative) * 7)))
  if (evidence.type === 'EXERCISE_PASSED' && next.masteryEstimate !== null) next.masteryEstimate = Math.min(95, next.masteryEstimate)
  next.difficultyLevel = negative >= 8 || next.incorrect >= 3 ? 'high' : negative >= 3 ? 'medium' : 'low'
  next.needsReview = next.difficultyLevel === 'high' || (next.difficultyLevel === 'medium' && (next.masteryEstimate ?? 0) < 70) || evidence.reasoningStatus === 'misconception' || evidence.reasoningStatus === 'insufficient' || evidence.reasoningStatus === 'off_topic'
  const qualitative = evidence.misconception ? [`Concepção a revisar: ${evidence.misconception}`] : evidence.reasoningStatus === 'insufficient' || evidence.reasoningStatus === 'off_topic' ? ['Justificativa ainda não demonstra compreensão'] : []
  next.reasons = [...qualitative, `${next.incorrect} evidências incorretas`, `${next.hintsUsed} dicas`, `${next.reinforcementEvents} reforços`, `${next.correctFirstTry} acertos de primeira`, `${next.exercisesCompleted} exercícios concluídos`].slice(0, 12)
  return next
}

export function shouldReplan(previous: TopicLearningState, next: TopicLearningState): boolean { return previous.difficultyLevel !== next.difficultyLevel || previous.needsReview !== next.needsReview || (previous.masteryEstimate === null) !== (next.masteryEstimate === null) || (previous.masteryEstimate !== null && next.masteryEstimate !== null && Math.abs(previous.masteryEstimate - next.masteryEstimate) >= 15) || next.lessonsCompleted > previous.lessonsCompleted }
