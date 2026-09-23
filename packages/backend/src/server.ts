import { SupabaseAuthBoundary } from './auth/supabase-auth.js';
import { createAccessTokenVerifier } from './auth/verifier.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './database/client.js';
import { RevocationOutboxWorker } from './services/revocation-outbox.js';

class MemoryFlowStateStore {
  private readonly values = new Map<string, { codeVerifier: string; expiresAt: number }>();
  async put(state: string, value: { codeVerifier: string; expiresAt: number }) { this.values.set(state, value); }
  async take(state: string) { const value = this.values.get(state); this.values.delete(state); return value; }
}

const config = loadConfig();
if (config.AUTH_MODE === 'test') throw new Error('local test auth is embedded by tests only');
const database = createDatabase(config.DATABASE_URL);
const auth = new SupabaseAuthBoundary(
  config.AUTH_PUBLIC_URL,
  config.AUTH_PUBLIC_KEY,
  config.AUTH_ADMIN_KEY,
  config.AUTH_SESSION_REVOKE_URL,
  config.AUTH_SESSION_REVOKE_KEY,
  config.AUTH_SESSION_REVOKE_MODE,
  new MemoryFlowStateStore(),
  'coach://auth/recovery'
);
const app = buildApp({ config, database, auth, verifyAccessToken: createAccessTokenVerifier(config) });
const revocations = new RevocationOutboxWorker(database, auth);
await revocations.drain();
const revocationTimer = setInterval(() => void revocations.drain().catch((error) => app.log.error({ err: error }, 'revocation outbox worker failed')), config.REVOCATION_WORKER_INTERVAL_MS);
revocationTimer.unref();

const shutdown = async () => { clearInterval(revocationTimer); await app.close(); await database.end(); };
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
await app.listen({ host: config.HOST, port: config.PORT });
