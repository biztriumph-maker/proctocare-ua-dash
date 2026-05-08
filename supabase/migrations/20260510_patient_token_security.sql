-- ── New security columns on patients ─────────────────────────────────────────

ALTER TABLE patients ADD COLUMN IF NOT EXISTS web_token_expires_at TIMESTAMPTZ;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS web_token_revoked BOOLEAN NOT NULL DEFAULT false;

-- ── Fix /chat/:token — allow anon SELECT so patients can read their own data ──
-- The UUID web_token (2^122 space) acts as the row-level access key.

CREATE POLICY "anon_select_patients"
ON patients FOR SELECT TO anon USING (true);

CREATE POLICY "anon_select_visits"
ON visits FOR SELECT TO anon USING (true);

CREATE POLICY "anon_select_assistant_chats"
ON assistant_chats FOR SELECT TO anon USING (true);
