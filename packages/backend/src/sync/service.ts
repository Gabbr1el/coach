import { randomUUID } from 'node:crypto';
import type { Database } from '../database/client.js';
import { withTenantTransaction, type TenantContext, type TenantTransaction } from '../database/tenant-transaction.js';
import { canonicalJson, sha256 } from './canonical.js';
import { resolveCommand, type CommandDefinition } from './command-registry.js';
import type { PushEnvelope, SyncMutation } from './contracts.js';
import { SYNC_PROTOCOL_VERSION } from './contracts.js';
import { SyncError, requireProtocolVersion } from './errors.js';
import { SyncTokenCodec } from './token.js';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
const json = (value: unknown): JsonValue => JSON.parse(canonicalJson(value)) as JsonValue;

interface RequestContext extends TenantContext { deviceId: string }
interface CursorPayload { kind: 'pull'; version: 1; tenantId: string; deviceId: string; sequence: number; watermark: number }
interface PageTokenPayload { kind: 'bootstrap'; version: 1; tenantId: string; deviceId: string; sessionId: string; bootstrapId: string; position: number; pageSize: number; expiresAt: number }

type MutationResult = {
  mutationId: string;
  status: 'accepted' | 'conflict' | 'rejected';
  sequence?: number;
  revision?: number;
  code?: string;
  currentRevision?: number;
  currentProjection?: unknown;
};

export class SyncService {
  private readonly tokens: SyncTokenCodec;

  constructor(private readonly database: Database, cursorSecret: string, private readonly bootstrapTtlSeconds: number, private readonly maxOfflineMutationAgeDays = 120) {
    this.tokens = new SyncTokenCodec(cursorSecret);
  }

  capabilities() {
    return { minimumProtocolVersion: 1, maximumProtocolVersion: 1, capabilities: { commands: 1, payloads: 1, bootstrap: 1 } };
  }

  async push(context: RequestContext, envelope: PushEnvelope) {
    requireProtocolVersion(envelope.protocolVersion);
    this.requireSessionDevice(context, envelope.deviceId);
    const requestContext = context;
    const results: MutationResult[] = [];
    for (const mutation of envelope.mutations) results.push(await this.applyMutation(requestContext, mutation));
    return { protocolVersion: SYNC_PROTOCOL_VERSION, results };
  }

  private async applyMutation(context: RequestContext, mutation: SyncMutation): Promise<MutationResult> {
    const requestHash = sha256({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      actor: { userId: context.userId, tenantId: context.tenantId, deviceId: context.deviceId },
      mutation
    });
    return withTenantTransaction(this.database, context, async (transaction) => {
      await this.requireDevice(transaction, context);
      await transaction`
        insert into sync_tenant_sequences (tenant_id, mutation_not_before)
        select id, created_at from tenants where id = ${context.tenantId}
        on conflict (tenant_id) do nothing
      `;
      await transaction`select pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${mutation.mutationId}`}, 0))`;
      const [existing] = await transaction<{ request_hash: string; result: MutationResult }[]>`
        select request_hash, result from sync_mutations where tenant_id = ${context.tenantId} and mutation_id = ${mutation.mutationId} for update
      `;
      if (existing) {
        if (existing.request_hash !== requestHash) throw new SyncError('idempotency_key_reused', 409);
        return existing.result;
      }

      const [tenantState] = await transaction<{ mutation_not_before: Date }[]>`select mutation_not_before from sync_tenant_sequences where tenant_id = ${context.tenantId} for update`;
      const clientCreatedAt = new Date(mutation.clientCreatedAt);
      if (tenantState && clientCreatedAt < tenantState.mutation_not_before) throw new SyncError('reconciliation_required', 409, { mutationNotBefore: tenantState.mutation_not_before.toISOString() });
      const resolved = resolveCommand(mutation);
      await transaction`
        insert into sync_mutations (tenant_id, mutation_id, user_id, device_id, request_hash, state, result)
        values (${context.tenantId}, ${mutation.mutationId}, ${context.userId}, ${context.deviceId}, ${requestHash}, 'rejected', '{}'::jsonb)
      `;

      const outcome = await this.mutateEntity(transaction, context, mutation, resolved.definition, resolved.payload, requestHash);
      await transaction`
        update sync_mutations set state = ${outcome.status}::sync_mutation_state, result = ${transaction.json(json(outcome))},
          committed_sequence = ${outcome.sequence ?? null}, completed_at = now()
        where tenant_id = ${context.tenantId} and mutation_id = ${mutation.mutationId}
      `;
      return outcome;
    });
  }

  private async mutateEntity(transaction: TenantTransaction, context: RequestContext, mutation: SyncMutation, definition: CommandDefinition, payload: Record<string, unknown> | null, requestHash: string): Promise<MutationResult> {
    const [current] = await transaction<{ revision: number; payload: unknown; deleted_at: Date | null; aggregate_generation: number; aggregate_id: string | null; entity_class: CommandDefinition['entityClass'] }[]>`
      select revision, payload, deleted_at, aggregate_generation, aggregate_id, entity_class from sync_entities
      where tenant_id = ${context.tenantId} and entity_type = ${mutation.entityType} and entity_id = ${mutation.entityId} for update
    `;
    if (current && (current.entity_class !== definition.entityClass || current.aggregate_id !== this.aggregateId(definition, payload, current))) {
      throw new SyncError('immutable_entity_metadata_mismatch', 409);
    }
    const aggregateId = this.aggregateId(definition, payload, current);
    const generation = await this.aggregateGeneration(transaction, context, definition, aggregateId, mutation.entityId);
    const generationConflict = generation.conflict;
    if (generationConflict) return this.recordConflict(transaction, context, mutation, requestHash, generationConflict, current);

    let conflict: string | undefined;
    if (definition.operation === 'create' && current) conflict = current.deleted_at ? 'entity_deleted' : 'entity_already_exists';
    else if (definition.operation === 'append' && current) conflict = current.deleted_at ? 'entity_deleted' : 'immutable_entity_exists';
    else if ((definition.operation === 'update' || definition.operation === 'delete') && (!current || current.deleted_at)) conflict = current?.deleted_at ? 'entity_deleted' : 'entity_not_found';
    else if (definition.operation === 'set' && current?.deleted_at) conflict = 'entity_deleted';
    else if ((definition.operation === 'update' || definition.operation === 'delete') && mutation.baseRevision !== Number(current!.revision)) conflict = 'revision_conflict';
    if (conflict) return this.recordConflict(transaction, context, mutation, requestHash, conflict, current);

    const revision = Number(current?.revision ?? 0) + 1;
    const publicPayload = definition.operation === 'delete' ? null : payload;
    const changeOperation = definition.operation === 'delete' ? 'delete' : 'upsert';
    const payloadHash = sha256({ entityType: mutation.entityType, entityId: mutation.entityId, entityClass: definition.entityClass, hierarchy: definition.hierarchy, aggregateId, revision, operation: changeOperation, aggregateGeneration: generation.value, payloadVersion: mutation.payloadVersion, payload: publicPayload });
    await transaction`
      insert into sync_entities (tenant_id, entity_type, entity_id, entity_class, aggregate_id, aggregate_generation, revision, payload_version, payload, payload_hash, deleted_at)
      values (${context.tenantId}, ${mutation.entityType}, ${mutation.entityId}, ${definition.entityClass}::sync_entity_class,
        ${aggregateId}, ${generation.value}, ${revision}, ${mutation.payloadVersion}, ${transaction.json(json(publicPayload))}, ${payloadHash},
        ${definition.operation === 'delete' ? new Date() : null})
      on conflict (tenant_id, entity_type, entity_id) do update set
        revision = excluded.revision, payload_version = excluded.payload_version, payload = excluded.payload,
        payload_hash = excluded.payload_hash, deleted_at = excluded.deleted_at, updated_at = now()
    `;
    if (definition.hierarchy === 'aggregate_root') {
      await transaction`
        insert into sync_aggregate_generations (tenant_id, aggregate_id, generation, deleted_at)
        values (${context.tenantId}, ${mutation.entityId}, ${definition.operation === 'delete' ? generation.value + 1 : generation.value}, ${definition.operation === 'delete' ? new Date() : null})
        on conflict (tenant_id, aggregate_id) do update set generation = excluded.generation, deleted_at = excluded.deleted_at
      `;
    }
    const sequence = await this.publishChange(transaction, context.tenantId, { entityType: mutation.entityType, entityId: mutation.entityId, entityClass: definition.entityClass, aggregateId, hierarchy: definition.hierarchy, operation: changeOperation, revision, aggregateGeneration: generation.value, payloadVersion: mutation.payloadVersion, payload: publicPayload, payloadHash });
    if (definition.hierarchy === 'aggregate_root' && definition.operation === 'delete') await this.tombstoneDescendants(transaction, context.tenantId, mutation.entityId, generation.value);
    return { mutationId: mutation.mutationId, status: 'accepted', sequence, revision };
  }

  private aggregateId(definition: CommandDefinition, payload: Record<string, unknown> | null, current?: { aggregate_id: string | null }): string | null {
    if (definition.hierarchy === 'aggregate_root') return null;
    if (definition.hierarchy === 'standalone') return null;
    if (current) {
      if (payload && definition.aggregateId && definition.aggregateId(payload) !== current.aggregate_id) throw new SyncError('immutable_entity_metadata_mismatch', 409);
      return current.aggregate_id;
    }
    if (!payload || !definition.aggregateId) throw new SyncError('aggregate_id_required', 400);
    return definition.aggregateId(payload);
  }

  private async aggregateGeneration(transaction: TenantTransaction, context: RequestContext, definition: CommandDefinition, aggregateId: string | null, entityId: string): Promise<{ value: number; conflict?: string }> {
    if (definition.hierarchy === 'standalone') return { value: 1 };
    const resolvedAggregateId = definition.hierarchy === 'aggregate_root' ? entityId : aggregateId!;
    const [aggregate] = await transaction<{ generation: number; deleted_at: Date | null }[]>`
      select generation, deleted_at from sync_aggregate_generations where tenant_id = ${context.tenantId} and aggregate_id = ${resolvedAggregateId} for update
    `;
    if (!aggregate) return definition.hierarchy === 'aggregate_root' ? { value: 1 } : { value: 0, conflict: 'aggregate_not_found' };
    if (aggregate.deleted_at) return definition.hierarchy === 'aggregate_root'
      ? { value: Number(aggregate.generation), conflict: 'entity_deleted' }
      : { value: Number(aggregate.generation), conflict: 'aggregate_deleted' };
    return { value: Number(aggregate.generation) };
  }

  private async recordConflict(transaction: TenantTransaction, context: RequestContext, mutation: SyncMutation, requestHash: string, code: string, current?: { revision: number; payload: unknown } | undefined): Promise<MutationResult> {
    const result: MutationResult = {
      mutationId: mutation.mutationId,
      status: 'conflict',
      code,
      ...(current ? { currentRevision: Number(current.revision), currentProjection: current.payload } : {})
    };
    await transaction`
      insert into sync_conflicts (id, tenant_id, entity_type, entity_id, mutation_id, code, command, base_revision, proposed_payload_version, proposed_payload, proposed_payload_hash, request_hash, current_revision, current_projection)
      values (${randomUUID()}, ${context.tenantId}, ${mutation.entityType}, ${mutation.entityId}, ${mutation.mutationId}, ${code}, ${mutation.command},
        ${mutation.baseRevision}, ${mutation.payloadVersion}, ${transaction.json(json(mutation.payload))}, ${sha256(mutation.payload)}, ${requestHash},
        ${result.currentRevision ?? null}, ${transaction.json(json(result.currentProjection ?? null))})
    `;
    return result;
  }

  private async allocateSequence(transaction: TenantTransaction, tenantId: string): Promise<number> {
    await transaction`insert into sync_tenant_sequences (tenant_id) values (${tenantId}) on conflict do nothing`;
    const [row] = await transaction<{ committed_sequence: number }[]>`
      update sync_tenant_sequences set committed_sequence = committed_sequence + 1 where tenant_id = ${tenantId} returning committed_sequence
    `;
    if (!row) throw new Error('sync_sequence_allocation_failed');
    return Number(row.committed_sequence);
  }

  private async publishChange(transaction: TenantTransaction, tenantId: string, change: { entityType: string; entityId: string; entityClass: string; aggregateId: string | null; hierarchy: string; operation: string; revision: number; aggregateGeneration: number; payloadVersion: number; payload: unknown; payloadHash: string }): Promise<number> {
    const sequence = await this.allocateSequence(transaction, tenantId);
    await transaction`
      insert into sync_changes (tenant_id, sequence, entity_type, entity_id, entity_class, aggregate_id, hierarchy, operation, revision, aggregate_generation, payload_version, payload, payload_hash)
      values (${tenantId}, ${sequence}, ${change.entityType}, ${change.entityId}, ${change.entityClass}::sync_entity_class, ${change.aggregateId}, ${change.hierarchy}, ${change.operation},
        ${change.revision}, ${change.aggregateGeneration}, ${change.payloadVersion}, ${transaction.json(json(change.payload))}, ${change.payloadHash})
    `;
    return sequence;
  }

  private async tombstoneDescendants(transaction: TenantTransaction, tenantId: string, aggregateId: string, deletedGeneration: number): Promise<void> {
    const descendants = await transaction<Array<{ entity_type: string; entity_id: string; entity_class: string; revision: number; payload_version: number }>>`
      select entity_type, entity_id, entity_class, revision, payload_version from sync_entities
      where tenant_id = ${tenantId} and aggregate_id = ${aggregateId} and deleted_at is null order by entity_type collate "C", entity_id
      for update
    `;
    for (const descendant of descendants) {
      const revision = Number(descendant.revision) + 1;
      const payloadHash = sha256({ entityType: descendant.entity_type, entityId: descendant.entity_id, entityClass: descendant.entity_class, hierarchy: 'aggregate_child', aggregateId, revision, operation: 'delete', aggregateGeneration: deletedGeneration, payloadVersion: descendant.payload_version, payload: null });
      await transaction`update sync_entities set revision = ${revision}, payload = null, payload_hash = ${payloadHash}, deleted_at = now(), updated_at = now() where tenant_id = ${tenantId} and entity_type = ${descendant.entity_type} and entity_id = ${descendant.entity_id}`;
      await this.publishChange(transaction, tenantId, { entityType: descendant.entity_type, entityId: descendant.entity_id, entityClass: descendant.entity_class, aggregateId, hierarchy: 'aggregate_child', operation: 'delete', revision, aggregateGeneration: deletedGeneration, payloadVersion: descendant.payload_version, payload: null, payloadHash });
    }
  }

  async pull(context: RequestContext, input: { protocolVersion: number; deviceId: string; cursor?: string; limit: number }) {
    requireProtocolVersion(input.protocolVersion);
    this.requireSessionDevice(context, input.deviceId);
    return withTenantTransaction(this.database, context, async (transaction) => {
      await this.requireDevice(transaction, { ...context, deviceId: input.deviceId });
      const cursor = input.cursor ? this.decodeCursor(input.cursor, context.tenantId, input.deviceId) : undefined;
      const [sequenceState] = await transaction<{ committed_sequence: number; minimum_available_sequence: number }[]>`
        select committed_sequence, minimum_available_sequence from sync_tenant_sequences where tenant_id = ${context.tenantId}
      `;
      const committed = Number(sequenceState?.committed_sequence ?? 0);
      const minimum = Number(sequenceState?.minimum_available_sequence ?? 1);
      const after = cursor?.sequence ?? 0;
      if (after < minimum - 1) throw new SyncError('sync_reset_required', 410, { minimumSupportedCursor: this.cursor(context.tenantId, input.deviceId, minimum - 1, committed) });
      const watermark = cursor && cursor.sequence < cursor.watermark ? cursor.watermark : committed;
      const changes = await transaction<Array<Record<string, unknown> & { sequence: number }>>`
        select sequence, entity_type as "entityType", entity_id as "entityId", entity_class as "entityClass", aggregate_id as "aggregateId", hierarchy, operation, revision,
          aggregate_generation as "aggregateGeneration", payload_version as "payloadVersion", payload, payload_hash as "payloadHash", committed_at as "committedAt"
        from sync_changes where tenant_id = ${context.tenantId} and sequence > ${after} and sequence <= ${watermark}
        order by sequence limit ${input.limit}
      `;
      const delivered = changes.length ? Number(changes[changes.length - 1]!.sequence) : after;
      await transaction`
        insert into sync_cursors (tenant_id, device_id, greatest_delivered_sequence) values (${context.tenantId}, ${input.deviceId}, ${delivered})
        on conflict (tenant_id, device_id) do update set greatest_delivered_sequence = greatest(sync_cursors.greatest_delivered_sequence, excluded.greatest_delivered_sequence), last_seen_at = now()
      `;
      return {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        changes,
        nextCursor: this.cursor(context.tenantId, input.deviceId, delivered, watermark),
        hasMore: delivered < watermark,
        highWatermark: watermark,
        serverTime: new Date().toISOString(),
        minimumSupportedCursor: this.cursor(context.tenantId, input.deviceId, minimum - 1, committed)
      };
    });
  }

  async acknowledge(context: RequestContext, input: { protocolVersion: number; deviceId: string; cursor: string }) {
    requireProtocolVersion(input.protocolVersion);
    this.requireSessionDevice(context, input.deviceId);
    const cursor = this.decodeCursor(input.cursor, context.tenantId, input.deviceId);
    await withTenantTransaction(this.database, context, async (transaction) => {
      await this.requireDevice(transaction, { ...context, deviceId: input.deviceId });
      const [state] = await transaction<{ greatest_delivered_sequence: number }[]>`
        select greatest_delivered_sequence from sync_cursors where tenant_id = ${context.tenantId} and device_id = ${input.deviceId} for update
      `;
      if (!state || cursor.sequence > Number(state.greatest_delivered_sequence)) throw new SyncError('cursor_not_delivered', 409);
      await transaction`
        update sync_cursors set acknowledged_sequence = greatest(acknowledged_sequence, ${cursor.sequence}), last_seen_at = now()
        where tenant_id = ${context.tenantId} and device_id = ${input.deviceId}
      `;
    });
  }

  async bootstrap(context: RequestContext, input: { protocolVersion: number; deviceId: string; pageSize: number }) {
    requireProtocolVersion(input.protocolVersion);
    this.requireSessionDevice(context, input.deviceId);
    const bootstrapId = randomUUID();
    const expiresAt = Date.now() + this.bootstrapTtlSeconds * 1000;
    return this.database.begin('isolation level serializable', async (transaction) => {
      await transaction`select set_config('coach.user_id', ${context.userId}, true), set_config('coach.tenant_id', ${context.tenantId}, true), set_config('coach.session_id', ${context.sessionId}, true)`;
      await this.requireDevice(transaction, { ...context, deviceId: input.deviceId });
      const [state] = await transaction<{ committed_sequence: number }[]>`select committed_sequence from sync_tenant_sequences where tenant_id = ${context.tenantId}`;
      const watermark = Number(state?.committed_sequence ?? 0);
      const entities = await transaction<Array<{ entity_type: string; entity_id: string; entity_class: string; aggregate_id: string | null; hierarchy: string; revision: number; aggregate_generation: number; payload_version: number; payload: unknown; payload_hash: string }>>`
        select entity_type, entity_id, entity_class, aggregate_id,
          case when aggregate_id is not null then 'aggregate_child' when exists (select 1 from sync_aggregate_generations g where g.tenant_id = sync_entities.tenant_id and g.aggregate_id = sync_entities.entity_id) then 'aggregate_root' else 'standalone' end as hierarchy,
          revision, aggregate_generation, payload_version, payload, payload_hash from sync_entities
        where tenant_id = ${context.tenantId} and deleted_at is null
          and (aggregate_id is null or exists (select 1 from sync_aggregate_generations g where g.tenant_id = sync_entities.tenant_id and g.aggregate_id = sync_entities.aggregate_id and g.deleted_at is null and g.generation = sync_entities.aggregate_generation))
        order by entity_type collate "C", entity_id
      `;
      const manifestHash = sha256(entities.map((entity) => [entity.entity_type, entity.entity_id, Number(entity.revision), entity.payload_hash]));
      await transaction`
        insert into sync_bootstraps (id, tenant_id, session_id, device_id, protocol_version, watermark, item_count, manifest_hash, expires_at)
        values (${bootstrapId}, ${context.tenantId}, ${context.sessionId}, ${input.deviceId}, 1, ${watermark}, ${entities.length}, ${manifestHash}, ${new Date(expiresAt)})
      `;
      for (let position = 0; position < entities.length; position += 1) {
        const entity = entities[position]!;
        await transaction`
          insert into sync_bootstrap_items (bootstrap_id, tenant_id, position, entity_type, entity_id, entity_class, aggregate_id, hierarchy, revision, aggregate_generation, payload_version, payload, payload_hash)
          values (${bootstrapId}, ${context.tenantId}, ${position}, ${entity.entity_type}, ${entity.entity_id}, ${entity.entity_class}::sync_entity_class, ${entity.aggregate_id}, ${entity.hierarchy}, ${entity.revision}, ${entity.aggregate_generation}, ${entity.payload_version}, ${transaction.json(json(entity.payload))}, ${entity.payload_hash})
        `;
      }
      return {
        protocolVersion: 1,
        bootstrapId,
        watermark,
        itemCount: entities.length,
        manifestHash,
        expiresAt: new Date(expiresAt).toISOString(),
        pageToken: this.pageToken(context, input.deviceId, bootstrapId, 0, input.pageSize, expiresAt)
      };
    });
  }

  async bootstrapPage(context: RequestContext, input: { protocolVersion: number; deviceId: string; token: string }) {
    requireProtocolVersion(input.protocolVersion);
    this.requireSessionDevice(context, input.deviceId);
    const token = this.decodePageToken(input.token, context, input.deviceId);
    if (token.expiresAt <= Date.now()) throw new SyncError('bootstrap_expired', 410);
    return withTenantTransaction(this.database, context, async (transaction) => {
      const [bootstrap] = await transaction<{ watermark: number; item_count: number; manifest_hash: string; expires_at: Date }[]>`
        select watermark, item_count, manifest_hash, expires_at from sync_bootstraps
        where id = ${token.bootstrapId} and tenant_id = ${context.tenantId} and session_id = ${context.sessionId} and device_id = ${input.deviceId}
      `;
      if (!bootstrap || bootstrap.expires_at.getTime() <= Date.now()) throw new SyncError('bootstrap_expired', 410);
      const items = await transaction<Array<Record<string, unknown>> >`
        select position, entity_type as "entityType", entity_id as "entityId", entity_class as "entityClass", aggregate_id as "aggregateId", hierarchy, revision, aggregate_generation as "aggregateGeneration",
          payload_version as "payloadVersion", payload, payload_hash as "payloadHash"
        from sync_bootstrap_items where bootstrap_id = ${token.bootstrapId} and tenant_id = ${context.tenantId} and position >= ${token.position}
        order by position limit ${token.pageSize}
      `;
      const nextPosition = token.position + items.length;
      return {
        protocolVersion: 1,
        bootstrapId: token.bootstrapId,
        watermark: Number(bootstrap.watermark),
        itemCount: bootstrap.item_count,
        manifestHash: bootstrap.manifest_hash,
        items,
        hasMore: nextPosition < bootstrap.item_count,
        nextPageToken: nextPosition < bootstrap.item_count ? this.pageToken(context, input.deviceId, token.bootstrapId, nextPosition, token.pageSize, token.expiresAt) : null,
        catchUpCursor: nextPosition >= bootstrap.item_count ? this.cursor(context.tenantId, input.deviceId, Number(bootstrap.watermark), Number(bootstrap.watermark)) : null
      };
    });
  }

  private async requireDevice(transaction: TenantTransaction, context: RequestContext): Promise<void> {
    const [device] = await transaction<{ id: string }[]>`select id from devices where tenant_id = ${context.tenantId} and user_id = ${context.userId} and id = ${context.deviceId}`;
    if (!device) throw new SyncError('device_not_registered', 403);
  }

  private requireSessionDevice(context: RequestContext, deviceId: string): void {
    if (context.deviceId !== deviceId) throw new SyncError('device_session_mismatch', 403);
  }

  async runRetention(context: RequestContext, input: { protocolVersion: number }) {
    requireProtocolVersion(input.protocolVersion);
    return withTenantTransaction(this.database, context, async (transaction) => {
      const [membership] = await transaction<{ role: string }[]>`select role from tenant_memberships where tenant_id = ${context.tenantId} and user_id = ${context.userId} and status = 'active'`;
      if (membership?.role !== 'owner') throw new SyncError('command_not_authorized', 403);
      const [state] = await transaction<{ committed_sequence: number; minimum_available_sequence: number }[]>`select committed_sequence, minimum_available_sequence from sync_tenant_sequences where tenant_id = ${context.tenantId} for update`;
      if (!state) return { deletedChanges: 0, expiredBootstraps: 0, minimumAvailableSequence: 1, mutationNotBefore: new Date().toISOString() };
      const [ack] = await transaction<{ floor: number | null }[]>`
        select min(c.acknowledged_sequence) as floor from sync_cursors c join devices d on d.tenant_id = c.tenant_id and d.id = c.device_id
        where c.tenant_id = ${context.tenantId} and c.last_seen_at >= now() - interval '90 days'
      `;
      const acknowledgedFloor = ack?.floor === null || ack?.floor === undefined ? Number(state.committed_sequence) : Number(ack.floor);
      const [eligible] = await transaction<{ floor: number | null }[]>`
        select max(sequence) as floor from sync_changes where tenant_id = ${context.tenantId} and sequence <= ${acknowledgedFloor} and committed_at < now() - interval '120 days'
      `;
      const deleteThrough = Number(eligible?.floor ?? 0);
      const deleted = deleteThrough > 0 ? await transaction<{ sequence: number }[]>`delete from sync_changes where tenant_id = ${context.tenantId} and sequence <= ${deleteThrough} returning sequence` : [];
      const nextFloor = deleted.length > 0 ? deleteThrough + 1 : Number(state.minimum_available_sequence);
      const mutationNotBefore = new Date(Date.now() - this.maxOfflineMutationAgeDays * 86_400_000);
      await transaction`
        update sync_tenant_sequences set
          minimum_available_sequence = ${nextFloor},
          mutation_not_before = greatest(mutation_not_before, ${mutationNotBefore})
        where tenant_id = ${context.tenantId}
      `;
      const expired = await transaction<{ id: string }[]>`delete from sync_bootstraps where tenant_id = ${context.tenantId} and expires_at < now() returning id`;
      const [updated] = await transaction<{ mutation_not_before: Date }[]>`select mutation_not_before from sync_tenant_sequences where tenant_id = ${context.tenantId}`;
      return { deletedChanges: deleted.length, expiredBootstraps: expired.length, minimumAvailableSequence: nextFloor, mutationNotBefore: updated!.mutation_not_before.toISOString() };
    });
  }

  private cursor(tenantId: string, deviceId: string, sequence: number, watermark: number): string {
    return this.tokens.encode({ kind: 'pull', version: 1, tenantId, deviceId, sequence, watermark });
  }

  private decodeCursor(value: string, tenantId: string, deviceId: string): CursorPayload {
    let cursor: CursorPayload;
    try { cursor = this.tokens.decode<CursorPayload>(value); } catch { throw new SyncError('invalid_cursor', 400); }
    if (cursor.kind !== 'pull' || cursor.version !== 1 || cursor.tenantId !== tenantId || cursor.deviceId !== deviceId || !Number.isSafeInteger(cursor.sequence) || !Number.isSafeInteger(cursor.watermark) || cursor.sequence < 0 || cursor.sequence > cursor.watermark) throw new SyncError('invalid_cursor', 400);
    return cursor;
  }

  private pageToken(context: TenantContext, deviceId: string, bootstrapId: string, position: number, pageSize: number, expiresAt: number): string {
    return this.tokens.encode({ kind: 'bootstrap', version: 1, tenantId: context.tenantId, deviceId, sessionId: context.sessionId, bootstrapId, position, pageSize, expiresAt });
  }

  private decodePageToken(value: string, context: TenantContext, deviceId: string): PageTokenPayload {
    let token: PageTokenPayload;
    try { token = this.tokens.decode<PageTokenPayload>(value); } catch { throw new SyncError('invalid_bootstrap_token', 400); }
    if (token.kind !== 'bootstrap' || token.version !== 1 || token.tenantId !== context.tenantId || token.deviceId !== deviceId || token.sessionId !== context.sessionId || !Number.isSafeInteger(token.position) || !Number.isSafeInteger(token.pageSize)) throw new SyncError('invalid_bootstrap_token', 400);
    return token;
  }
}
