-- ============================================================
-- Telegram integration + message schedule
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. Add Telegram columns to patients ─────────────────────────────────────
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS telegram_id    BIGINT UNIQUE,
  ADD COLUMN IF NOT EXISTS telegram_token TEXT   UNIQUE;

CREATE INDEX IF NOT EXISTS idx_patients_telegram_token
  ON patients(telegram_token)
  WHERE telegram_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patients_telegram_id
  ON patients(telegram_id)
  WHERE telegram_id IS NOT NULL;

-- ── 2. Message schedule table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_schedule (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id     TEXT        NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  patient_id   TEXT        NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  block_key    TEXT        NOT NULL,
  -- block_key values:
  --   Group K: 'block7K', 'block8K', 'block9K', 'block10K', 'block11K'
  --   Group G: 'block12G_day_before', 'block12G_morning'
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_visit_block UNIQUE (visit_id, block_key)
);

CREATE INDEX IF NOT EXISTS idx_message_schedule_pending
  ON message_schedule(scheduled_at)
  WHERE sent_at IS NULL;

-- ── 3. RLS policies ──────────────────────────────────────────────────────────
ALTER TABLE message_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_message_schedule"
  ON message_schedule FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- anon cannot read or write this table
CREATE POLICY "anon_no_read_message_schedule"
  ON message_schedule FOR SELECT
  TO anon
  USING (false);

-- ── 4. Enable extensions (run after enabling pg_cron + pg_net in Dashboard) ─
-- Go to: Supabase Dashboard → Database → Extensions
-- Enable: pg_cron, pg_net

-- ── 5. Register cron job (run AFTER deploying Edge Functions) ────────────────
-- Replace <PROJECT_REF> and <SERVICE_ROLE_KEY> with real values.
--
-- SELECT cron.schedule(
--   'send-patient-messages',
--   '*/5 * * * *',
--   $$
--   SELECT net.http_post(
--     url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-scheduled-messages',
--     headers := jsonb_build_object(
--       'Content-Type',  'application/json',
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
--     ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );
