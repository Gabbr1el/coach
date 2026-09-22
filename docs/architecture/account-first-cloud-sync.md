# RFC: Account-first cloud authority and resilient synchronization

Status: accepted for implementation

Owner: COA-309

Decision date: 2026-09-21

## Decision summary

Coach will use a modular TypeScript API as the only authority for account and
pedagogical data. The initial production stack is:

- Fastify API and worker processes, deployed from the same versioned image;
- PostgreSQL for canonical relational data, transactions, change ordering, and
  row-level security (RLS) as defense in depth;
- Supabase Auth (GoTrue) for password identity, email verification, password
  recovery, short access tokens, and rotating refresh tokens;
- S3-compatible object storage for original approved materials;
- a transactional email provider configured through Supabase Auth;
- OpenTelemetry traces and metrics plus structured, redacted JSON logs;
- Drizzle PostgreSQL migrations owned by the backend package.

Managed Supabase is the recommended first deployment for PostgreSQL and Auth.
The application data contract is the Fastify API, not PostgREST, direct table
access, Supabase RPCs, or the Supabase JavaScript data client. This keeps a
self-hosted deployment possible with PostgreSQL, GoTrue, S3-compatible storage,
SMTP, the Coach API, and the Coach worker.

The Electron Main process owns authentication calls, the protected refresh
token, SQLite, the durable outbox, the sync engine, and network access. The
renderer receives narrow account/domain projections through preload IPC. It
never receives a refresh token, provider secret, database credential, service
role key, presigned upload credential, or unrestricted API client.

PostgreSQL is authoritative. SQLite becomes an account-scoped materialized
cache and offline command queue. Deleting or corrupting SQLite must cause a
fresh bootstrap after login, not account or cloud-data loss.

Direct Gemini OAuth and the direct Gemini connector are not part of this
architecture. A model whose name contains Gemini remains valid when returned by
OmniRoute and is treated as an OmniRoute model.

The removed local restore mechanism is not part of recovery. Data export remains portability-only and is never a recovery authority.
Future data export, if implemented, is portability only and cannot replace the
cloud authority or mutate the live cache by file substitution.

## Why this option

### Rejected: a fake local account

An identity row in SQLite cannot provide account recovery, cross-device
sessions, secure password reset, remote revocation, or clean-install
rehydration. It would make corruption of the local cache an identity incident.

### Rejected: direct Supabase data access from Electron

Direct table access is fast to prototype, but it would distribute business
invariants across RLS policies, client writes, SQL functions, and local sync
code. It would also couple every shipped desktop version to cloud table shape.
Coach requires domain-specific conflict handling, private evaluator data,
idempotent commands, retained tombstones, and version negotiation. These belong
behind one versioned application API.

### Rejected: custom password and token implementation in the Coach API

Owning Argon2id parameters, password breach controls, verification and reset
flows, refresh-family rotation, replay detection, email abuse controls, and
incident response creates avoidable security work. A custom implementation can
be reconsidered only after an independent security review and migration plan.

### Rejected for the first release: Keycloak or a full enterprise IdP stack

Keycloak is self-hostable and mature, but its operational and configuration
surface is disproportionate for the initial consumer desktop flow. It remains
an option if enterprise federation and organization SSO become requirements.

### Why Fastify instead of Nest

The repository already favors explicit TypeScript contracts, Zod validation,
and service/repository boundaries. Fastify supplies typed request/response
schemas, hooks, structured logging, and low framework overhead without forcing
a decorator/module model. A modular monolith is sufficient; microservices,
Kafka, Redis, Elasticsearch, and Kubernetes are explicitly out of scope until
measured load requires them.

## Scope

This RFC defines:

- identity, verification, recovery, session rotation, and revocation;
- personal tenancy with an organization-compatible schema;
- the canonical cloud schema and ownership rules;
- a versioned sync protocol with outbox, cursor, idempotency, tombstones,
  bootstrap, and explicit conflicts;
- offline behavior and corruption recovery;
- legacy local-profile migration;
- material upload and storage boundaries;
- provider metadata and secret handling;
- threat model, privacy, observability, rollout, and acceptance tests.

This RFC does not implement the backend, login UI, sync client, redesign,
restore removal, Gemini removal, or reliability fixes. Those are separate
cards. No UI may claim cloud recovery or synchronization before the relevant
runtime acceptance tests pass against a real backend.

## Current-state audit

The current process composition in `src/main/index.ts` constructs nearly every
repository and service around one `CoachDatabase`. `src/main/database/connection.ts`
opens `coach.sqlite` under Electron `userData`, enables foreign keys and WAL,
then applies Drizzle migrations and several out-of-band repair routines.

The audit found 68 tables represented in `src/main/database/schema`. Five live
domain tables are present only in SQL migrations and raw queries:

- `weekly_plans` and `weekly_plan_items`;
- `daily_planning_budgets`;
- `plan_item_completion_history`;
- `review_help_events`.

Before sync implementation, the logical schema inventory must include both the
Drizzle declarations and migration-only tables. The backend schema must not be
generated by mechanically translating every SQLite table. Several current
tables are duplicated projections, device state, or worker state rather than
canonical user data.

The current credential vault in
`src/main/security/electron-credential-vault.ts` correctly rejects unavailable
encryption and Linux `basic_text`. SQLite stores only `secret_reference` for
provider accounts. However, startup orphan cleanup currently trusts the
instantaneous SQLite metadata set, and account deletion removes a secret before
removing metadata. Neither behavior is safe once SQLite is only a cache.

The current restore replaces SQLite while provider secrets remain outside the
backup. That mismatch is one reason restore cannot be an account recovery
mechanism and must be removed rather than extended.

## Trust boundaries

### Renderer

The renderer is untrusted application UI. It may request typed operations and
display sanitized projections. It cannot:

- hold refresh tokens or provider secrets;
- select an arbitrary tenant without server membership validation;
- issue SQL, generic table mutations, or arbitrary sync commands;
- receive private exercise tests, reference solutions, or evaluator payloads;
- decide that a mutation succeeded before Main records its durable outbox row;
- decide that a cloud row belongs to the signed-in user.

Existing `contextIsolation`, `sandbox`, disabled Node integration, navigation
controls, and IPC sender validation remain mandatory.

### Electron Main

Main is the trusted desktop client boundary. It owns:

- the auth adapter and serialized token refresh;
- access token in memory only;
- refresh token in the operating-system credential store;
- a stable random `device_id` registered to the authenticated session;
- account-scoped SQLite caches;
- transactional optimistic updates and outbox insertion;
- sync scheduling, retry, bootstrap, and conflict materialization;
- local provider adapters for explicitly device-only provider accounts.

Main is not trusted to establish tenancy. Every API operation is authorized
again by the server.

### Coach API

The Fastify API is the only public application-data authority. It validates
access-token signature, issuer, audience, algorithm, expiry, and `session_id`,
then verifies the corresponding Coach application session and tenant
membership. Every domain mutation executes in a PostgreSQL transaction and
writes its sync change in the same transaction.

### Auth service

Supabase Auth owns identities, password hashes, verification and recovery
tokens, refresh-token families, rotation, and refresh reuse detection. The
Coach API never receives or stores a plaintext password.

### Worker

The worker handles material processing, background generation, cleanup, and
other leased jobs. It uses server credentials unavailable to Electron. Job
publication and domain changes are transactional and idempotent.

## Identity and session contract

### Stable identifiers

- `user_id`: global immutable UUID assigned by Auth.
- `tenant_id`: UUID assigned by Coach; a verified user initially receives one
  personal tenant.
- `device_id`: random UUID generated once per installation and registered after
  login. It is not derived from hardware serials or other fingerprints.
- `session_id`: Coach application-session UUID associated with an Auth session
  and one device.

Email is normalized by the identity service and unique under its configured
rules. Domain tables reference immutable IDs, never email.

### Signup

1. Main asks Auth to create an identity over TLS.
2. Auth applies rate limits and sends a verification email.
3. The desktop displays `verification_required`; no durable tenant data is
   provisioned yet.
4. The HTTPS verification landing page consumes the one-time Auth token.
5. It returns a short-lived, single-use authorization code to the app through
   an allowlisted custom protocol or universal/app link.
6. Main exchanges the code, stores the refresh token in the OS vault, and keeps
   the access token in memory.
7. `POST /v1/account/provision` idempotently creates the personal tenant,
   membership, device, and application session.

Email links must not contain a refresh token or Coach access token. Custom
protocol handlers accept only an authorization code plus state, validate PKCE
and state, and reject unexpected hosts, paths, and duplicate use.

### Login and refresh

- Access-token lifetime starts at 15 minutes and is configuration-controlled.
- Refresh sessions follow the Auth provider's rotation and replay detection.
- Main serializes refresh per session. Concurrent requests await one refresh;
  they never rotate the same refresh token independently.
- Main writes a replacement refresh token through an atomic, versioned vault
  update before considering a rotation durable: write and fsync a temporary
  record, atomically rename it, fsync the containing directory where supported,
  then retire the previous record only according to verified Auth grace/parent
  semantics. The adapter must test lost responses and crash points on every
  supported operating-system vault backend. The current direct `writeFile`
  vault implementation does not satisfy this contract.
- If secure OS storage is unavailable, persistent login is disabled. The user
  may use an explicitly labeled session-only login whose refresh credential is
  held in memory and lost on app exit. SQLite is never the fallback token store.

### Application session registry

The Coach API maintains `app_sessions` with `user_id`, `device_id`, Auth
`session_id`, timestamps, revocation reason, last seen version, and coarse
network metadata. The Auth access token must contain the documented immutable
Auth session claim for the selected GoTrue version; absence or mismatch fails
closed. `(user_id, auth_session_id)` is unique. Provisioning binds a client
generated `device_id` to that authenticated Auth session idempotently and never
accepts a user or Auth-session ID from the request body. Every API request checks
that the mapped Coach session is active. This makes individual device revocation
effective immediately for Coach APIs even if a signed access token has minutes
remaining.

Auth security events that invalidate identity sessions, including password
recovery and global logout, reach Coach through an authenticated, replay-safe
hook or a reconciler over the Auth administration API. Hook events have unique
IDs and are processed idempotently. Until the exact Auth session claim, event
delivery, and individual revocation API are proven for the selected version,
production auth is blocked.

Required operations:

- list the current user's devices/sessions;
- revoke one application session;
- revoke all sessions except current;
- logout current locally and remotely;
- logout all;
- revoke all sessions after password recovery by default;
- record refresh reuse and security-sensitive revocations.

The implementation spike must verify the exact supported Auth administration
API for revoking the underlying refresh session. If individual Auth-session
revocation is unavailable in the selected deployment, the Coach registry still
blocks all application APIs immediately and the server must revoke the smallest
supported Auth scope. Individual or safely broader underlying revocation is a
production release gate; a UI warning is not an acceptable substitute.

### Recovery and enumeration safety

Password-reset requests return the same public response for known and unknown
addresses and have comparable timing. Reset tokens are one-time and short
lived. Successful recovery revokes existing sessions unless the owner later
approves a different policy after security review.

Signup, login, resend, reset, code exchange, and session provisioning are rate
limited by endpoint, IP/network signal, account where known, and bounded device
signal. Logs never contain passwords, bearer tokens, authorization codes, email
link tokens, or complete email addresses.

## Tenancy and authorization

The schema is organization-shaped even though the first release provisions
only personal tenants:

```text
auth.users
  └── tenant_memberships ── tenants
             ├── app_sessions ── devices
             └── tenant-owned domain records
```

Every tenant-owned table carries `tenant_id` directly. Child rows do not rely
only on reaching tenancy through a parent because explicit tenancy improves
authorization review, composite foreign keys, indexing, and RLS policy safety.

The server never trusts a client-supplied `tenant_id`. It resolves the requested
tenant against the authenticated user's active membership and role before a
domain handler runs. Resource lookup uses `(tenant_id, id)`, not `id` alone.

The first protocol binds each request to the one personal tenant resolved from
the session; it accepts no tenant selector. When organization switching is
added, the selected tenant becomes an explicit route/header value validated
against membership. Sync cursors, bootstrap sessions, mutations, and
acknowledgements bind to exactly one tenant. A unique personal-tenant owner key
makes concurrent provisioning create exactly one personal tenant.

PostgreSQL RLS is defense in depth:

- the request transaction sets local `coach.user_id`, `coach.tenant_id`, and
  `coach.session_id` values after authentication;
- policies require the tenant context and an active membership;
- the runtime database role does not own tables and lacks `BYPASSRLS`;
- schema migrations and controlled maintenance use separate roles;
- common indexes lead with `tenant_id`;
- composite foreign keys prevent cross-tenant parent/child references.

Every tenant repository call runs inside one required transaction wrapper:
authenticate, begin, `SET LOCAL` all request identities, verify them, execute,
and commit/rollback. Tenant repositories cannot acquire a connection outside
this wrapper. Use `FORCE ROW LEVEL SECURITY` where appropriate, safe
`current_setting(..., true)` default-deny policies, revoked direct table grants,
and no unreviewed `SECURITY DEFINER` function. Pool-reuse tests alternate users,
tenants, missing context, workers, and failed transactions.

Authorization remains explicit in application services. RLS is not a reason to
expose PostgreSQL directly or omit ownership tests.

## Canonical cloud schema

All tables use UUID primary keys unless a natural immutable key is stated.
Mutable sync entities include `revision bigint`, `created_at timestamptz`,
`updated_at timestamptz`, and nullable `deleted_at`. Server time is authoritative.
JSON payloads carry an explicit schema version and are validated on ingress.

### Identity and operations

```text
profiles(user_id, display_name, locale, timezone, revision, ...)
tenants(id, kind, name, ...)
tenant_memberships(tenant_id, user_id, role, status, ...)
devices(id, user_id, label, platform, app_version, last_seen_at, ...)
app_sessions(id, user_id, device_id, auth_session_id, revoked_at, reason, ...)
security_audit_events(id, user_id, session_id, type, outcome, metadata, ...)
sync_mutations(tenant_id, mutation_id, user_id, device_id, request_hash, state, result, committed_sequence, ...)
sync_changes(tenant_id, sequence, entity_type, entity_id, operation, revision, payload_version, payload, payload_hash, ...)
sync_cursors(tenant_id, device_id, acknowledged_sequence, last_seen_at, ...)
sync_conflicts(id, tenant_id, entity_type, entity_id, mutation_id, status, ...)
sync_tenant_sequences(tenant_id, committed_sequence)
```

`sync_changes.sequence` is a hole-free per-tenant commit order, not a PostgreSQL
`SEQUENCE` value. The domain transaction locks the tenant's
`sync_tenant_sequences` row, increments it, and writes the change before commit;
concurrent publications for that tenant wait for this short section. Pull
exposes only this contiguous committed watermark. This deliberately trades
per-tenant publication throughput for correctness in the first version.

Each change stores the immutable public payload or tombstone for exactly its
declared entity revision, payload version, and hash. Pull never joins an old
change to a newer mutable row. Ordering never uses client time.

`sync_mutations` stores a replayable result. Its canonical `request_hash` covers
protocol, authenticated actor, device, command, entity, base revision, payload
version, and payload. Reusing a mutation ID with another hash returns
`idempotency_key_reused`. The first transaction owns the pending record;
competitors lock/wait and return its terminal result. Accepted and deterministic
rejected outcomes are terminal and replayable.

### Cloud-authoritative domain families

The following are canonical cloud data:

- profile and account preferences;
- workspaces, learning overrides, academic context relationships, and accepted
  roadmap decisions;
- conversation threads and committed messages;
- academic-life items, availability, deadlines, planner decisions, and explicit
  completion history;
- projects and project files;
- completed study sessions, saved-for-later items, notes, confirmed editor
  documents, and user-approved context-sharing preferences;
- learning attempts, checkpoint answers, exercise submissions, help events,
  learning evidence, and review answers;
- ConceptMemory and progress projections produced by the server from evidence;
- weekly plans, roadmap state, accepted adaptations, and reports needed for
  continuity;
- original approved material metadata and object references;
- provider account metadata and secret policy;
- account devices, sessions, and security events.

Reports that are deterministic projections may be regenerated, but the source
events and any user-saved report snapshot are canonical.

### Immutable generated artifacts

Generated roadmap, lesson, exercise, assessment-variant, and analysis payloads
are stored as immutable versioned artifacts when needed for continuity. Each
artifact records:

- tenant/workspace ownership;
- artifact type and stable unit key;
- content revision and generator contract version;
- canonical input hash and payload hash;
- provider/model provenance without credentials;
- creation status and publication pointer.

A changed artifact is a new row/version. Clients do not merge generated bodies
or private evaluator payloads. Accepted pointers and user adaptations are
canonical decisions.

Private tests, reference solutions, expected predictions, and evaluator payloads
remain server-private. The desktop receives only public exercise data and a
sanitized result after server evaluation.

### Cloud metadata plus object storage

PostgreSQL stores material ownership, name, media type, size, SHA-256, object
key, status, role, relevance, extraction/analysis versions, and timestamps.
Original bytes live in object storage under opaque keys such as:

```text
tenants/<tenant-id>/materials/<material-id>/<object-version>
```

The API issues short-lived presigned upload/download URLs only after ownership
and quota checks. Upload completion verifies expected size, MIME allowlist, and
checksum before the material becomes available. A staged upload is never
treated as an approved source. Extracted text may begin in PostgreSQL; larger
artifacts may move to object storage after measurement without changing the
public contract.

Uploads target a unique staging object/version. Completion verifies
server-observed bytes and checksum, then promotes to a new immutable final
object version; a still-valid staging URL cannot overwrite published content.
The parser has no network, receives read-only input, and enforces CPU, memory,
file-count, nesting, decompression-ratio, and output limits. Content sniffing is
independent of the declared MIME type.

### Server-operational data

The server owns content jobs, leases, retries, required-unit manifests,
material-processing jobs, provisioning orchestration, email-adjacent jobs,
change retention, and security audit storage. These are not general client-sync
entities. The persistent job contract in
`docs/architecture/progressive-provisioning.md` remains useful but moves to the
server when generation becomes cloud-operated.

### Device-only data

The following never becomes ordinary cloud authority:

- SQLite indexes, FTS tables, inbox, outbox, cursor, and bootstrap bookkeeping;
- current window/navigation state and open editor tabs;
- running timer monotonic time and boot identifier;
- unsaved transient drafts until explicitly committed;
- local toolchains, binaries, build output, terminal state, and transient code
  execution results;
- performance traces tied to one machine;
- temporary extraction files and rebuildable caches;
- access token in memory and refresh token in the OS credential store;
- provider secrets explicitly configured as device-only.

## Provider accounts and secrets

Provider metadata and secret material have separate records and lifecycles.

### Supported policies

Each provider account declares one policy:

- `cloud_vault`: available on the account's devices; AI requests using it are
  executed by the Coach API/worker. The secret is envelope-encrypted and never
  sent back to a desktop after initial submission.
- `device_only`: metadata may sync, but the secret exists only in the OS vault
  of devices where the user configures it. The UI must state that a clean
  installation needs the key again.

The first production release should support `device_only` for local endpoints
and flows that cannot safely run server-side. Cloud rehydration of a provider is
promised only for accounts explicitly marked `cloud_vault`.

Arbitrary user-configured OpenAI-compatible URLs are device-only. Cloud
execution supports only reviewed connectors/origins or a hardened outbound
proxy. It rejects private, loopback, link-local, metadata, and disallowed IP
ranges after DNS resolution and at connection time; constrains redirects and
revalidates their destinations; bounds time and bytes; and sends a credential
only to its registered origin. DNS rebinding and IPv4/IPv6 alternate forms are
mandatory tests.

### Cloud vault design

- Generate a random data-encryption key (DEK) per secret version.
- Encrypt the provider secret with an authenticated cipher such as AES-256-GCM.
- Wrap the DEK with a KMS-managed key-encryption key (KEK).
- Store ciphertext, nonce, tag, wrapped DEK, key version, tenant/account IDs,
  creation time, and state separately from ordinary provider metadata.
- Bind tenant/account/version as authenticated additional data.
- Decryption occurs only in the API/worker operation that needs the credential.
- Audit create, use category, rotate, disable, and delete events without logging
  the secret or provider response body.
- Separate KEKs and access policy from database backups; rotate KEKs with
  versioned rewrapping.
- Jobs reference one immutable secret version. Rotation creates a new version;
  leased jobs finish with their pinned version or are fenced/cancelled. Decrypt
  is denied after fencing, and plaintext exists only for the bounded call.

Self-hosting may use a Vault-compatible service or a mounted master key with a
documented rotation procedure. A key committed to a repository, stored beside
the database backup, or supplied to Electron is not acceptable.

### Provider deletion state machine

Deletion is idempotent and recoverable:

```text
active -> deleting -> revoked -> secret_destroyed -> deleted
```

1. Mark metadata `deleting`; new provider use is denied.
2. Revoke remote OAuth/provider grants where applicable.
3. Destroy the cloud secret or publish a confirmed device-secret tombstone.
4. Mark deletion complete and emit a sync tombstone.

A retry resumes from the recorded state. Metadata is not left active while its
secret has already disappeared. Device vault cleanup runs only from a confirmed
server tombstone or an explicit local-only deletion operation. It never removes
secrets merely because one SQLite query temporarily lacks metadata.

Remote grant revocation has bounded retries and may finish as
`revocation_unconfirmed`; it cannot hold local cryptographic destruction or
account deletion hostage indefinitely. Destruction waits for pinned jobs to be
cancelled/fenced and is auditable. Current startup `removeOrphans` behavior must
be removed before account-scoped caches or bootstrap ship.

Gemini is not a provider account type. OmniRoute model discovery must accept
Gemini model names without creating Gemini OAuth, tokens, panels, or adapters.

## Sync protocol

### Principles

- Commands express domain intent; clients do not replicate arbitrary tables.
- Every accepted mutation and its change-log row commit atomically.
- Every mutation is idempotent.
- Server sequence, entity revision, and tombstone are distinct concepts.
- Client timestamps are informational and never decide ownership or order.
- Conflict policy is selected by domain, never one global last-write-wins rule.
- A stale or expired cursor triggers bootstrap, never guessed reconciliation.

### Local write transaction

For an offline-capable command, Main performs one SQLite transaction:

1. validate the typed command;
2. allocate a UUIDv7 `mutation_id` and entity IDs where allowed;
3. insert the immutable outbox command with its `base_revision`;
4. update the optimistic local projection;
5. mark affected rows `pending_sync` and commit;
6. notify the renderer only after commit.

If SQLite is unavailable, the command is not acknowledged as saved. Sensitive
commands such as account security changes, provider cloud-secret changes, and
session revocation require connectivity and are not queued as ordinary offline
domain mutations.

### Push request

```json
{
  "protocolVersion": 1,
  "deviceId": "uuid",
  "mutations": [
    {
      "mutationId": "uuidv7",
      "entityType": "project_file",
      "entityId": "uuid",
      "command": "project_file.update",
      "baseRevision": 12,
      "payloadVersion": 1,
      "payload": {},
      "clientCreatedAt": "2026-09-21T00:00:00.000Z"
    }
  ]
}
```

`POST /v1/sync/push` accepts a bounded batch. For each mutation, one server
transaction:

1. authenticates session and resolves tenant membership;
2. finds or inserts `(tenant_id, mutation_id)` in `sync_mutations` and validates
   the canonical request hash;
3. returns the recorded result when already committed;
4. validates command schema, ownership, permission, entity state, tombstone,
   base revision, and domain invariants;
5. locks or conditionally updates the target;
6. applies the command or records a structured conflict;
7. increments the entity revision, locks/increments the tenant commit sequence,
   and writes the immutable revision payload to `sync_changes`;
8. stores the mutation result and commits before acknowledging it.

One rejected mutation does not roll back unrelated mutations in the batch.
Commands that must be atomic together use one explicit compound domain command,
not adjacent batch entries.

### Pull response and cursor

`GET /v1/sync/pull?cursor=<opaque>&limit=<n>` returns:

```json
{
  "protocolVersion": 1,
  "changes": [],
  "nextCursor": "opaque-versioned-value",
  "hasMore": false,
  "serverTime": "2026-09-21T00:00:00.000Z",
  "minimumSupportedCursor": "opaque-versioned-value"
}
```

The cursor encodes a version and last committed `sync_changes.sequence`; it is
authenticated or otherwise tamper-resistant and treated as opaque by clients.
Changes are ordered by server sequence. Pull payloads contain complete bounded
entity projections or typed deltas chosen by entity contract, never private
server fields.

Main applies one page and advances its inbox cursor in the same SQLite
transaction. Reapplying a page is harmless. The device acknowledges durable
progress separately so retention monitoring can detect stale devices.

`POST /v1/sync/ack` accepts only a cursor previously issued to the same tenant
and device, advances monotonically, and cannot exceed that device's greatest
delivered sequence. Acknowledgements inform monitoring and garbage-collection
eligibility, but no client can shorten the fixed retention floor.

### Tombstones and retention

Deletion writes `deleted_at`, increments revision, and emits a tombstone. A
tombstone includes entity identity, deletion revision, and server sequence but
not the removed sensitive payload.

Initial policy:

- support 90 days offline;
- retain tombstones and mutation deduplication for at least 120 days;
- retain longer where legal/account-deletion policy requires it;
- return `410 sync_reset_required` when a cursor predates available history.

A reset discards the disposable cache only after preserving unsent outbox
commands. Main exports those commands to a protected internal migration buffer,
bootstraps a new cache, then rebases or surfaces conflicts. It never uploads a
raw SQLite database as authority.

Expiring generic mutation records never permits a non-repeatable side effect to
run twice. Create/append commands use permanent unique client entity/event IDs;
other non-repeatable commands carry a durable domain idempotency key. An outbox
entry older than the replay horizon becomes `reconciliation_required` and is
never blindly replayed.

Aggregate deletion contracts declare either deterministic local child cascade
or explicit child tombstones. Every child validates the aggregate generation so
a stale descendant cannot recreate or attach to a deleted aggregate.

### Bootstrap and clean installation

`POST /v1/sync/bootstrap` creates a bounded bootstrap-session resource. In one
repeatable-read transaction the server records the tenant, protocol/schema
versions, contiguous sync watermark, canonical entity order, counts and hashes,
and materializes immutable page manifests/payload references. The session
expires; signed page tokens bind tenant, Coach session, bootstrap ID, and page
position. Concurrent changes after the watermark arrive through normal pull.
Expiry restarts bootstrap; page boundaries never observe moving rows.

Main writes bootstrap pages to a new account-scoped cache file. After all pages,
counts, hashes, schema version, and foreign-key/logical checks pass, it atomically
marks that cache current. Failure leaves the previous usable cache untouched.
On a clean installation there is no previous cache; the user sees explicit
rehydration progress and can retry safely.

Cursor-reset preservation is a journaled state machine. The old cache remains
read-only until the new cache and reimported outbox are verified. The buffer is
integrity-protected and bound to environment, account, tenant, and device; it
retains dependencies and local-ID mappings. Each command declares
`replayable`, `rebaseable`, `conflict_required`, or `non_replayable` behavior.

### Retry and connectivity

- Retry transport failures, 408, 429, and retryable 5xx responses with capped
  exponential backoff and full jitter.
- Respect `Retry-After` where valid.
- Do not automatically retry authentication, authorization, invalid command,
  quota, or explicit conflict responses as if they were network failures.
- Pause push while a refresh is unresolved; resume after one serialized refresh.
- Sync wakeups occur on local mutation, connectivity return, app resume, and a
  bounded periodic timer.
- Backpressure limits batch count and bytes; large objects use object storage,
  not the JSON sync stream.

Auth-owned endpoints use Auth/edge rate limits. Coach endpoints use shared
PostgreSQL-backed counters in the initial multi-instance deployment, not
per-process memory. Versioned configuration defines keys, windows, bursts,
trusted-proxy parsing, IPv6 normalization, privacy retention, lockout safety,
and degraded behavior. Integration tests attempt bypass across API replicas.

## Conflict policy

The API returns a stable public conflict code, entity ID, current revision, and
a sanitized current projection or resolution token. Conflict records are
durable until resolved or explicitly discarded.

### Append-only records

Messages, attempts, evidence, help events, and completed session events use
globally unique IDs and idempotency keys. Independent concurrent inserts both
survive. Conversation display order is server sequence within a thread, with
client creation time retained only as metadata.

### User text and project files

Notes, confirmed documents, and project files require `base_revision`.

- If current revision matches, apply and increment.
- If both versions changed from the same base, attempt a deterministic three-way
  text merge only when the base body is retained and the merge has no overlapping
  edits.
- A clean merge is committed as a new server revision with both mutation IDs in
  provenance.
- Otherwise preserve both versions, mark an explicit conflict, and require user
  resolution. Neither body is silently discarded.

The server retains immutable text versions or patches for at least the conflict
window. Canonical UTF-8/line-ending normalization, payload limits, and a
versioned merge algorithm are entity-contract fields. If the common base is no
longer available, the server returns an explicit conflict and never guesses.

### Scalar preferences

Independent scalar preferences may use server commit order only when the entity
contract declares that policy. The accepted value is echoed and synchronized to
all devices. Security preferences never use this rule.

### Progress and evidence

Clients upload immutable attempts/events. The server derives counters, mastery,
topic state, ConceptMemory, retention, and reports. Clients never merge or add
two mutable aggregate rows. Duplicate evidence is rejected by idempotency key
and payload hash.

### Roadmaps and generated learning content

Roadmap acceptance, rebuild, adaptation activation, and completion use explicit
domain commands with expected content revision. Stale commands are rejected or
rebased through a preview; generated JSON is never last-write-wins merged.
Publication of generated content remains guarded by current workspace revision,
input hash, cancellation generation, and server-side validation.

### Planning

Canonical planning inputs and explicit completion/edit actions synchronize.
Weekly plan items are server projections. The current duplication between
`weekly_plan_items` and `study_plan_items` must not become two cloud authorities.
Concurrent explicit edits to the same plan item require base revision; derived
replanning cannot silently undo a newer user completion.

### Delete versus update

- Update based on a revision older than a tombstone is rejected as
  `entity_deleted`.
- Undelete is a distinct authorized command where the domain supports it.
- Workspace deletion begins with archived/tombstoned state and a retention
  period; physical cascade purge is server maintenance after retention.
- A stale client cannot recreate a deleted aggregate by replaying child rows.

## Local cache layout and lifecycle

Use one SQLite cache per signed-in account, named by a non-secret hash of
`user_id` and environment. Never open one user's cache for another user. A small
device registry outside those databases may map account ID to cache path and
last-used metadata, but contains no domain records or refresh token.

Required local sync tables include:

```text
local_sync_state(account_id, tenant_id, protocol_version, cursor, bootstrap_state, ...)
local_outbox(mutation_id, command, payload, base_revision, state, attempts, ...)
local_inbox(sequence, applied_at, payload_hash, ...)
local_conflicts(id, mutation_id, entity_type, entity_id, state, payload, ...)
local_entity_state(entity_type, entity_id, server_revision, sync_state, ...)
```

All domain reads in the desktop are account-scoped. The application must stop
using global singleton assumptions such as one active provider or one planning
row without account/tenant context. Device-only singleton state stays in a
separate device namespace.

On logout:

1. attempt remote session revocation when requested;
2. remove access token from memory;
3. delete refresh token from the OS vault;
4. stop sync and provider work for that account;
5. close the SQLite handle;
6. retain or remove the cache according to explicit product policy, but never
   treat retained data as an active session.

The first release requires online authentication after process restart before
opening account data. An already open app may continue an explicitly bounded
offline session, but remote revocation cannot erase or hide bytes already cached
on a disconnected stolen device. Until account-scoped cache encryption and a
local unlock policy are implemented, logout/session revocation protects future
API access, not local disk confidentiality. Product text must state this limit;
shared-tenant offline access is not enabled before that risk is resolved.

Cache corruption handling closes and quarantines the bad file, creates a new
cache, and bootstraps from cloud after authentication. It does not delete the
account, revoke the account, or upload corrupted rows.

## Legacy local-profile migration

Migration is an explicit, resumable import into a verified account. It is not
backup restore and never makes a raw SQLite file authoritative on the server.

### Preconditions

- user is authenticated and email-verified;
- target personal tenant exists;
- current local schema passes `quick_check`, `foreign_key_check`, and logical
  relationship validation;
- no other import with a different manifest is active for the tenant;
- the legacy installation has a stable random source-profile ID and the frozen
  snapshot has a canonical snapshot ID not already finalized for this tenant;
- the user sees what categories and provider-secret limitations will migrate.

### Import protocol

1. Main enters migration mode and stops domain writes to the legacy profile.
2. It builds a canonically encoded, versioned manifest with source profile and
   snapshot IDs, ordered category counts, content hashes, material object hashes,
   and source schema version. Secrets and transient telemetry are excluded.
3. `POST /v1/imports` creates an idempotent `migration_id` for that manifest.
4. Main uploads typed entities in declared dependency order, each batch keyed by
   `(migration_id, batch_id)`.
5. The server validates ownership-independent legacy IDs, remaps collisions,
   records old-to-new IDs, enforces references, and never infers tenant from an
   imported ID.
6. Original material files, when still available, upload separately by checksum.
   Missing originals are reported; extracted text alone is not mislabeled as a
   portable original.
7. The server computes projections from imported events and compares category
   counts/hashes with the manifest.
8. `POST /v1/imports/:id/finalize` checks the target tenant revision captured at
   import creation, detects concurrent cloud conflicts, and atomically publishes
   staged metadata or reports a typed failure. Verified immutable objects are
   referenced only at publication; abandoned staging is collected separately.
9. Main bootstraps a fresh account-scoped cache from cloud and verifies it.
10. Only after verification does Main mark the legacy profile imported and stop
    opening it as live authority.

The legacy database may be retained read-only for a bounded migration-audit
period, clearly labeled non-authoritative, then deleted by retention policy.
There is no UI or code path that replaces the live cache from that file. Partial
imports remain isolated and can be resumed or discarded server-side.
Every imported record retains source provenance. Tenant uniqueness on completed
source snapshot IDs prevents accidental repeat import after finalization.

### Classification during import

- Import user declarations, conversations, projects, canonical planning input,
  attempts, evidence, notes, saved items, and accepted decisions.
- Import immutable generated artifacts only when their schema, ownership,
  content hash, and contract version validate; otherwise regenerate later.
- Recompute progress, ConceptMemory, weekly plans, organizer state, reports, and
  other projections from canonical inputs.
- Do not import content-job leases, migration journal rows, performance
  timelines, project build output, timer monotonic state, or UI state.
- Import provider metadata with policy `device_only` by default. Existing vault
  secrets remain local and are never silently uploaded. The user must explicitly
  opt into cloud-vault transfer and reauthenticate where required.

## API surface

Initial versioned endpoints:

```text
POST   /v1/account/provision
GET    /v1/account/profile
PATCH  /v1/account/profile
DELETE /v1/account

GET    /v1/account/sessions
DELETE /v1/account/sessions/:sessionId
POST   /v1/account/sessions/revoke-others
POST   /v1/account/logout

POST   /v1/sync/bootstrap
POST   /v1/sync/push
GET    /v1/sync/pull
POST   /v1/sync/ack

POST   /v1/imports
PUT    /v1/imports/:migrationId/batches/:batchId
POST   /v1/imports/:migrationId/finalize
DELETE /v1/imports/:migrationId

POST   /v1/materials/:materialId/upload-intent
POST   /v1/materials/:materialId/upload-complete
GET    /v1/materials/:materialId/download-intent

GET    /v1/providers
POST   /v1/providers
PATCH  /v1/providers/:providerAccountId
DELETE /v1/providers/:providerAccountId
```

Auth signup, login, verification, recovery, and token refresh use the Auth
adapter rather than being reimplemented as Coach password endpoints. Main wraps
them behind typed preload contracts so the renderer is independent of vendor
SDK details.

All responses use stable public error codes and a request ID. Internal errors,
SQL details, provider response bodies, and stack traces never cross the public
boundary.

## Version compatibility

The desktop sends app version and sync protocol version. The API advertises:

- minimum and maximum supported protocol versions;
- minimum supported desktop version for security-critical changes;
- capabilities for optional command/entity versions.

Additive response fields are tolerated. A client never sends an unknown command
version. Breaking changes require a new protocol version and an overlap window.
Unsupported clients receive a clear upgrade-required response without mutating
data.

## Threat model and controls

### Stolen password or brute force

Controls: Auth-managed password hashing, email verification, generic recovery
responses, endpoint/IP/account rate limits, breached-password controls where
available, security event audit, and optional MFA in a later phase. Exact Auth
password policy and Argon2id-equivalent guarantees must be verified against the
selected hosted/self-hosted version before production.

### Refresh-token theft or replay

Controls: OS credential vault, no renderer exposure, rotation, replay detection,
serialized refresh, application-session checks on every API call, individual
and global revocation, short access-token lifetime, and no token logging.

### Cross-tenant direct-object access

Controls: server-resolved membership, `(tenant_id, id)` lookups, composite
foreign keys, RLS, non-owner runtime role, negative authorization tests, and no
direct database API.

### Malicious or compromised renderer

Controls: narrow preload API, sender validation, context isolation, sandbox,
navigation allowlists, no Node integration, server authorization, typed command
allowlists, payload limits, and secret/private-evaluator exclusion.

### Lost or stolen device

Controls: remote session listing/revocation, protected refresh credential,
immediate Coach-session block, local logout cleanup, minimal security metadata,
and documented limits of unencrypted local cache. Database-at-rest encryption
is a separate decision; until implemented, the UX and threat model must not
claim that all cached educational content is encrypted on disk.

### Provider-secret disclosure

Controls: device vault or envelope-encrypted cloud vault, no read-back, KMS
separation, least-privilege decrypt path, audit, redaction, secret-state machine,
and no orphan cleanup based only on cache contents.

### Sync replay, duplication, and stale writes

Controls: UUID mutation ID, tenant-scoped deduplication, payload hash, base
revision, transactional change log, tombstones, retained results, server order,
and domain conflict rules.

### Cache deletion or corruption

Controls: cloud authority, fresh bootstrap, atomic cache promotion, no identity
inside SQLite, protected outbox preservation where readable, and explicit notice
when unsynced local-only changes cannot be recovered from an unreadable disk.
Cloud authority prevents loss of synchronized data; it cannot promise recovery
of changes that never reached durable local storage or the server.

### Material and parser attacks

Controls: MIME and size allowlists, checksum verification, isolated worker,
timeouts and resource limits, malware scanning where available, opaque object
keys, short presigned URLs, no active content execution, and sanitized extracted
text.

### Insider/service-operator access

The server must inspect educational content to sync, search, generate, and
resolve conflicts. This design provides encryption in transit and at rest, not
end-to-end encryption from the service operator. Product and privacy text must
state this accurately. Sensitive production access is least-privilege, audited,
time-bounded, and separated from routine support.

### Account deletion and retention

Account deletion requires recent authentication, marks the account pending
deletion, revokes sessions, stops processing, and runs a documented purge across
PostgreSQL, object storage, vault entries, logs, and backups according to legal
retention. The UI states the delay and irreversible point. Backup erasure and
educational-data privacy requirements require legal review before launch.

An independently protected deletion-suppression ledger survives ordinary PITR
and is replayed before restored services reopen. Restore reconciliation must not
resurrect deleted identities, object references, provider ciphertext, or jobs.
Per-account cryptographic erasure is used where feasible.

## Observability and privacy

API and worker emit structured logs and OpenTelemetry traces/metrics. Stable
UUIDs are personal data, not inherently pseudonymous. Routine telemetry uses
environment-keyed rotating hashes where practical; raw identifiers are limited
to access-controlled security/audit stores:

```text
request_id, trace_id, tenant_id, user_id, session_id, device_id,
mutation_id, sync_sequence, job_id
```

Never emit passwords, tokens, provider keys, signed URLs, authorization codes,
chat bodies, prompts, material excerpts, source code, private tests, or full
email addresses.

Initial service-level indicators:

- signup, verification, login, recovery, and refresh success/failure;
- email delivery failure and refresh-reuse detections;
- session revocation latency;
- sync push/pull latency, outbox age/depth, conflicts, retries, and cursor resets;
- bootstrap duration, count/hash failures, and clean-install success;
- material upload/verification/processing failures;
- worker queue age, retries, stale publication rejection, and provider failures;
- database pool saturation, API latency/error rate, and RLS authorization denial.

Telemetry retention, access, region, and sampling are configuration with a
published privacy policy. Application logs stay useful without containing user
content.

## Deployment and recovery

### Managed-first production

- managed Supabase PostgreSQL/Auth with point-in-time recovery on the selected
  production plan;
- one horizontally scalable API container;
- one or more worker containers using PostgreSQL leases;
- managed S3-compatible object storage;
- transactional email provider with domain authentication;
- OpenTelemetry collector and monitored backend;
- separate migration job and least-privilege runtime role.

### Self-host profile

- TLS reverse proxy/load balancer;
- Coach API and worker containers;
- PostgreSQL;
- compatible GoTrue/Auth deployment;
- S3-compatible object storage such as MinIO;
- SMTP relay;
- OpenTelemetry collector plus chosen metrics/log/trace backend;
- automated encrypted database and object backups with routine restore drills.

Self-hosting transfers patching, monitoring, high availability, email delivery,
backups, disaster recovery, and key management to the operator. It is a
supported deployment target only after its own runtime acceptance suite passes;
the existence of Docker images is not proof of production readiness.

Backend disaster recovery uses managed PITR/backups and object-storage versioning
or replication. This is separate from the removed desktop SQLite restore.
PostgreSQL records immutable object versions and an object-publication journal.
Backup watermarks, restore order, KMS key availability, missing/orphan object
reconciliation, and the deletion-suppression ledger form one recovery runbook.
Restore drills verify object hashes at a named recovery point, not only rows or
object references.

## Rollout plan

### Phase 0: contract and security spikes

- Verify Supabase Auth device-session listing/revocation and refresh replay
  behavior for the exact version/plan.
- Prove desktop verification/recovery with PKCE and one-time code exchange on
  Windows and Linux; add macOS before claiming macOS support.
- Benchmark data volumes and bootstrap pages using anonymized fixtures.
- Decide production KMS, email, object storage, regions, retention, and legal
  policy.
- Reconcile migration-only SQLite tables into a complete logical inventory.
- Remove or hard-disable vault orphan cleanup before any account-scoped cache
  reset, account switch, or bootstrap experiment.

Exit: recorded spike evidence, no unresolved blocker to individual revocation,
refresh safety, tenant isolation, or email callback flow.

### Phase 1: backend foundation

- Create backend workspace/package, versioned config, migrations, CI, and local
  Docker development environment.
- Implement Auth token validation, provisioning, tenant membership, application
  sessions, RLS, security audit, rate limits, and health/readiness endpoints.
- Add session listing/revocation and integration tests.

Exit: two-user tenant-isolation suite and real signup/login/verification/recovery
flow pass without the Electron UI.

### Phase 2: sync kernel and account-scoped cache

- Implement mutation/change/conflict schema and push/pull/bootstrap endpoints.
- Add Main auth/session manager, account-scoped database manager, outbox/inbox,
  cursor, connectivity state, retry, and corruption bootstrap.
- Start with workspaces and simple preferences behind a feature flag.

Exit: concurrent-device, offline, duplicate-delivery, stale-cursor, and clean
cache tests pass.

### Phase 3: canonical domains

- Move conversations, academic life, projects/files, materials metadata,
  planning inputs, sessions, attempts, and evidence in dependency order.
- Move aggregate derivation to the server.
- Keep local projections readable and rebuildable.
- Implement material object upload and download.

Exit: representative account fully rehydrates on a second machine with domain
counts, hashes, and invariants matching.

### Phase 4: provider vault and cloud execution

- Implement provider metadata sync and explicit device/cloud policy.
- Implement envelope-encrypted cloud vault and provider deletion state machine.
- Move cloud-vault provider calls and private evaluation to API/worker paths.
- Preserve device-only local endpoint support.

Exit: secret redaction, rotation, deletion crash recovery, and audit tests pass.

### Phase 5: legacy import and account-first UX

- Implement typed resumable import and fresh bootstrap.
- Build signup/login/verification/recovery/session/offline/sync/conflict UX only
  on the real contracts.
- Roll out to internal accounts, then opt-in users, with kill switches for push
  and background processing.

Exit: migration and clean-install journeys pass against production-equivalent
  infrastructure.

### Phase 6: authority cutover

- Make cloud authority mandatory for account mode.
- Maintain a machine-readable inventory of every repository, raw SQL write, IPC
  handler, migration/repair path, and worker, classified as cloud command, local
  projection, device-only state, or removal.
- Remove remaining local-authority write paths and global singleton assumptions.
- Any temporary dual write has one declared authority, ordered failure behavior,
  reconciliation metrics, and a state machine; remove it after observation.
- Keep cache reset/bootstrap, not SQLite restore, as recovery.

Exit: independent COA-313 review finds no P0/P1 issue and all acceptance gates
below have evidence.

## Kill switches and rollback

Rollout controls may disable new signup, legacy import, sync push, material
upload, cloud provider execution, or background jobs independently. Disabling
push leaves outbox entries durable and visible; it does not mark them synced.

Database migrations are forward-compatible and expand/contract. Rollback means
deploying code that still understands expanded schema or disabling a feature;
it does not delete new canonical data, rewind PostgreSQL, replace SQLite, or
reinterpret cloud rows as local authority.

## Exact acceptance contract

### Identity and sessions

1. A new user signs up, receives verification, verifies through a one-time
   flow, and receives exactly one personal tenant under retry.
2. Unknown and known password-reset addresses produce indistinguishable public
   responses.
3. A reset token is single-use, expires, and successful recovery revokes prior
   sessions according to policy.
4. Access expiry triggers one serialized refresh under concurrent API calls.
5. Refresh-token reuse is detected and revokes the affected session/family.
6. Listing sessions never exposes tokens or another user's devices.
7. Revoking one device blocks its next Coach API request immediately and blocks
   future refresh; other devices remain active.
8. Global logout blocks every existing session.
9. SQLite deletion does not delete the Auth identity, tenant, or sessions.
10. No password, access token, refresh token, verification token, reset token,
    or authorization code appears in SQLite, renderer state, logs, or telemetry.
11. Refresh rotation survives crashes before response receipt, during atomic
    vault replacement, after replacement, and before prior-token retirement.
12. Offline restart requires the declared authentication policy; remote
    revocation is never represented as erasing disconnected cached bytes.

### Tenancy and authorization

13. User A cannot read, mutate, upload to, infer existence of, or sync User B's
    entity by guessing every public ID shape.
14. Every tenant-owned parent/child insert rejects a cross-tenant relation.
15. Missing request tenant context causes default-deny RLS behavior.
16. Runtime database credentials cannot bypass RLS or run migrations.
17. Membership removal invalidates access even with a previously issued access
    token.
18. Reused pooled connections never retain another request's tenant context.

### Sync and offline

19. Local projection and outbox insertion are atomic for every offline command.
20. Replaying an accepted mutation returns the original result and creates no
    duplicate domain row or change.
21. Reusing a mutation ID with a different canonical request hash is rejected.
22. Crash before server commit retries safely; crash after commit but before
    client acknowledgement converges safely.
23. A lower allocated change committing after another mutation cannot fall
    behind an advanced cursor; pull exposes a contiguous commit watermark.
24. Pull page application and cursor advancement are atomic and idempotent.
25. Two devices append distinct messages/attempts and both survive in stable
    server order.
26. Conflicting project-file or note edits either merge from a retained common
    base without overlap or preserve both versions for explicit resolution.
27. Progress and ConceptMemory converge from immutable evidence without adding
    mutable counters from two devices.
28. A stale roadmap/progress command cannot overwrite a newer content revision.
29. A delete tombstone prevents stale child recreation.
30. A device offline inside the supported window catches up incrementally.
31. A cursor older than retention receives `sync_reset_required` and completes a
    bootstrap without dropping readable unsent outbox commands.
32. An outbox mutation beyond dedup retention is not blindly replayed.
33. 429, timeout, offline, and retryable 5xx use bounded jittered retry; auth,
    permission, validation, quota, and conflict errors remain distinct.
34. Sync protocol incompatibility fails before mutation and gives an actionable
    upgrade state.

### Clean install and cache loss

35. A clean install logs in and rehydrates all canonical workspaces,
    conversations, academic context, projects, plans, progress, evidence,
    ConceptMemory, preferences, provider metadata, and approved materials.
36. Deleting `coach.sqlite` then reopening performs bootstrap and preserves all
    previously synchronized cloud data.
37. A deliberately corrupted cache is quarantined and rebuilt without deleting
    or mutating cloud data.
38. Bootstrap interruption and concurrent mutations at every page boundary
    preserve a consistent snapshot plus incremental catch-up without
    exposing a partially current cache.
39. Bootstrap count/hash/reference failure refuses promotion and reports a safe
    retry state.

### Migration

40. Repeating create, batch upload, and finalize for one migration manifest is
    idempotent.
41. A partial import is not visible as canonical data before finalization.
42. ID collision remapping preserves all relationships and never changes tenant
    ownership based on imported IDs.
43. Legacy mutable projections are recomputed and match canonical source events.
44. Missing original material files are reported accurately; extracted text is
    not represented as the original file.
45. Existing provider secrets remain device-only unless the user explicitly
    chooses and completes cloud-vault transfer.
46. The old local profile is never used to replace the new live cache.
47. A completed source snapshot cannot be imported twice, and concurrent cloud
    changes during import produce a typed finalize conflict.

### Provider secrets and private data

48. Cloud-vault ciphertext cannot be decrypted with a database backup alone.
49. Secret create, use category, rotation, disable, and deletion produce
    redacted audit events.
50. Crash at every provider deletion state resumes idempotently and never leaves
    an active metadata row pointing to a destroyed secret.
51. Cache metadata loss never triggers provider-secret destruction.
52. Device-only providers clearly require reconfiguration on a new device.
53. Private tests, reference solutions, evaluator payloads, and cloud secrets
    never enter renderer IPC or general sync payloads.
54. OmniRoute model discovery accepts Gemini model names while no direct Gemini
    provider, OAuth callback, or token exists.
55. Cloud provider calls reject private/metadata destinations, DNS rebinding,
    unsafe redirects, and credential forwarding to an unregistered origin.

### Materials and operations

56. Unauthorized or cross-tenant presigned URL requests fail before URL issue.
57. Upload completion rejects wrong size, checksum, MIME, expired intent, or
    object ownership.
58. A staging URL cannot overwrite an immutable object after completion.
59. Parser timeout/crash leaves a retryable staged material and does not execute
    active document content.
60. Backup/PITR drills recover PostgreSQL, exact object versions, KMS access, and
    deletion suppression at one named recovery point.
61. Self-host acceptance repeats auth, session, tenancy, sync, storage, email,
    and backup tests; Docker startup alone is insufficient.

### Privacy and observability

62. Automated log scanning finds no credentials, tokens, signed URLs, content
    bodies, material excerpts, source code, private tests, or full email values.
63. Metrics expose login health, revocation latency, sync lag, conflicts,
    bootstrap time, outbox age, worker retries, and database saturation.
64. Account deletion revokes access and follows the documented purge and backup
    retention process with auditable completion; PITR cannot reactivate it.

## Required implementation cards

Create or refine cards after this RFC, avoiding duplicates:

1. Backend monorepo/package foundation, PostgreSQL migrations, local Docker, CI,
   configuration, and observability baseline.
2. Supabase Auth integration spike for desktop PKCE/email callbacks, refresh
   rotation/reuse, and individual/global revocation.
3. Tenant/profile/device/session schema, RLS, provisioning, security audit, and
   negative authorization suite.
4. Versioned sync kernel: mutations, changes, cursors, tombstones, conflicts,
   push/pull/bootstrap, retention, and protocol negotiation.
5. Electron Main account/session manager and protected token storage.
6. Account-scoped SQLite cache, transactional outbox/inbox, retry scheduler,
   bootstrap, and corruption recovery.
7. Domain migration slices in dependency order, including removal of duplicated
   planning/progress authority.
8. Material object-storage upload, processing, rehydration, and quota controls.
9. Legacy local-profile import with manifest, typed batches, validation, and
   cloud-bootstrap verification.
10. Provider metadata policy, cloud vault, cloud execution, and deletion state
    machine.
11. Account-first UX over real contracts, coordinated with COA-302 and COA-312.
12. Independent security/privacy/operability review and COA-313 end-to-end gate.

COA-310 and COA-311 can proceed after this contract is accepted because they
remove unsafe legacy mechanisms and fix current reliability issues. Login and
sync claims must wait for the backend and client contracts to exist.

## Open verification items, not open architecture decisions

The target architecture is decided. The following vendor/runtime facts require
spikes before production configuration is frozen:

- exact Supabase Auth version/plan behavior for listing and revoking one device
  session, refresh replay, grace intervals, and forced reauthentication;
- managed-to-self-host identity export compatibility; assume users must
  reauthenticate during such a migration unless proven otherwise;
- Windows/Linux/macOS protocol registration and email-client behavior for the
  one-time desktop callback;
- selected KMS, object storage checksum/multipart behavior, email deliverability,
  data residency, PITR, and retention terms;
- actual bootstrap and change-log volumes for conversations, generated content,
  evidence, and extracted materials;
- legal requirements for educational data, telemetry, account deletion, backup
  retention, and service-operator access.

These items may change vendors or configuration. They do not permit direct
database access from Electron, local identity authority, silent last-write-wins
for critical pedagogy, or a return of SQLite restore as account recovery.
