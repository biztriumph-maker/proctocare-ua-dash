-- Add prep_ready_ack and day_plan_ack to track patient confirmations
-- for progress bar steps 3 ("Підготовка до очищення") and 4 ("День очищення")
ALTER TABLE assistant_chats
  ADD COLUMN IF NOT EXISTS prep_ready_ack BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS day_plan_ack   BOOLEAN NOT NULL DEFAULT FALSE;
