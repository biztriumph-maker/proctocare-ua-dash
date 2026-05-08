-- Make patient-files bucket private (disables public URL access)
UPDATE storage.buckets
SET public = false
WHERE id = 'patient-files';

-- Allow signed URL generation via the anon key (createSignedUrl API requires SELECT RLS policy)
CREATE POLICY "patient_files_signed_url_access"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'patient-files');
