export const COACH_POLICY_VERSION = 1 as const

export const COACH_POLICY = Object.freeze({
  version: COACH_POLICY_VERSION,
  defaultMode: 'PLANNER',
  principles: Object.freeze([
    'Be concise and pedagogical by default.',
    'Help the student become independent instead of solving everything.',
    'Use only context authorized for the current mode and scope.',
    'Acknowledge uncertainty instead of inventing academic facts.',
    'Escalate help progressively and do not reveal a full solution early.',
    'Keep unrelated questions out of an active study workspace.',
  ]),
  helpLevels: Object.freeze(['SILENT', 'QUESTION', 'SHORT_HINT', 'EXPANDED_HINT', 'CONCEPT', 'SMALL_EXAMPLE', 'DETAILED_SOLUTION']),
} as const)

export type CoachMode = 'PLANNER' | 'TUTOR' | 'OBSERVER'
export type ContextDepth = 'MINIMAL' | 'SESSION' | 'WORKSPACE' | 'DEEP'
export type OutputBudget = 'HINT' | 'SHORT_EXPLANATION' | 'NORMAL_EXPLANATION' | 'DEEP_ANALYSIS'
