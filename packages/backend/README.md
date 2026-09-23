# Coach backend

The Fastify API is the only public boundary for cloud application data. Electron
must never receive `DATABASE_URL`, `AUTH_ADMIN_KEY`, migration credentials, or a
service-role key. Auth signup, verification, login, recovery, and rotating
refresh tokens are consumed by Electron Main through the exported auth adapter;
only access tokens are sent to this API.

## Local setup

```sh
docker compose up -d postgres auth mailpit
cp packages/backend/.env.example packages/backend/.env
set -a; . packages/backend/.env; set +a
pnpm backend:migrate
pnpm backend:dev
```

The checked-in GoTrue profile is development-only and explicitly selects legacy
HS256. Production rejects that mode and requires RS256/ES256 JWKS, exact issuer
and audience, an HTTPS exact-session revoke endpoint, a verified immutable
session claim, trusted proxy hops, and a reconciliation webhook secret.

Verification consumes GoTrue `token_hash`. Recovery is a browser/deep-link
PKCE flow: the backend stores `state` plus `code_verifier`, the callback returns
the one-time authorization code, and only Electron Main exchanges it. The
in-memory store wired by the standalone server is suitable for one local
process; production must replace it with a shared TTL store before horizontal
scaling.

`AUTH_MODE=test` is deterministic and in-memory, is rejected in production, and
exists only for tests. It is not a password implementation for deployment.

`SYNC_CURSOR_SECRET` signs tenant/device-bound pull cursors and bootstrap page
tokens. It must be a stable server secret of at least 32 characters and must not
be exposed to Electron. Sync v1 rejects incompatible protocol versions before
opening a mutation transaction.

Sync commands are admitted only through the server command registry. The client
supplies intent, entity ID, base revision, payload version, and payload; entity
class, hierarchy, aggregate ownership, conflict policy, operation, and
authorization are fixed by the registry. Canonical request hashing orders JSON
object keys by their raw UTF-8 bytes and deliberately does not normalize Unicode,
so canonically equivalent but byte-distinct keys remain distinct.

Registry entries are keyed by entity type, command, and payload version. Old
decoders remain available for new delayed requests, while idempotent replay is
resolved from the durable mutation receipt before consulting the registry. Sync
change GC never deletes mutation receipts or entity/aggregate tombstones. A
request whose client creation time predates the tenant mutation floor receives
`reconciliation_required` instead of being replayed blindly.

`SYNC_MAX_OFFLINE_MUTATION_AGE_DAYS` controls that floor and cannot be below 120
days. Retention advances it monotonically to `now - configured age` in the same
transaction as change GC. Concurrent first submissions of one mutation ID are
serialized by a transaction-scoped advisory lock, so contenders replay or get
the idempotency mismatch rather than observing a unique-key failure.

GoTrue v2.183.0 has no admin API for revoking one session by `session_id`. The
verified local profile therefore sets `AUTH_SESSION_REVOKE_MODE=user-global`
and uses the authenticated `auth-revoke-adapter` sidecar. The adapter checks
that the requested session belongs to the user, then revokes that user's GoTrue
sessions and refresh tokens directly in the shared Auth database. Revoking one
Coach session immediately denies that local session and asynchronously signs
out every GoTrue session for the user. This broader local behavior is
intentional and development-only; production startup requires `exact-session`
and an HTTPS adapter verified against the deployed provider.

Coach revocation is fail-closed: the app session is revoked and a durable
provider outbox row is inserted in one transaction. Provider failure cannot
restore API access. The worker retries after restart with exponential backoff
and records retry/success audit outcomes.

## Database roles

- `coach_migrator` owns schema and migrations and is never used by the API.
- `coach_runtime` is `NOBYPASSRLS`, owns no table, and receives only required DML.
- Request repositories use `withTenantTransaction`; it sets transaction-local
  user, tenant, and session values. Missing context defaults to deny.

Run the integration suite against a migrated test database with the runtime URL:

```sh
TEST_DATABASE_URL=postgres://coach_runtime:coach_runtime_local@localhost:5432/coach_test \
MIGRATION_DATABASE_URL=postgres://coach_migrator:coach_migrator_local@localhost:5432/coach_test \
pnpm backend:test
```

For a reproducible local database, use `docker compose --profile tools run --rm migrate`.
