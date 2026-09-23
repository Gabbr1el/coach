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
