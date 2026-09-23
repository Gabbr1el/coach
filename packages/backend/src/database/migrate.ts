import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { loadConfig } from '../config.js';

const config = loadConfig();
const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (!migrationUrl) throw new Error('MIGRATION_DATABASE_URL is required');
const sql = postgres(migrationUrl, { max: 1 });
const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

try {
  await sql`create table if not exists coach_migrations (name text primary key, applied_at timestamptz not null default now())`;
  for (const name of (await readdir(migrationsDirectory)).filter((entry) => entry.endsWith('.sql')).sort()) {
    const [applied] = await sql<{ name: string }[]>`select name from coach_migrations where name = ${name}`;
    if (applied) continue;
    const body = await readFile(join(migrationsDirectory, name), 'utf8');
    await sql.begin(async (transaction) => {
      await transaction.unsafe(body);
      await transaction`insert into coach_migrations (name) values (${name})`;
    });
  }
} finally {
  await sql.end();
}
