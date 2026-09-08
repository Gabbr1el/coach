export interface ReportActivityMetrics {
  readonly focusSeconds: number
  readonly sessionCount: number
  readonly activeDays: number
  readonly focusExits: number
  readonly completedPlanItems: number
  readonly currentSessionFocusSeconds: number
  readonly currentSessionStartedAt: number | null
}

export interface ReportPerformanceMetrics {
  readonly checkpointsAnswered: number
  readonly correctFirstTry: number
  readonly correctAfterHelp: number
  readonly incorrect: number
  readonly attempts: number
  readonly hintsUsed: number
  readonly reinforcementEvents: number
  readonly assessedSuccessRate: number | null
}

export interface ReportDomainMetrics {
  readonly assessedTopics: number
  readonly masteredTopics: number
  readonly needsReviewTopics: number
  readonly averageMastery: number | null
  readonly confidence: 'not_assessed' | 'low' | 'medium' | 'high'
  readonly lessonsCompleted: number
  readonly exercisesCompleted: number
}

export interface ReportRetentionMetrics {
  readonly status: 'not_evaluated' | 'available'
  readonly score: number | null
  readonly evidenceCount: number
  readonly lastEvidenceAt: number | null
}

export interface ReportEvidenceMetrics {
  readonly learningEvidenceCount: number
  readonly lastLearningEvidenceAt: number | null
  readonly coachHelpEvents: number
  readonly planItemsPending: number
  readonly planItemsActive: number
  readonly activeTopicId: string | null
}

export interface WorkspaceReportOverview {
  readonly workspaceId: string
  readonly workspaceName: string
  readonly focusSeconds: number
  readonly executions: number
  readonly errors: number
  readonly interventions: number
  readonly focusExits: number
  readonly completedPlanItems: number
  readonly sessionCount: number
  readonly activeDays: number
  readonly successRate: number | null
  readonly activity: ReportActivityMetrics
  readonly performance: ReportPerformanceMetrics
  readonly domain: ReportDomainMetrics
  readonly retention: ReportRetentionMetrics
  readonly evidence: ReportEvidenceMetrics
  readonly recommendations: string[]
}

export interface GlobalReportOverview {
  readonly totalFocusSeconds: number
  readonly totalSessions: number
  readonly totalActiveDays: number
  readonly averageSuccessRate: number | null
  readonly workspaces: WorkspaceReportOverview[]
}

export interface ReportApi {
  getGlobalOverview(): Promise<GlobalReportOverview>
}

export interface ReportIntegrationRequest {
  readonly target: 'reports-ui'
  readonly summary: string
  readonly requirements: readonly string[]
  readonly nullableFields: readonly ['successRate', 'averageSuccessRate', 'domain.averageMastery', 'retention.score']
}

export const REPORT_INTEGRATION_REQUEST: ReportIntegrationRequest = Object.freeze({
  target: 'reports-ui',
  summary: 'Renderizar atividade, desempenho, domínio e retenção como grupos independentes, preservando métricas não avaliadas.',
  requirements: Object.freeze([
    'Exibir successRate e averageSuccessRate nulos como “Não avaliado”, nunca como 0% ou 100%.',
    'Exibir retenção somente quando retention.status for available; caso contrário, mostrar “Sem evidência de retenção”.',
    'Não apresentar execuções de código como domínio; usar performance e domain para aprendizagem avaliada.',
    'Somar currentSessionFocusSeconds à atividade de foco e identificar que a sessão ainda está ativa.',
    'Renderizar recomendações somente quando a lista tiver itens; lista vazia significa evidência insuficiente.',
  ]),
  nullableFields: ['successRate', 'averageSuccessRate', 'domain.averageMastery', 'retention.score'] as const,
})
