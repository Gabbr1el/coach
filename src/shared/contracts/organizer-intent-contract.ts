import { z } from 'zod'

export const ORGANIZER_READ_CAPABILITIES = ['workspaces.list', 'workspaces.search', 'academicLife.list', 'academicLife.search', 'plan.week.get', 'deadlines.list', 'availability.get'] as const
export const ORGANIZER_WRITE_CAPABILITIES = ['workspace.prepare', 'academic.event.create', 'academic.event.update', 'academic.event.cancel', 'academic-life.save', 'academic-life.transition', 'plan.today-budget.set', 'plan.weekday-availability.set', 'plan.recalculate', 'plan.item-completion.set'] as const
export const organizerCapabilitySchema = z.enum([...ORGANIZER_READ_CAPABILITIES, ...ORGANIZER_WRITE_CAPABILITIES])

export const organizerEntitiesSchema = z.object({
  subject: z.string().trim().min(1).max(80).nullable().default(null),
  query: z.string().trim().min(1).max(500).nullable().default(null),
  dateExpression: z.string().trim().min(1).max(80).nullable().default(null),
  dateFromExpression: z.string().trim().min(1).max(80).nullable().default(null),
  dateToExpression: z.string().trim().min(1).max(80).nullable().default(null),
  eventKind: z.enum(['exam', 'assignment', 'deadline']).nullable().default(null),
  weekday: z.number().int().min(0).max(6).nullable().default(null),
  minutes: z.number().int().min(0).max(1440).nullable().default(null),
  completed: z.boolean().nullable().default(null),
  target: z.string().trim().min(1).max(160).nullable().default(null),
  status: z.enum(['resolved', 'archived']).nullable().default(null),
}).strict()

export const organizerIntentSchema = z.object({
  mode: z.enum(['query', 'mutation', 'clarification', 'conversation']),
  capability: organizerCapabilitySchema.nullable(),
  entities: organizerEntitiesSchema,
  confidence: z.number().min(0).max(1),
  missingFields: z.array(z.string().trim().min(1).max(80)).max(12),
  summary: z.string().trim().min(1).max(500),
}).strict().superRefine((intent, context) => {
  if ((intent.mode === 'clarification' || intent.mode === 'conversation') && intent.capability !== null) context.addIssue({ code: 'custom', message: `${intent.mode} intent cannot declare a capability`, path: ['capability'] })
  if ((intent.mode === 'query' || intent.mode === 'mutation') && intent.capability === null) context.addIssue({ code: 'custom', message: `${intent.mode} intent requires a capability`, path: ['capability'] })
})

export type OrganizerCapability = z.infer<typeof organizerCapabilitySchema>
export type OrganizerEntities = z.infer<typeof organizerEntitiesSchema>
export type OrganizerIntent = z.infer<typeof organizerIntentSchema>

type CapabilityDefinition = {
  readonly access: 'read' | 'write'
  readonly mode: 'query' | 'mutation'
}

export const ORGANIZER_CAPABILITY_REGISTRY = {
  'workspaces.list': { access: 'read', mode: 'query' },
  'workspaces.search': { access: 'read', mode: 'query' },
  'academicLife.list': { access: 'read', mode: 'query' },
  'academicLife.search': { access: 'read', mode: 'query' },
  'plan.week.get': { access: 'read', mode: 'query' },
  'deadlines.list': { access: 'read', mode: 'query' },
  'availability.get': { access: 'read', mode: 'query' },
  'workspace.prepare': { access: 'write', mode: 'mutation' },
  'academic.event.create': { access: 'write', mode: 'mutation' },
  'academic.event.update': { access: 'write', mode: 'mutation' },
  'academic.event.cancel': { access: 'write', mode: 'mutation' },
  'academic-life.save': { access: 'write', mode: 'mutation' },
  'academic-life.transition': { access: 'write', mode: 'mutation' },
  'plan.today-budget.set': { access: 'write', mode: 'mutation' },
  'plan.weekday-availability.set': { access: 'write', mode: 'mutation' },
  'plan.recalculate': { access: 'write', mode: 'mutation' },
  'plan.item-completion.set': { access: 'write', mode: 'mutation' },
} as const satisfies Record<OrganizerCapability, CapabilityDefinition>

export const ORGANIZER_CAPABILITY_CATALOG = Object.entries(ORGANIZER_CAPABILITY_REGISTRY).map(([capability, definition]) => ({ capability, access: definition.access, mode: definition.mode }))
