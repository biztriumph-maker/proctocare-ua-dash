-- Fix storage.objects RLS for patient-files bucket.
-- DROP first to handle policies already created manually in the Dashboard.

DROP POLICY IF EXISTS "auth_insert_patient_files" ON storage.objects;
DROP POLICY IF EXISTS "auth_delete_patient_files" ON storage.objects;
DROP POLICY IF EXISTS "auth_update_patient_files" ON storage.objects;

-- INSERT для authenticated (лікар завантажує файли)
CREATE POLICY "auth_insert_patient_files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'patient-files');

-- DELETE для authenticated (лікар видаляє файли)
CREATE POLICY "auth_delete_patient_files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'patient-files');

-- UPDATE для authenticated
CREATE POLICY "auth_update_patient_files"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'patient-files');
