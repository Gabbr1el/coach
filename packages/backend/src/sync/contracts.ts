import { z } from 'zod';

export const SYNC_PROTOCOL_VERSION = 1 as const;
export const MIN_SYNC_PROTOCOL_VERSION = 1 as const;
export const MAX_SYNC_PROTOCOL_VERSION = 1 as const;

export const mutationSchema = z.object({
  mutationId: z.string().uuid(),
  entityType: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  entityId: z.string().uuid(),
  command: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
  baseRevision: z.number().int().nonnegative().nullable(),
  payloadVersion: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  clientCreatedAt: z.string().datetime()
}).strict();

export const pushSchema = z.object({
  protocolVersion: z.number().int(),
  deviceId: z.string().uuid(),
  mutations: z.array(mutationSchema).min(1).max(50)
});

export const ackSchema = z.object({ protocolVersion: z.number().int(), deviceId: z.string().uuid(), cursor: z.string().min(1).max(2048) });
export const bootstrapSchema = z.object({ protocolVersion: z.number().int(), deviceId: z.string().uuid(), pageSize: z.number().int().min(1).max(500).default(200) });
export const bootstrapPageSchema = z.object({ protocolVersion: z.coerce.number().int(), deviceId: z.string().uuid(), token: z.string().min(1).max(2048) });
export const pullSchema = z.object({ protocolVersion: z.coerce.number().int(), deviceId: z.string().uuid(), cursor: z.string().max(2048).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) });
export const retentionSchema = z.object({ protocolVersion: z.number().int() }).strict();

export type SyncMutation = z.infer<typeof mutationSchema>;
export type PushEnvelope = z.infer<typeof pushSchema>;
