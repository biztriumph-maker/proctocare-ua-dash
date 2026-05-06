-- Add departure_message_sent flag to assistant_chats.
-- Set to true by send-scheduled-messages when block12G_morning is sent.
-- Used by the frontend to show the "Виїзд" tab as RED (waiting for patient departure)
-- until the patient presses "Виїжджаю" and the status becomes "ready" (GREEN).
ALTER TABLE assistant_chats ADD COLUMN IF NOT EXISTS departure_message_sent BOOLEAN NOT NULL DEFAULT FALSE;
