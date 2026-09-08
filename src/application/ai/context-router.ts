import type { ObserverState } from '../../shared/contracts/observer-contract'
import type { StreamWorkspaceMessageInput } from '../../shared/contracts/conversation-contract'

export interface AuthorizedStudyContext {
  readonly fileName: string
  readonly editorContent: string
  readonly notes: string
  readonly activePlanItem: string | null
  readonly activePage?: string
  readonly activeStudy?: StreamWorkspaceMessageInput['activeStudy']
  readonly lastExecution?: { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean } | null
  readonly practiceContext?: { fileName: string; language: string; code: string }
  readonly immediateContext?: unknown
}

export type ContextDepth = 'MINIMAL' | 'SESSION' | 'WORKSPACE' | 'DEEP'
export type OutputBudget = 'HINT' | 'SHORT_EXPLANATION' | 'NORMAL_EXPLANATION' | 'DEEP_ANALYSIS'

export interface RoutedContext {
  readonly depth: ContextDepth
  readonly outputBudget: OutputBudget
  readonly maxOutputTokens: number
  readonly helpLevel: number
  readonly context: AuthorizedStudyContext | undefined
  readonly observerSignal: { repeatedErrorCount: number } | null
}

const HELP_REQUEST = /\b(dica|ajuda|não entendi|nao entendi|erro|explique|explica)\b/i
const DEEP_REQUEST = /\b(análise profunda|analise profunda|detalhadamente|passo a passo completo)\b/i

export class ContextRouter {
  route(input: StreamWorkspaceMessageInput, observer?: ObserverState | null, authorizedContext?: AuthorizedStudyContext): RoutedContext {
    const text = input.content.trim()
    const intervention = Boolean(observer?.interventionSuggested)
    const context = authorizedContext
      ? { ...authorizedContext, activePage: input.activePage, activeStudy: input.activeStudy ? { ...input.activeStudy, currentExcerpt: input.activeStudy.currentExcerpt?.slice(0, 2000) ?? null } : undefined, practiceContext: input.practiceContext ? { fileName: input.practiceContext.fileName, language: input.practiceContext.language, code: input.practiceContext.code.slice(0, 12_000) } : undefined, ...(input.lastExecution ? { lastExecution: { ...input.lastExecution, stdout: input.lastExecution.stdout.slice(0, 4000), stderr: input.lastExecution.stderr.slice(0, 4000) } } : {}) }
      : undefined
    if (intervention) return { depth: context ? 'SESSION' : 'MINIMAL', outputBudget: 'HINT', maxOutputTokens: 160, helpLevel: 1, context: context ? { ...context, notes: '' } : undefined, observerSignal: { repeatedErrorCount: observer!.repeatedErrorCount } }
    if (DEEP_REQUEST.test(text)) return { depth: context ? 'DEEP' : 'WORKSPACE', outputBudget: 'DEEP_ANALYSIS', maxOutputTokens: 900, helpLevel: 4, context, observerSignal: null }
    if (HELP_REQUEST.test(text)) return { depth: context ? 'SESSION' : 'MINIMAL', outputBudget: 'SHORT_EXPLANATION', maxOutputTokens: 220, helpLevel: 2, context: context ? { ...context, notes: '' } : undefined, observerSignal: null }
    return { depth: context ? 'SESSION' : 'MINIMAL', outputBudget: 'NORMAL_EXPLANATION', maxOutputTokens: 240, helpLevel: 1, context, observerSignal: null }
  }
}
