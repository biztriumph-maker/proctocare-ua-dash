-- Run this in Supabase Dashboard → SQL Editor
-- Adds protocol_history JSONB column to visits so reschedule history persists across page refreshes

ALTER TABLE visits ADD COLUMN IF NOT EXISTS protocol_history JSONB DEFAULT '[]'::JSONB;
