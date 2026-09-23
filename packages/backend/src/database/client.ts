import postgres, { type Sql } from 'postgres';

export type Database = Sql<Record<string, never>>;

export function createDatabase(databaseUrl: string, max = 10): Database {
  return postgres(databaseUrl, {
    max,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => undefined
  });
}
