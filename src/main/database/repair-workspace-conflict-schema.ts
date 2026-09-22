import type Database from 'better-sqlite3'

export function preflightWorkspaceConflictCanonicalIdentity(sqlite: Database.Database, migrationTimestamp = 1790157600000): void {
  const migrationTable = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'").get()
  if (!migrationTable) return
  const applied = sqlite.prepare('SELECT 1 FROM __drizzle_migrations WHERE created_at>=? LIMIT 1').get(migrationTimestamp)
  if (applied) return
  const table = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_repair_conflicts'").get()
  if (!table) return
  const columns = new Set((sqlite.pragma('table_info(workspace_repair_conflicts)') as Array<{ name: string }>).map((column) => column.name))
  if (!columns.has('canonical_workspace_id')) return
  sqlite.exec(`
    DROP INDEX IF EXISTS workspace_repair_conflicts_canonical_idx;
    ALTER TABLE workspace_repair_conflicts RENAME TO workspace_repair_conflicts_interim;
    CREATE TABLE workspace_repair_conflicts (
      equivalence_key text PRIMARY KEY NOT NULL,
      workspace_ids_json text NOT NULL,
      evidence_workspace_ids_json text NOT NULL,
      reason text NOT NULL,
      detected_at integer NOT NULL,
      resolved_at integer,
      CONSTRAINT workspace_repair_conflicts_reason_check CHECK(reason IN ('multiple_meaningful_evidence'))
    );
    INSERT INTO workspace_repair_conflicts
      (equivalence_key,workspace_ids_json,evidence_workspace_ids_json,reason,detected_at,resolved_at)
    SELECT equivalence_key,workspace_ids_json,evidence_workspace_ids_json,reason,detected_at,resolved_at
    FROM workspace_repair_conflicts_interim;
    DROP TABLE workspace_repair_conflicts_interim;
    CREATE INDEX workspace_repair_conflicts_resolution_idx ON workspace_repair_conflicts(resolved_at,detected_at);
  `)
}

export function repairWorkspaceConflictCanonicalIdentity(sqlite: Database.Database): void {
  const table = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_repair_conflicts'").get()
  if (!table) return
  const columns = new Set((sqlite.pragma('table_info(workspace_repair_conflicts)') as Array<{ name: string }>).map((column) => column.name))
  if (!columns.has('canonical_workspace_id')) sqlite.exec('ALTER TABLE workspace_repair_conflicts ADD COLUMN canonical_workspace_id text REFERENCES workspaces(id) ON DELETE RESTRICT')
  sqlite.exec(`
    UPDATE workspace_repair_conflicts
    SET canonical_workspace_id = (
      SELECT w.id FROM workspaces w
      WHERE w.equivalence_key=workspace_repair_conflicts.equivalence_key
      ORDER BY CASE WHEN w.status='active' AND w.confirmed_at IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN w.status='completed' THEN 0 ELSE 1 END,
        COALESCE(w.last_opened_at,-1) DESC,w.created_at,w.id LIMIT 1
    )
    WHERE canonical_workspace_id IS NULL;
    CREATE INDEX IF NOT EXISTS workspace_repair_conflicts_canonical_idx ON workspace_repair_conflicts(canonical_workspace_id);
  `)
}
