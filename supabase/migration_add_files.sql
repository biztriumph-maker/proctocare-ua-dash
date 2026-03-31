-- Run this SQL once in Supabase Dashboard → SQL Editor
-- (projektref: xwzbpmssbbpofbvwuqms)

-- 1. Add files column to visits table
ALTER TABLE visits ADD COLUMN IF NOT EXISTS files JSONB DEFAULT '[]'::JSONB;

-- 2. Create patient-files storage bucket (if not already exists)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('patient-files', 'patient-files', true, 52428800)
ON CONFLICT (id) DO NOTHING;

-- 3. Allow anon (unauthenticated) to upload, read and delete files
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'anon_insert_patient-files' AND tablename = 'objects' AND schemaname = 'storage') THEN
    CREATE POLICY "anon_insert_patient-files" ON storage.objects FOR INSERT TO anon
    WITH CHECK (bucket_id = 'patient-files');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_select_patient-files' AND tablename = 'objects' AND schemaname = 'storage') THEN
    CREATE POLICY "public_select_patient-files" ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'patient-files');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'anon_delete_patient-files' AND tablename = 'objects' AND schemaname = 'storage') THEN
    CREATE POLICY "anon_delete_patient-files" ON storage.objects FOR DELETE TO anon
    USING (bucket_id = 'patient-files');
  END IF;
END $$;
