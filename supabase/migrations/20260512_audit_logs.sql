CREATE TABLE IF NOT EXISTS audit_logs (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id    UUID        REFERENCES auth.users(id),
  action     TEXT        NOT NULL,
  patient_id UUID,
  resource   TEXT,
  metadata   JSONB
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_insert_audit"
  ON audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated_read_audit"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
