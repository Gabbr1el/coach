import { z } from 'zod'
import { organizerCapabilitySchema, organizerEntitiesSchema } from './organizer-intent-contract'

const boundedIds = z.array(z.uuid()).max(4)

export const organizerConversationStateSchema = z.object({
  focusedAcademicEventId: z.uuid().nullable(),
  focusedWorkspaceId: z.uuid().nullable(),
  focusedSubject: z.string().trim().min(1).max(80).nullable(),
  pending: z.object({
    capability: organizerCapabilitySchema,
    entities: organizerEntitiesSchema,
    missingFields: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
    originalMessageId: z.uuid(),
    originalText: z.string().trim().min(1).max(4_000),
    originalCreatedAt: z.number().int().nonnegative(),
    originalCurrentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    originalTimezone: z.string().trim().min(1).max(100),
  }).strict().nullable(),
  recentResolvedAcademicEventIds: boundedIds,
  recentResolvedWorkspaceIds: boundedIds,
  updatedAt: z.number().int().nonnegative(),
}).strict()

export type OrganizerConversationState = z.infer<typeof organizerConversationStateSchema>

export function emptyOrganizerConversationState(updatedAt = 0): OrganizerConversationState {
  return {
    focusedAcademicEventId: null,
    focusedWorkspaceId: null,
    focusedSubject: null,
    pending: null,
    recentResolvedAcademicEventIds: [],
    recentResolvedWorkspaceIds: [],
    updatedAt,
  }
}
