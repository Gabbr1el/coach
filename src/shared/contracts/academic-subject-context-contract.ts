import { z } from 'zod'

export const declaredAcademicLevelSchema = z.enum(['beginner', 'intermediate', 'advanced'])
export type DeclaredAcademicLevel = z.infer<typeof declaredAcademicLevelSchema>

export interface AcademicSubjectContext {
  readonly subject: string
  readonly declaredLevel: DeclaredAcademicLevel | null
  readonly declaredKnowledge: readonly string[]
  readonly declaredDifficulties: readonly string[]
  readonly goals: readonly string[]
  readonly sourceEvidence: readonly string[]
  readonly createdAt: number
  readonly updatedAt: number
}
export interface RelatedAcademicContext { readonly subject: string; readonly relation: 'implementation_language' | 'prerequisite' | 'user_selected' }

export const academicSubjectDeclarationSchema = z.object({
  subject: z.string().trim().min(1).max(80),
  declaredLevel: declaredAcademicLevelSchema.nullable().optional(),
  declaredKnowledge: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  declaredDifficulties: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  goals: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  sourceEvidence: z.array(z.string().trim().min(1).max(1000)).max(50).default([]),
}).strict()

export type AcademicSubjectDeclaration = z.infer<typeof academicSubjectDeclarationSchema>
