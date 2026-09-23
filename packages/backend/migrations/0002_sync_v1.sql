CREATE TYPE sync_mutation_state AS ENUM ('accepted', 'conflict', 'rejected');
CREATE TYPE sync_entity_class AS ENUM ('append_only', 'revisioned_text', 'scalar', 'generated');

DROP FUNCTION resolve_active_app_session(uuid, uuid);
CREATE FUNCTION resolve_active_app_session(p_user_id uuid, p_auth_session_id uuid)
RETURNS TABLE (app_session_id uuid, tenant_id uuid, resolved_user_id uuid, resolved_auth_session_id uuid, resolved_device_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF session_user <> 'coach_runtime' OR nullif(current_setting('coach.user_id', true), '')::uuid IS DISTINCT FROM p_user_id OR nullif(current_setting('coach.session_id', true), '')::uuid IS DISTINCT FROM p_auth_session_id THEN
    RAISE EXCEPTION 'unauthorized_session_resolution' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT s.id, s.tenant_id, s.user_id, s.auth_session_id, s.device_id FROM app_sessions s
  WHERE s.user_id = p_user_id AND s.auth_session_id = p_auth_session_id AND s.revoked_at IS NULL
    AND EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = s.tenant_id AND m.user_id = s.user_id AND m.status = 'active') LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION resolve_active_app_session(uuid, uuid) FROM PUBLIC;
ALTER FUNCTION resolve_active_app_session(uuid, uuid) OWNER TO coach_migrator;

CREATE TABLE sync_tenant_sequences (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  committed_sequence bigint NOT NULL DEFAULT 0 CHECK (committed_sequence >= 0),
  minimum_available_sequence bigint NOT NULL DEFAULT 1 CHECK (minimum_available_sequence >= 1),
  mutation_not_before timestamptz NOT NULL DEFAULT now()
);
INSERT INTO sync_tenant_sequences (tenant_id, mutation_not_before) SELECT id, created_at FROM tenants;

CREATE TABLE sync_entities (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  entity_class sync_entity_class NOT NULL,
  aggregate_id uuid,
  aggregate_generation bigint NOT NULL DEFAULT 1 CHECK (aggregate_generation >= 1),
  revision bigint NOT NULL CHECK (revision >= 1),
  payload_version integer NOT NULL CHECK (payload_version >= 1),
  payload jsonb,
  payload_hash text NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entity_type, entity_id)
);
CREATE INDEX sync_entities_tenant_order_idx ON sync_entities (tenant_id, entity_type, entity_id);
CREATE INDEX sync_entities_aggregate_idx ON sync_entities (tenant_id, aggregate_id) WHERE aggregate_id IS NOT NULL;

CREATE TABLE sync_aggregate_generations (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  aggregate_id uuid NOT NULL,
  generation bigint NOT NULL CHECK (generation >= 1),
  deleted_at timestamptz,
  PRIMARY KEY (tenant_id, aggregate_id)
);

CREATE TABLE sync_mutations (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  mutation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  device_id uuid NOT NULL,
  request_hash text NOT NULL,
  state sync_mutation_state NOT NULL,
  result jsonb NOT NULL,
  committed_sequence bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, mutation_id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES devices(tenant_id, id)
);
CREATE INDEX sync_mutations_retention_idx ON sync_mutations (tenant_id, completed_at);

CREATE TABLE sync_changes (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  sequence bigint NOT NULL CHECK (sequence >= 1),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  entity_class sync_entity_class NOT NULL,
  aggregate_id uuid,
  hierarchy text NOT NULL CHECK (hierarchy IN ('aggregate_root', 'aggregate_child', 'standalone')),
  operation text NOT NULL CHECK (operation IN ('upsert', 'delete')),
  revision bigint NOT NULL,
  aggregate_generation bigint NOT NULL,
  payload_version integer NOT NULL,
  payload jsonb,
  payload_hash text NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sequence)
);
CREATE INDEX sync_changes_retention_idx ON sync_changes (tenant_id, committed_at);

CREATE TABLE sync_cursors (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  device_id uuid NOT NULL,
  acknowledged_sequence bigint NOT NULL DEFAULT 0,
  greatest_delivered_sequence bigint NOT NULL DEFAULT 0,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, device_id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES devices(tenant_id, id)
);

CREATE TABLE sync_conflicts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  mutation_id uuid NOT NULL,
  code text NOT NULL,
  command text NOT NULL,
  base_revision bigint,
  proposed_payload_version integer NOT NULL,
  proposed_payload jsonb,
  proposed_payload_hash text NOT NULL,
  request_hash text NOT NULL,
  current_revision bigint,
  current_projection jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'discarded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, mutation_id)
);

CREATE TABLE sync_bootstraps (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  session_id uuid NOT NULL,
  device_id uuid NOT NULL,
  protocol_version integer NOT NULL,
  watermark bigint NOT NULL,
  item_count integer NOT NULL,
  manifest_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, device_id) REFERENCES devices(tenant_id, id)
);
CREATE TABLE sync_bootstrap_items (
  bootstrap_id uuid NOT NULL REFERENCES sync_bootstraps(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  entity_class sync_entity_class NOT NULL,
  aggregate_id uuid,
  hierarchy text NOT NULL CHECK (hierarchy IN ('aggregate_root', 'aggregate_child', 'standalone')),
  revision bigint NOT NULL,
  aggregate_generation bigint NOT NULL,
  payload_version integer NOT NULL,
  payload jsonb,
  payload_hash text NOT NULL,
  PRIMARY KEY (bootstrap_id, position)
);

ALTER TABLE sync_tenant_sequences ENABLE ROW LEVEL SECURITY; ALTER TABLE sync_tenant_sequences FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_entities ENABLE ROW LEVEL SECURITY; ALTER TABLE sync_entities FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_aggregate_generations ENABLE ROW LEVEL SECURITY; ALTER TABLE sync_aggregate_generations FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_mutations ENABLE ROW LEVEL SECURITY; ALTER TABLE sync_mutations FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_changes ENABLE ROW LEVEL SECURITY; ALTER TABLE sync_changes FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_cursors ENABLE ROW LEVEL SECURITY; ALTER TABLE sync_cursors FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_conflicts ENABLE ROW LEVEL SECURITY; ALTER TABLE sync_conflicts FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_bootstraps ENABLE ROW LEVEL SECURITY; ALTER TABLE sync_bootstraps FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_bootstrap_items ENABLE ROW LEVEL SECURITY; ALTER TABLE sync_bootstrap_items FORCE ROW LEVEL SECURITY;

CREATE POLICY sync_sequences_tenant ON sync_tenant_sequences USING (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid);
CREATE POLICY sync_entities_tenant ON sync_entities USING (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid);
CREATE POLICY sync_aggregate_generations_tenant ON sync_aggregate_generations USING (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid);
CREATE POLICY sync_mutations_tenant ON sync_mutations USING (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid AND user_id = nullif(current_setting('coach.user_id', true), '')::uuid);
CREATE POLICY sync_changes_tenant ON sync_changes USING (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid);
CREATE POLICY sync_cursors_tenant ON sync_cursors USING (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid);
CREATE POLICY sync_conflicts_tenant ON sync_conflicts USING (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid);
CREATE POLICY sync_bootstraps_tenant ON sync_bootstraps USING (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid AND session_id = nullif(current_setting('coach.session_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid AND session_id = nullif(current_setting('coach.session_id', true), '')::uuid);
CREATE POLICY sync_bootstrap_items_tenant ON sync_bootstrap_items USING (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'coach_runtime') THEN
    GRANT EXECUTE ON FUNCTION resolve_active_app_session(uuid, uuid) TO coach_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON sync_tenant_sequences, sync_entities, sync_aggregate_generations, sync_mutations, sync_cursors, sync_conflicts, sync_bootstraps TO coach_runtime;
    GRANT SELECT, INSERT, DELETE ON sync_changes, sync_bootstrap_items TO coach_runtime;
    GRANT DELETE ON sync_mutations, sync_bootstraps TO coach_runtime;
  END IF;
END $$;
