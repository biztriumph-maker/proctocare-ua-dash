ALTER TABLE patients ADD COLUMN IF NOT EXISTS web_token UUID NOT NULL DEFAULT gen_random_uuid();
