import { z } from 'zod';
import type { SyncMutation } from './contracts.js';
import { SyncError } from './errors.js';

export type EntityClass = 'append_only' | 'revisioned_text' | 'scalar' | 'generated';
export type Hierarchy = 'aggregate_root' | 'aggregate_child' | 'standalone';
export type ConflictPolicy = 'append_unique' | 'revision_required' | 'server_order' | 'server_only';
export type AuthorizationPolicy = 'member' | 'owner' | 'server_only';

export interface CommandDefinition {
  entityClass: EntityClass;
  hierarchy: Hierarchy;
  conflictPolicy: ConflictPolicy;
  authorization: AuthorizationPolicy;
  operation: 'create' | 'update' | 'delete' | 'append' | 'set';
  payloadSchema: z.ZodType<Record<string, unknown> | null>;
  aggregateId?: (payload: Record<string, unknown>) => string;
}

const textPayload = z.object({ body: z.string().max(1_000_000) }).strict();
const childPayload = z.object({ aggregateId: z.string().uuid(), body: z.string().max(1_000_000) }).strict();
const scalarPayload = z.object({ value: z.union([z.string(), z.number(), z.boolean(), z.null()]) }).strict();
const appendPayload = z.object({ event: z.record(z.string(), z.unknown()) }).strict();
const tombstonePayload = z.null();

const registry = new Map<string, CommandDefinition>([
  ['generic_record:generic_record.create:1', { entityClass: 'revisioned_text', hierarchy: 'aggregate_root', conflictPolicy: 'revision_required', authorization: 'member', operation: 'create', payloadSchema: textPayload }],
  ['generic_record:generic_record.update:1', { entityClass: 'revisioned_text', hierarchy: 'aggregate_root', conflictPolicy: 'revision_required', authorization: 'member', operation: 'update', payloadSchema: textPayload }],
  ['generic_record:generic_record.update:2', { entityClass: 'revisioned_text', hierarchy: 'aggregate_root', conflictPolicy: 'revision_required', authorization: 'member', operation: 'update', payloadSchema: z.object({ body: z.string().max(1_000_000), format: z.enum(['plain', 'markdown']) }).strict() }],
  ['generic_record:generic_record.delete:1', { entityClass: 'revisioned_text', hierarchy: 'aggregate_root', conflictPolicy: 'revision_required', authorization: 'member', operation: 'delete', payloadSchema: tombstonePayload }],
  ['generic_child:generic_child.create:1', { entityClass: 'revisioned_text', hierarchy: 'aggregate_child', conflictPolicy: 'revision_required', authorization: 'member', operation: 'create', payloadSchema: childPayload, aggregateId: (payload) => String(payload.aggregateId) }],
  ['generic_child:generic_child.update:1', { entityClass: 'revisioned_text', hierarchy: 'aggregate_child', conflictPolicy: 'revision_required', authorization: 'member', operation: 'update', payloadSchema: childPayload, aggregateId: (payload) => String(payload.aggregateId) }],
  ['append_event:append_event.append:1', { entityClass: 'append_only', hierarchy: 'standalone', conflictPolicy: 'append_unique', authorization: 'member', operation: 'append', payloadSchema: appendPayload }],
  ['scalar_setting:scalar_setting.set:1', { entityClass: 'scalar', hierarchy: 'standalone', conflictPolicy: 'server_order', authorization: 'member', operation: 'set', payloadSchema: scalarPayload }],
  ['scalar_setting:scalar_setting.delete:1', { entityClass: 'scalar', hierarchy: 'standalone', conflictPolicy: 'server_order', authorization: 'member', operation: 'delete', payloadSchema: tombstonePayload }],
  ['generated_artifact:generated_artifact.publish:1', { entityClass: 'generated', hierarchy: 'aggregate_child', conflictPolicy: 'server_only', authorization: 'server_only', operation: 'create', payloadSchema: childPayload, aggregateId: (payload) => String(payload.aggregateId) }]
]);

export function resolveCommand(mutation: SyncMutation): { definition: CommandDefinition; payload: Record<string, unknown> | null } {
  const definition = registry.get(`${mutation.entityType}:${mutation.command}:${mutation.payloadVersion}`);
  if (!definition) throw new SyncError('unknown_sync_command', 400);
  const parsed = definition.payloadSchema.safeParse(mutation.payload);
  if (!parsed.success) throw new SyncError('invalid_command_payload', 400);
  if (definition.authorization === 'server_only') throw new SyncError('command_not_authorized', 403);
  return { definition, payload: parsed.data };
}
