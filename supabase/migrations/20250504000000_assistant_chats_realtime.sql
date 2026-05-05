-- Enable full row identity for assistant_chats so that Supabase Realtime
-- delivers complete rows in UPDATE payloads (payload.new includes all columns).
-- Without this, UPDATE events carry only changed columns and client-side
-- filters on non-PK fields silently drop the event.
ALTER TABLE assistant_chats REPLICA IDENTITY FULL;

-- Note: assistant_chats was already a member of supabase_realtime publication
-- (confirmed 2025-05-04 — the ALTER publication line is not needed).
