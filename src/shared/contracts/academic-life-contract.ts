import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'

export const academicLifeKindSchema = z.enum(['fact', 'event', 'commitment', 'availability'])
export const academicLifeStatusSchema = z.enum(['active', 'resolved', 'archived'])
export const academicLifeProvenanceSchema = z.object({
  source: z.enum(['user_ui', 'conversation', 'legacy_migration', 'system']),
  reference: z.string().trim().max(200).nullable().default(null),
}).strict()

const optionalTimestamp = z.number().int().positive().nullable().default(null)
export const academicLifeMutationInputSchema = z.object({
  id: z.uuid().optional(),
  replacesId: z.uuid().nullable().optional(),
  kind: academicLifeKindSchema,
  title: z.string().trim().min(1).max(160),
  details: z.string().trim().max(1000).default(''),
  workspaceId: workspaceIdSchema.nullable().default(null),
  startsAt: optionalTimestamp,
  endsAt: optionalTimestamp,
  expiresAt: optionalTimestamp,
  timezone: z.string().trim().min(1).max(100).refine((value) => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }, 'Invalid IANA timezone'),
  weekday: z.number().int().min(0).max(6).nullable().default(null),
  minutes: z.number().int().min(0).max(1440).nullable().default(null),
  shareWithAi: z.boolean().default(true),
  provenance: academicLifeProvenanceSchema,
}).strict().superRefine((value, context) => {
  if (value.kind === 'availability' && (value.weekday === null || value.minutes === null)) context.addIssue({ code: 'custom', message: 'Availability requires weekday and minutes' })
  if (value.kind !== 'availability' && (value.weekday !== null || value.minutes !== null)) context.addIssue({ code: 'custom', message: 'Only availability accepts weekday and minutes' })
  if ((value.kind === 'event' || value.kind === 'commitment') && value.endsAt === null) context.addIssue({ code: 'custom', message: 'Events and commitments require an end date' })
  if (value.startsAt !== null && value.endsAt !== null && value.startsAt > value.endsAt) context.addIssue({ code: 'custom', message: 'Start must not be after end' })
})

export const academicLifeTransitionInputSchema = z.object({ id: z.uuid(), status: z.enum(['resolved', 'archived']) }).strict()
export const academicLifeHistoryInputSchema = z.object({ limit: z.number().int().min(1).max(200).default(100) }).strict()

export interface AcademicLifeItem {
  readonly id: string
  readonly kind: z.infer<typeof academicLifeKindSchema>
  readonly status: z.infer<typeof academicLifeStatusSchema>
  readonly title: string
  readonly details: string
  readonly workspaceId: string | null
  readonly startsAt: number | null
  readonly endsAt: number | null
  readonly expiresAt: number | null
  readonly timezone: string
  readonly weekday: number | null
  readonly minutes: number | null
  readonly shareWithAi: boolean
  readonly provenance: z.infer<typeof academicLifeProvenanceSchema>
  readonly replacesId: string | null
  readonly replacedById: string | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly resolvedAt: number | null
  readonly archivedAt: number | null
}

export interface AcademicLifeProjection { readonly current: AcademicLifeItem[]; readonly history: AcademicLifeItem[]; readonly generatedAt: number }
export type AcademicLifeMutationInput = z.infer<typeof academicLifeMutationInputSchema>
export interface AcademicLifeApi {
  getProjection(): Promise<AcademicLifeProjection>
  save(input: AcademicLifeMutationInput): Promise<AcademicLifeItem>
  transition(input: z.infer<typeof academicLifeTransitionInputSchema>): Promise<AcademicLifeItem>
}
