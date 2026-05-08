-- RLS для patients
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_patients"
ON patients
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- RLS для visits
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_visits"
ON visits
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
