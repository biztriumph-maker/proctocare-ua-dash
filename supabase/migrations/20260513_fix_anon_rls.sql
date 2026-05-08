-- Remove overly permissive anon policies (USING true = full table access via anon key)
DROP POLICY IF EXISTS "anon_select_patients"       ON patients;
DROP POLICY IF EXISTS "anon_select_visits"          ON visits;
DROP POLICY IF EXISTS "anon_select_assistant_chats" ON assistant_chats;

-- patients: anon may only read rows that have an active web_token
-- (needed for ChatPage step 1: resolve patient by token)
CREATE POLICY "anon_select_patients_by_token"
  ON patients FOR SELECT
  TO anon
  USING (web_token IS NOT NULL);

-- visits: anon may only read visits whose patient has an active, non-revoked, non-expired token
-- (needed for ChatPage step 2: find the visit for this patient)
CREATE POLICY "anon_select_visits_by_token"
  ON visits FOR SELECT
  TO anon
  USING (
    patient_id IN (
      SELECT id FROM patients
      WHERE web_token IS NOT NULL
        AND (web_token_revoked = false OR web_token_revoked IS NULL)
        AND (web_token_expires_at > NOW() OR web_token_expires_at IS NULL)
    )
  );

-- assistant_chats: anon may only read rows whose patient has an active token.
-- NOTE: assistant_chats has no "visit_id" column — "id" IS the visit id, and
-- "patient_id" links to patients. We filter via patient_id (simpler, no join).
CREATE POLICY "anon_select_chats_by_token"
  ON assistant_chats FOR SELECT
  TO anon
  USING (
    patient_id IN (
      SELECT id FROM patients
      WHERE web_token IS NOT NULL
        AND (web_token_revoked = false OR web_token_revoked IS NULL)
        AND (web_token_expires_at > NOW() OR web_token_expires_at IS NULL)
    )
  );
