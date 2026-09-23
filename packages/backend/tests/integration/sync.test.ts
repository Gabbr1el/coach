import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/database/client.js';
import { withTenantTransaction } from '../../src/database/tenant-transaction.js';
import { SyncError } from '../../src/sync/errors.js';
import { SyncService } from '../../src/sync/service.js';
import { pushSchema } from '../../src/sync/contracts.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const secret = 'integration-sync-cursor-secret-32-bytes';

describeDatabase('sync v1 PostgreSQL kernel', () => {
  let database: Database;
  let admin: Database;
  let sync: SyncService;
  const users = [randomUUID(), randomUUID()];
  const tenants = [randomUUID(), randomUUID()];
  const devices = [randomUUID(), randomUUID()];
  const sessions = [randomUUID(), randomUUID()];
  const contexts = users.map((userId, index) => ({ userId, tenantId: tenants[index]!, sessionId: sessions[index]!, deviceId: devices[index]! }));

  beforeAll(async () => {
    database = createDatabase(databaseUrl!, 10);
    admin = createDatabase(process.env.MIGRATION_DATABASE_URL ?? databaseUrl!, 2);
    sync = new SyncService(database, secret, 3_600);
    for (let index = 0; index < 2; index += 1) {
      await admin`insert into tenants (id, kind, name, personal_owner_user_id) values (${tenants[index]!}, 'personal', ${`sync-${index}`}, ${users[index]!})`;
      await admin`insert into tenant_memberships (tenant_id, user_id, role) values (${tenants[index]!}, ${users[index]!}, 'owner')`;
      await admin`insert into devices (id, tenant_id, user_id, label, platform, app_version) values (${devices[index]!}, ${tenants[index]!}, ${users[index]!}, 'test', 'linux', 'test')`;
    }
  });

  afterAll(async () => { await database.end(); await admin.end(); });

  const mutation = (overrides: Record<string, unknown> = {}) => ({
    mutationId: randomUUID(),
    entityType: 'generic_record',
    entityId: randomUUID(),
    command: 'generic_record.create',
    baseRevision: 0,
    payloadVersion: 1,
    payload: { body: 'value' },
    clientCreatedAt: new Date().toISOString(),
    ...overrides
  });

  const push = (index: number, item: ReturnType<typeof mutation>) => sync.push(contexts[index]!, { protocolVersion: 1, deviceId: devices[index]!, mutations: [item] });

  it('allocates a contiguous commit order under concurrent out-of-order completion and paginates without gaps', async () => {
    const items = Array.from({ length: 12 }, (_, index) => mutation({ payload: { body: `value-${index}` } }));
    await Promise.all(items.reverse().map((item) => push(0, item)));
    let cursor: string | undefined;
    const sequences: number[] = [];
    do {
      const page = await sync.pull(contexts[0]!, { protocolVersion: 1, deviceId: devices[0]!, limit: 3, ...(cursor ? { cursor } : {}) });
      sequences.push(...page.changes.map((change) => Number(change.sequence)));
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    } while (true);
    expect(sequences).toEqual(Array.from({ length: sequences.length }, (_, index) => index + 1));
  });

  it('replays the durable result after retry and rejects a mutation hash mismatch', async () => {
    const item = mutation();
    const first = await push(0, item);
    expect(await push(0, item)).toEqual(first);
    await expect(push(0, { ...item, payload: { body: 'different' } })).rejects.toMatchObject({ code: 'idempotency_key_reused' });
    const [count] = await admin<{ count: number }[]>`select count(*)::int as count from sync_changes where tenant_id = ${tenants[0]!} and entity_id = ${item.entityId}`;
    expect(count?.count).toBe(1);
  });

  it('serializes concurrent first use of the same mutation ID', async () => {
    const item = mutation();
    const [left, right] = await Promise.all([push(0, item), push(0, item)]);
    expect(right).toEqual(left);
    const [effect] = await admin<{ count: number }[]>`select count(*)::int as count from sync_changes where tenant_id = ${tenants[0]!} and entity_id = ${item.entityId}`;
    expect(effect?.count).toBe(1);

    const divergent = mutation();
    const first = push(0, divergent);
    const second = push(0, { ...divergent, payload: { body: 'different' } });
    const settled = await Promise.allSettled([first, second]);
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ code: 'idempotency_key_reused' });
    const [divergentEffect] = await admin<{ count: number }[]>`select count(*)::int as count from sync_changes where tenant_id = ${tenants[0]!} and entity_id = ${divergent.entityId}`;
    expect(divergentEffect?.count).toBe(1);
  });

  it('replays a receipt before consulting a retired command decoder', async () => {
    const item = mutation();
    const expected = await push(0, item);
    await admin`update sync_mutations set result = result where tenant_id = ${tenants[0]!} and mutation_id = ${item.mutationId}`;
    const retiredShape = { ...item, command: 'retired.command' };
    const requestHash = await admin<{ request_hash: string }[]>`select request_hash from sync_mutations where tenant_id = ${tenants[0]!} and mutation_id = ${item.mutationId}`;
    const originalHash = requestHash[0]!.request_hash;
    const service = sync as unknown as { applyMutation(context: typeof contexts[number], mutation: typeof item): Promise<unknown> };
    await admin`update sync_mutations set request_hash = ${originalHash} where tenant_id = ${tenants[0]!} and mutation_id = ${item.mutationId}`;
    expect(await service.applyMutation(contexts[0]!, item)).toEqual(expected.results[0]);
    await expect(service.applyMutation(contexts[0]!, retiredShape)).rejects.toMatchObject({ code: 'idempotency_key_reused' });
  });

  it('enforces explicit create, update, and delete existence semantics', async () => {
    const entityId = randomUUID();
    const missingUpdate = await push(0, mutation({ entityId, command: 'generic_record.update' }));
    expect(missingUpdate.results[0]).toMatchObject({ code: 'entity_not_found' });
    await push(0, mutation({ entityId }));
    const duplicateCreate = await push(0, mutation({ entityId }));
    expect(duplicateCreate.results[0]).toMatchObject({ code: 'entity_already_exists' });
    const removed = await push(0, mutation({ entityId, command: 'generic_record.delete', payload: null, baseRevision: 1 }));
    expect(removed.results[0]).toMatchObject({ status: 'accepted' });
    const deletedUpdate = await push(0, mutation({ entityId, command: 'generic_record.update', baseRevision: 2 }));
    expect(deletedUpdate.results[0]).toMatchObject({ code: 'entity_deleted' });
    const deletedCreate = await push(0, mutation({ entityId }));
    expect(deletedCreate.results[0]).toMatchObject({ code: 'entity_deleted' });
  });

  it('keeps historical payload decoders by payload version', async () => {
    const entityId = randomUUID();
    await push(0, mutation({ entityId }));
    const v1 = await push(0, mutation({ entityId, command: 'generic_record.update', baseRevision: 1, payloadVersion: 1, payload: { body: 'v1' } }));
    expect(v1.results[0]).toMatchObject({ status: 'accepted', revision: 2 });
    const v2 = await push(0, mutation({ entityId, command: 'generic_record.update', baseRevision: 2, payloadVersion: 2, payload: { body: 'v2', format: 'markdown' } }));
    expect(v2.results[0]).toMatchObject({ status: 'accepted', revision: 3 });
    await expect(push(0, mutation({ entityId, command: 'generic_record.update', baseRevision: 3, payloadVersion: 2, payload: { body: 'invalid-v2' } }))).rejects.toMatchObject({ code: 'invalid_command_payload' });
  });

  it('rolls back mutation, entity, and sequence together at a simulated crash point', async () => {
    const before = await admin<{ committed_sequence: number }[]>`select committed_sequence from sync_tenant_sequences where tenant_id = ${tenants[0]!}`;
    await expect(withTenantTransaction(database, contexts[0]!, async (transaction) => {
      await transaction`update sync_tenant_sequences set committed_sequence = committed_sequence + 1 where tenant_id = ${tenants[0]!}`;
      await transaction`insert into sync_changes (tenant_id, sequence, entity_type, entity_id, entity_class, hierarchy, operation, revision, aggregate_generation, payload_version, payload, payload_hash) values (${tenants[0]!}, ${(before[0]?.committed_sequence ?? 0) + 1}, 'crash', ${randomUUID()}, 'revisioned_text', 'standalone', 'upsert', 1, 1, 1, '{}'::jsonb, 'hash')`;
      throw new Error('simulated_crash');
    })).rejects.toThrow('simulated_crash');
    const after = await admin<{ committed_sequence: number }[]>`select committed_sequence from sync_tenant_sequences where tenant_id = ${tenants[0]!}`;
    expect(after[0]?.committed_sequence).toBe(before[0]?.committed_sequence);
  });

  it('prevents stale child resurrection after an aggregate tombstone', async () => {
    const aggregateId = randomUUID();
    const created = mutation({ entityId: aggregateId });
    await push(0, created);
    const childId = randomUUID();
    await push(0, mutation({ entityType: 'generic_child', entityId: childId, command: 'generic_child.create', payload: { aggregateId, body: 'child' } }));
    await push(0, mutation({ entityId: aggregateId, command: 'generic_record.delete', payload: null, baseRevision: 1 }));
    const staleChild = mutation({ entityType: 'generic_child', command: 'generic_child.create', payload: { aggregateId, body: 'stale' } });
    const result = await push(0, staleChild);
    expect(result.results[0]).toMatchObject({ status: 'conflict', code: 'aggregate_deleted' });
    const [child] = await admin<{ deleted_at: Date | null }[]>`select deleted_at from sync_entities where tenant_id = ${tenants[0]!} and entity_type = 'generic_child' and entity_id = ${childId}`;
    expect(child?.deleted_at).not.toBeNull();
  });

  it('expires old cursors and restricts ack to delivered progress', async () => {
    const firstPage = await sync.pull(contexts[0]!, { protocolVersion: 1, deviceId: devices[0]!, limit: 1 });
    await sync.acknowledge(contexts[0]!, { protocolVersion: 1, deviceId: devices[0]!, cursor: firstPage.nextCursor });
    await admin`update sync_tenant_sequences set minimum_available_sequence = 3 where tenant_id = ${tenants[0]!}`;
    await expect(sync.pull(contexts[0]!, { protocolVersion: 1, deviceId: devices[0]!, cursor: firstPage.nextCursor, limit: 1 })).rejects.toMatchObject({ code: 'sync_reset_required', statusCode: 410 });
    await admin`update sync_tenant_sequences set minimum_available_sequence = 1 where tenant_id = ${tenants[0]!}`;
  });

  it('materializes a consistent paginated bootstrap and catches up concurrent writes', async () => {
    const bootstrap = await sync.bootstrap(contexts[0]!, { protocolVersion: 1, deviceId: devices[0]!, pageSize: 2 });
    const concurrent = mutation({ payload: { body: 'concurrent' } });
    await push(0, concurrent);
    let token: string | null = bootstrap.pageToken;
    const entityIds: string[] = [];
    let catchUpCursor: string | null = null;
    while (token) {
      const page = await sync.bootstrapPage(contexts[0]!, { protocolVersion: 1, deviceId: devices[0]!, token });
      entityIds.push(...page.items.map((item) => String(item.entityId)));
      token = page.nextPageToken;
      catchUpCursor = page.catchUpCursor;
    }
    expect(entityIds).not.toContain(concurrent.entityId);
    const catchUp = await sync.pull(contexts[0]!, { protocolVersion: 1, deviceId: devices[0]!, cursor: catchUpCursor!, limit: 500 });
    expect(catchUp.changes.map((change) => change.entityId)).toContain(concurrent.entityId);
  });

  it('rejects incompatible versions before mutation and isolates two tenants', async () => {
    const item = mutation();
    await expect(sync.push(contexts[0]!, { protocolVersion: 2, deviceId: devices[0]!, mutations: [item] })).rejects.toBeInstanceOf(SyncError);
    const [missing] = await admin<{ count: number }[]>`select count(*)::int as count from sync_mutations where mutation_id = ${item.mutationId}`;
    expect(missing?.count).toBe(0);
    const tenantTwo = mutation();
    await push(1, tenantTwo);
    const pageOne = await sync.pull(contexts[0]!, { protocolVersion: 1, deviceId: devices[0]!, limit: 500 });
    expect(pageOne.changes.map((change) => change.entityId)).not.toContain(tenantTwo.entityId);
    await expect(sync.pull(contexts[1]!, { protocolVersion: 1, deviceId: devices[1]!, cursor: pageOne.nextCursor, limit: 1 })).rejects.toMatchObject({ code: 'invalid_cursor' });
  });

  it('rejects client metadata injection and another device bound to the same user', async () => {
    const injected = { ...mutation(), entityClass: 'append_only', aggregateGeneration: 99 };
    expect(() => pushSchema.parse({ protocolVersion: 1, deviceId: devices[0]!, mutations: [injected] })).toThrow();
    const otherDevice = randomUUID();
    await admin`insert into devices (id, tenant_id, user_id, label, platform, app_version) values (${otherDevice}, ${tenants[0]!}, ${users[0]!}, 'other', 'linux', 'test')`;
    await expect(sync.pull(contexts[0]!, { protocolVersion: 1, deviceId: otherDevice, limit: 1 })).rejects.toMatchObject({ code: 'device_session_mismatch' });
  });

  it('retains conflict proposals for durable text resolution', async () => {
    const entityId = randomUUID();
    await push(0, mutation({ entityId }));
    const proposal = mutation({ entityId, command: 'generic_record.update', baseRevision: 0, payload: { body: 'proposal' } });
    const result = await push(0, proposal);
    expect(result.results[0]).toMatchObject({ status: 'conflict', code: 'revision_conflict' });
    const [conflict] = await admin<{ command: string; base_revision: number; proposed_payload: { body: string }; proposed_payload_hash: string; request_hash: string }[]>`select command, base_revision, proposed_payload, proposed_payload_hash, request_hash from sync_conflicts where tenant_id = ${tenants[0]!} and mutation_id = ${proposal.mutationId}`;
    expect(conflict).toMatchObject({ command: 'generic_record.update', proposed_payload: { body: 'proposal' } });
    expect(Number(conflict?.base_revision)).toBe(0);
    expect(conflict?.proposed_payload_hash).toHaveLength(64);
    expect(conflict?.request_hash).toHaveLength(64);
  });

  it('garbage collects only acknowledged history older than 120 days and cleans bootstrap sessions', async () => {
    const item = mutation();
    const accepted = await push(1, item);
    const sequence = accepted.results[0]!.sequence!;
    await admin`insert into sync_cursors (tenant_id, device_id, acknowledged_sequence, greatest_delivered_sequence) select ${tenants[1]!}, ${devices[1]!}, committed_sequence, committed_sequence from sync_tenant_sequences where tenant_id = ${tenants[1]!} on conflict (tenant_id, device_id) do update set acknowledged_sequence = excluded.acknowledged_sequence, greatest_delivered_sequence = excluded.greatest_delivered_sequence, last_seen_at = now()`;
    await sync.bootstrap(contexts[1]!, { protocolVersion: 1, deviceId: devices[1]!, pageSize: 2 });
    await admin`update sync_changes set committed_at = now() - interval '121 days' where tenant_id = ${tenants[1]!} and sequence = ${sequence}`;
    await admin`update sync_mutations set completed_at = now() - interval '121 days' where tenant_id = ${tenants[1]!} and mutation_id = ${item.mutationId}`;
    await admin`update sync_bootstraps set expires_at = now() - interval '1 second' where tenant_id = ${tenants[1]!}`;
    const retained = await sync.runRetention(contexts[1]!, { protocolVersion: 1 });
    expect(retained.deletedChanges).toBeGreaterThan(0);
    expect(retained.expiredBootstraps).toBeGreaterThan(0);
    const [remaining] = await admin<{ count: number }[]>`select count(*)::int as count from sync_changes where tenant_id = ${tenants[1]!} and sequence = ${sequence}`;
    expect(remaining?.count).toBe(0);
    const [receipt] = await admin<{ count: number }[]>`select count(*)::int as count from sync_mutations where tenant_id = ${tenants[1]!} and mutation_id = ${item.mutationId}`;
    expect(receipt?.count).toBe(1);
  });

  it('rejects ancient offline mutation after tombstone and change GC while preserving graveyard and receipt', async () => {
    const entityId = randomUUID();
    const created = mutation({ entityId });
    await push(1, created);
    await push(1, mutation({ entityId, command: 'generic_record.delete', payload: null, baseRevision: 1 }));
    await admin`update sync_changes set committed_at = now() - interval '121 days' where tenant_id = ${tenants[1]!}`;
    await admin`update sync_tenant_sequences set mutation_not_before = now() - interval '120 days' where tenant_id = ${tenants[1]!}`;
    await admin`insert into sync_cursors (tenant_id, device_id, acknowledged_sequence, greatest_delivered_sequence) select ${tenants[1]!}, ${devices[1]!}, committed_sequence, committed_sequence from sync_tenant_sequences where tenant_id = ${tenants[1]!} on conflict (tenant_id, device_id) do update set acknowledged_sequence = excluded.acknowledged_sequence, greatest_delivered_sequence = excluded.greatest_delivered_sequence, last_seen_at = now()`;
    await sync.runRetention(contexts[1]!, { protocolVersion: 1 });
    const ancient = mutation({ entityId, clientCreatedAt: new Date(Date.now() - 121 * 86_400_000).toISOString() });
    await expect(push(1, ancient)).rejects.toMatchObject({ code: 'reconciliation_required' });
    const [graveyard] = await admin<{ count: number }[]>`select count(*)::int as count from sync_entities where tenant_id = ${tenants[1]!} and entity_id = ${entityId} and deleted_at is not null`;
    expect(graveyard?.count).toBe(1);
    expect(await push(1, created)).toMatchObject({ results: [{ status: 'accepted' }] });
  });

  it('advances mutation floor during GC, blocks old scalar overwrite, and accepts recent offline work', async () => {
    const scalarId = randomUUID();
    await push(1, mutation({ entityType: 'scalar_setting', entityId: scalarId, command: 'scalar_setting.set', baseRevision: null, payload: { value: 'current' } }));
    const [before] = await admin<{ mutation_not_before: Date }[]>`select mutation_not_before from sync_tenant_sequences where tenant_id = ${tenants[1]!}`;
    const retained = await sync.runRetention(contexts[1]!, { protocolVersion: 1 });
    const [after] = await admin<{ mutation_not_before: Date }[]>`select mutation_not_before from sync_tenant_sequences where tenant_id = ${tenants[1]!}`;
    expect(after!.mutation_not_before.getTime()).toBeGreaterThanOrEqual(before!.mutation_not_before.getTime());
    expect(new Date(retained.mutationNotBefore).getTime()).toBe(after!.mutation_not_before.getTime());

    const ancientScalar = mutation({ entityType: 'scalar_setting', entityId: scalarId, command: 'scalar_setting.set', baseRevision: null, payload: { value: 'ancient' }, clientCreatedAt: new Date(Date.now() - 121 * 86_400_000).toISOString() });
    await expect(push(1, ancientScalar)).rejects.toMatchObject({ code: 'reconciliation_required' });
    const recentScalar = mutation({ entityType: 'scalar_setting', entityId: scalarId, command: 'scalar_setting.set', baseRevision: null, payload: { value: 'recent' }, clientCreatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    expect(await push(1, recentScalar)).toMatchObject({ results: [{ status: 'accepted' }] });
    const [entity] = await admin<{ payload: { value: string } }[]>`select payload from sync_entities where tenant_id = ${tenants[1]!} and entity_type = 'scalar_setting' and entity_id = ${scalarId}`;
    expect(entity?.payload.value).toBe('recent');
  });
});
