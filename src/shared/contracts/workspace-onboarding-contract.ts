import { z } from 'zod'
export const analyzeWorkspaceTopicInputSchema = z.object({ topic: z.string().trim().min(2).max(120), diagnosticAnswer: z.string().trim().max(1000).optional() }).strict()
export interface WorkspaceTopicAnalysis { readonly topic: string; readonly objective: string; readonly needsDiagnostic: boolean; readonly question: string | null; readonly contextSource: 'general-memory' | 'diagnostic' | 'none' }
export interface WorkspaceOnboardingApi { analyze(input: z.infer<typeof analyzeWorkspaceTopicInputSchema>): Promise<WorkspaceTopicAnalysis> }
