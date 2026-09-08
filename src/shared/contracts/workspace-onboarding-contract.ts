import { z } from 'zod'
import type { DeclaredAcademicLevel } from './academic-subject-context-contract'
export const analyzeWorkspaceTopicInputSchema = z.object({ topic: z.string().trim().min(1).max(120), diagnosticAnswer: z.string().trim().max(1000).optional() }).strict()
export interface WorkspaceTopicAnalysis { readonly topic: string; readonly objective: string; readonly needsDiagnostic: boolean; readonly question: string | null; readonly contextSource: 'academic-context' | 'general-memory' | 'diagnostic' | 'none'; readonly declaredLevel: DeclaredAcademicLevel | null; readonly declaredKnowledge: readonly string[]; readonly declaredDifficulties: readonly string[]; readonly goals: readonly string[] }
export interface WorkspaceOnboardingApi { analyze(input: z.infer<typeof analyzeWorkspaceTopicInputSchema>): Promise<WorkspaceTopicAnalysis> }
