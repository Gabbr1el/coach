import { createServer } from 'node:http';
import postgres from 'postgres';

const database = postgres(process.env.AUTH_DATABASE_URL, { max: 2, prepare: false });
const secret = process.env.REVOKE_ADAPTER_SECRET;
if (!secret || secret.length < 32) throw new Error('REVOKE_ADAPTER_SECRET must be at least 32 characters');

createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    await database`select 1`;
    response.writeHead(200).end('ok');
    return;
  }
  if (request.method !== 'POST' || request.url !== '/revoke') return response.writeHead(404).end();
  if (request.headers.authorization !== `Bearer ${secret}`) return response.writeHead(401).end();
  try {
    const body = await readJson(request);
    if (body.mode !== 'user-global' || !isUuid(body.user_id) || !isUuid(body.session_id)) return response.writeHead(400).end();
    await database.begin(async (transaction) => {
      const sessions = await transaction`select id from auth.sessions where user_id = ${body.user_id}::uuid for update`;
      if (!sessions.some(({ id }) => id === body.session_id)) throw new Error('session_not_owned_by_user');
      await transaction`update auth.sessions set not_after = least(coalesce(not_after, now()), now()) where user_id = ${body.user_id}::uuid`;
      await transaction`update auth.refresh_tokens set revoked = true, updated_at = now() where user_id = ${body.user_id}`;
    });
    response.writeHead(204).end();
  } catch (error) {
    console.error(error instanceof Error && error.message === 'session_not_owned_by_user' ? 'session_not_owned_by_user' : 'revoke_failed');
    response.writeHead(error instanceof SyntaxError ? 400 : 500).end();
  }
}).listen(9998, '0.0.0.0');

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new SyntaxError('body_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
