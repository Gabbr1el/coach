CREATE TABLE auth_refresh_reservations (
  request_id uuid PRIMARY KEY,
  refresh_identity_hash text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  app_session_id uuid NOT NULL REFERENCES app_sessions(id) ON DELETE CASCADE,
  capability_hash text NOT NULL,
  encrypted_capability text NOT NULL,
  recovery_secret_hash text NOT NULL,
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'processing', 'completed')),
  lease_owner uuid,
  lease_expires_at timestamptz,
  encrypted_result text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz
);
CREATE INDEX auth_refresh_reservations_expiry_idx ON auth_refresh_reservations(expires_at);
REVOKE ALL ON auth_refresh_reservations FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'coach_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth_refresh_reservations TO coach_runtime;
  END IF;
END $$;
