-- ── assistant_chats ──────────────────────────────────────────────────────────

-- Drop old anon policies (created before auth existed — anon must not read medical chat data)
DROP POLICY IF EXISTS "Allow public read access" ON assistant_chats;
DROP POLICY IF EXISTS "Allow public insert access" ON assistant_chats;

-- Enable RLS
ALTER TABLE assistant_chats ENABLE ROW LEVEL SECURITY;

-- Allow authenticated doctor full access (dashboard reads/writes/subscribes via Realtime)
CREATE POLICY "authenticated_all_assistant_chats"
ON assistant_chats
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- ── patient_history ───────────────────────────────────────────────────────────

-- Freeze unused table: enable RLS with no policies = nobody can access it
ALTER TABLE patient_history ENABLE ROW LEVEL SECURITY;
