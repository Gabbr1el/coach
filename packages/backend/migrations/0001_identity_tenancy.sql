CREATE TYPE tenant_kind AS ENUM ('personal', 'organization');
CREATE TYPE membership_role AS ENUM ('owner', 'member');
CREATE TYPE membership_status AS ENUM ('active', 'removed');

CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  kind tenant_kind NOT NULL,
  name text NOT NULL,
  personal_owner_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenants_kind_owner_check CHECK (
    (kind = 'personal' AND personal_owner_user_id IS NOT NULL) OR
    (kind = 'organization' AND personal_owner_user_id IS NULL)
  )
);
CREATE UNIQUE INDEX tenants_personal_owner_uidx ON tenants (personal_owner_user_id) WHERE personal_owner_user_id IS NOT NULL;

CREATE TABLE profiles (
  user_id uuid PRIMARY KEY,
  display_name text,
  locale text NOT NULL DEFAULT 'pt-BR',
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,
  role membership_role NOT NULL,
  status membership_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX memberships_user_idx ON tenant_memberships (user_id);

CREATE TABLE devices (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,
  label text NOT NULL,
  platform text NOT NULL,
  app_version text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships(tenant_id, user_id)
);
CREATE INDEX devices_tenant_user_idx ON devices (tenant_id, user_id);

CREATE TABLE app_sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  device_id uuid NOT NULL,
  auth_session_id uuid NOT NULL,
  last_seen_version text NOT NULL,
  network_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, auth_session_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES devices(tenant_id, id)
);
CREATE INDEX app_sessions_tenant_user_idx ON app_sessions (tenant_id, user_id);

CREATE TABLE provider_revocation_outbox (
  id uuid PRIMARY KEY,
  app_session_id uuid NOT NULL REFERENCES app_sessions(id),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  auth_session_id uuid NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_session_id)
);
CREATE INDEX provider_revocation_pending_idx ON provider_revocation_outbox (next_attempt_at, created_at) WHERE status <> 'completed';

CREATE TABLE security_audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id),
  user_id uuid,
  session_id uuid,
  type text NOT NULL,
  outcome text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant_created_idx ON security_audit_events (tenant_id, created_at);

CREATE TABLE security_reconciliation_events (
  event_id text PRIMARY KEY,
  user_id uuid NOT NULL,
  auth_session_id uuid,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION reconcile_auth_security_event(
  p_event_id text,
  p_user_id uuid,
  p_auth_session_id uuid,
  p_reason text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO security_reconciliation_events (event_id, user_id, auth_session_id, reason)
  VALUES (p_event_id, p_user_id, p_auth_session_id, p_reason)
  ON CONFLICT (event_id) DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE app_sessions
  SET revoked_at = coalesce(revoked_at, now()), revocation_reason = coalesce(revocation_reason, p_reason)
  WHERE user_id = p_user_id AND (p_auth_session_id IS NULL OR auth_session_id = p_auth_session_id);

  INSERT INTO security_audit_events (id, user_id, type, outcome, metadata)
  VALUES (gen_random_uuid(), p_user_id, 'auth.reconciled', 'success',
    jsonb_build_object('eventId', p_event_id, 'reason', p_reason, 'scope', CASE WHEN p_auth_session_id IS NULL THEN 'user' ELSE 'session' END));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION reconcile_auth_security_event(text, uuid, uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION record_security_audit_event(p_id uuid, p_tenant_id uuid, p_user_id uuid, p_session_id uuid, p_type text, p_outcome text, p_metadata jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('coach.user_id', p_user_id::text, true);
  PERFORM set_config('coach.tenant_id', p_tenant_id::text, true);
  PERFORM set_config('coach.session_id', p_session_id::text, true);
  INSERT INTO security_audit_events (id, tenant_id, user_id, session_id, type, outcome, metadata) VALUES (p_id, p_tenant_id, p_user_id, p_session_id, p_type, p_outcome, p_metadata);
END;
$$;
REVOKE ALL ON FUNCTION record_security_audit_event(uuid, uuid, uuid, uuid, text, text, jsonb) FROM PUBLIC;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices FORCE ROW LEVEL SECURITY;
ALTER TABLE app_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE security_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY profiles_self ON profiles USING (user_id = nullif(current_setting('coach.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('coach.user_id', true), '')::uuid);
CREATE POLICY tenants_migrator_seed ON tenants FOR INSERT TO coach_migrator WITH CHECK (current_user = 'coach_migrator');
CREATE POLICY memberships_migrator_seed ON tenant_memberships FOR INSERT TO coach_migrator WITH CHECK (current_user = 'coach_migrator');
CREATE POLICY devices_migrator_seed ON devices FOR INSERT TO coach_migrator WITH CHECK (current_user = 'coach_migrator');
CREATE POLICY sessions_migrator_seed ON app_sessions FOR INSERT TO coach_migrator WITH CHECK (current_user = 'coach_migrator');
CREATE POLICY memberships_read_self ON tenant_memberships FOR SELECT USING (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid AND user_id = nullif(current_setting('coach.user_id', true), '')::uuid);
CREATE POLICY memberships_resolve_definer ON tenant_memberships FOR SELECT TO coach_migrator USING (current_user = 'coach_migrator' AND user_id = nullif(current_setting('coach.user_id', true), '')::uuid);
CREATE POLICY memberships_insert_personal_owner ON tenant_memberships FOR INSERT WITH CHECK (
  tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid AND user_id = nullif(current_setting('coach.user_id', true), '')::uuid AND role = 'owner' AND status = 'active'
);
CREATE POLICY tenants_member ON tenants USING (
  id = nullif(current_setting('coach.tenant_id', true), '')::uuid
) WITH CHECK (id = nullif(current_setting('coach.tenant_id', true), '')::uuid AND personal_owner_user_id = nullif(current_setting('coach.user_id', true), '')::uuid);
CREATE POLICY devices_member ON devices USING (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid AND user_id = nullif(current_setting('coach.user_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid AND user_id = nullif(current_setting('coach.user_id', true), '')::uuid);
CREATE POLICY sessions_self ON app_sessions USING (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid AND user_id = nullif(current_setting('coach.user_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid AND user_id = nullif(current_setting('coach.user_id', true), '')::uuid);
CREATE POLICY sessions_resolve_definer ON app_sessions FOR SELECT TO coach_migrator USING (current_user = 'coach_migrator' AND user_id = nullif(current_setting('coach.user_id', true), '')::uuid);
CREATE POLICY sessions_global_revoke_definer ON app_sessions FOR UPDATE TO coach_migrator USING (
  current_user = 'coach_migrator' AND user_id = nullif(current_setting('coach.user_id', true), '')::uuid
) WITH CHECK (
  current_user = 'coach_migrator' AND user_id = nullif(current_setting('coach.user_id', true), '')::uuid
);
CREATE POLICY audit_self ON security_audit_events USING (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid AND user_id = nullif(current_setting('coach.user_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('coach.tenant_id', true), '')::uuid AND user_id = nullif(current_setting('coach.user_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION revoke_all_app_sessions(p_user_id uuid, p_actor_session_id uuid, p_reason text)
RETURNS TABLE (revoked_app_session_id uuid, revoked_tenant_id uuid, revoked_auth_session_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_context_user_id uuid := nullif(current_setting('coach.user_id', true), '')::uuid;
  v_context_session_id uuid := nullif(current_setting('coach.session_id', true), '')::uuid;
BEGIN
  IF session_user <> 'coach_runtime' OR v_context_user_id IS DISTINCT FROM p_user_id OR v_context_session_id IS DISTINCT FROM p_actor_session_id THEN
    RAISE EXCEPTION 'unauthorized_global_revocation' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app_sessions
    WHERE id = p_actor_session_id AND user_id = p_user_id AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'inactive_global_revocation_actor' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH revoked AS (
    UPDATE app_sessions AS target
    SET revoked_at = coalesce(revoked_at, now()), revocation_reason = coalesce(revocation_reason, p_reason)
    WHERE target.user_id = p_user_id AND target.revoked_at IS NULL
    RETURNING target.id, target.tenant_id, target.auth_session_id
  ), enqueued AS (
    INSERT INTO provider_revocation_outbox (id, app_session_id, tenant_id, user_id, auth_session_id, reason)
    SELECT gen_random_uuid(), revoked.id, revoked.tenant_id, p_user_id, revoked.auth_session_id, p_reason
    FROM revoked
    ON CONFLICT (app_session_id) DO NOTHING
  )
  SELECT revoked.id, revoked.tenant_id, revoked.auth_session_id FROM revoked;
END;
$$;
REVOKE ALL ON FUNCTION revoke_all_app_sessions(uuid, uuid, text) FROM PUBLIC;
ALTER FUNCTION revoke_all_app_sessions(uuid, uuid, text) OWNER TO coach_migrator;

CREATE OR REPLACE FUNCTION resolve_active_app_session(p_user_id uuid, p_auth_session_id uuid)
RETURNS TABLE (app_session_id uuid, tenant_id uuid, resolved_user_id uuid, resolved_auth_session_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF session_user <> 'coach_runtime' OR nullif(current_setting('coach.user_id', true), '')::uuid IS DISTINCT FROM p_user_id OR nullif(current_setting('coach.session_id', true), '')::uuid IS DISTINCT FROM p_auth_session_id THEN
    RAISE EXCEPTION 'unauthorized_session_resolution' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.id, s.tenant_id, s.user_id, s.auth_session_id
  FROM app_sessions s
  WHERE s.user_id = p_user_id AND s.auth_session_id = p_auth_session_id AND s.revoked_at IS NULL
    AND EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = s.tenant_id AND m.user_id = s.user_id AND m.status = 'active')
  LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION resolve_active_app_session(uuid, uuid) FROM PUBLIC;
ALTER FUNCTION resolve_active_app_session(uuid, uuid) OWNER TO coach_migrator;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'coach_runtime') THEN
    GRANT USAGE ON SCHEMA public TO coach_runtime;
    GRANT SELECT, INSERT ON tenants, tenant_memberships TO coach_runtime;
    GRANT SELECT, INSERT, UPDATE ON profiles, devices, app_sessions TO coach_runtime;
    GRANT DELETE ON devices, app_sessions TO coach_runtime;
    GRANT SELECT, INSERT ON security_audit_events TO coach_runtime;
    GRANT SELECT, INSERT ON security_reconciliation_events TO coach_runtime;
    GRANT EXECUTE ON FUNCTION reconcile_auth_security_event(text, uuid, uuid, text) TO coach_runtime;
    GRANT EXECUTE ON FUNCTION record_security_audit_event(uuid, uuid, uuid, uuid, text, text, jsonb) TO coach_runtime;
    GRANT EXECUTE ON FUNCTION revoke_all_app_sessions(uuid, uuid, text) TO coach_runtime;
    GRANT EXECUTE ON FUNCTION resolve_active_app_session(uuid, uuid) TO coach_runtime;
    GRANT SELECT, INSERT, UPDATE ON provider_revocation_outbox TO coach_runtime;
  END IF;
END $$;
