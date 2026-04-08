import { supabase } from './supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';

const DATA_MODE = ((import.meta.env.VITE_DATA_MODE as string | undefined) || 'supabase').toLowerCase();
const USE_SUPABASE = DATA_MODE === 'supabase';

export const isSupabaseDataMode = USE_SUPABASE;

function getApiUrl(path: string): string {
  const base = (import.meta.env.VITE_SYNC_API_BASE as string | undefined)?.replace(/\/$/, '') || '';
  return `${base}${path}`;
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export type PatientRow = {
  id: string;
  name: string;
  patronymic?: string;
  phone?: string;
  birth_date?: string;
  allergies?: string;
  diagnosis?: string;
  is_test?: boolean;
};

export type VisitRow = {
  id: string;
  patient_id: string;
  visit_date: string;
  visit_time?: string;
  procedure?: string;
  status?: string;
  ai_summary?: string;
  notes?: string;
  primary_notes?: string;
  protocol?: string;
  from_form?: boolean;
  no_show?: boolean;
  completed?: boolean;
  is_test?: boolean;
  files?: Array<{ id: string; name: string; type: "doctor" | "patient"; date: string; url?: string; storageKey?: string; mimeType?: string }>;
  protocol_history?: Array<{ value: string; timestamp: string; date: string }>;
};

// Перетворює дані з Supabase у формат дашборду
export function mapToDashboardPatient(visit: VisitRow & { patients: PatientRow }) {
  const p = visit.patients;
  return {
    id: visit.id,
    patientDbId: p.id,
    name: p.name,
    patronymic: p.patronymic,
    phone: p.phone,
    birthDate: p.birth_date,
    allergies: p.allergies,
    diagnosis: p.diagnosis,
    time: visit.visit_time || '',
    date: visit.visit_date,
    procedure: visit.procedure || '',
    status: (visit.status || 'planning') as 'planning' | 'ready' | 'progress' | 'risk',
    aiSummary: visit.ai_summary || '',
    notes: visit.notes,
    primaryNotes: visit.primary_notes,
    protocol: visit.protocol,
    fromForm: visit.from_form,
    noShow: visit.no_show,
    completed: visit.completed,
    files: visit.files || [],
    protocolHistory: visit.protocol_history ?? undefined,
  };
}

// Завантажити всіх пацієнтів з візитами
export async function loadPatientsFromSupabase() {
  if (!USE_SUPABASE) {
    const data = await fetchJson<{ items?: Array<Record<string, unknown>> }>(getApiUrl('/sync-api/patients'));
    return (data.items || []) as any[];
  }

  const { data, error } = await supabase
    .from('visits')
    .select(`*, patients (*)`)
    .order('visit_date', { ascending: true })
    .order('visit_time', { ascending: true });

  if (error) {
    console.error('Помилка завантаження:', error);
    return null;
  }

  return data.map((v: any) => mapToDashboardPatient(v));
}

export async function replacePatientsSnapshot(patients: Array<Record<string, unknown>>) {
  if (USE_SUPABASE) {
    return;
  }

  await fetchJson(getApiUrl('/sync-api/patients'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: patients }),
  });
}

export function subscribeToPatientsRealtime(onChange: () => void): () => void {
  if (!USE_SUPABASE) {
    return () => {};
  }

  let notifyTimer: ReturnType<typeof setTimeout> | null = null;

  const notify = () => {
    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      onChange();
    }, 150);
  };

  const channel: RealtimeChannel = supabase
    .channel('proctocare-patients-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'visits' },
      () => notify()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'patients' },
      () => notify()
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.error('❌ Supabase realtime channel error');
      }
    });

  return () => {
    if (notifyTimer) clearTimeout(notifyTimer);
    void supabase.removeChannel(channel);
  };
}

// Зберегти нового пацієнта
export async function savePatientToSupabase(
  patient: PatientRow,
  visit: Omit<VisitRow, 'patient_id'>
) {
  if (!USE_SUPABASE) {
    const payload = {
      id: visit.id,
      name: patient.name,
      patronymic: patient.patronymic,
      phone: patient.phone,
      birthDate: patient.birth_date,
      allergies: patient.allergies,
      diagnosis: patient.diagnosis,
      time: visit.visit_time || '',
      date: visit.visit_date,
      procedure: visit.procedure || '',
      status: (visit.status || 'planning') as 'planning' | 'ready' | 'progress' | 'risk',
      aiSummary: visit.ai_summary || '',
      notes: visit.notes,
      primaryNotes: visit.primary_notes,
      protocol: visit.protocol,
      fromForm: visit.from_form,
      noShow: visit.no_show,
      completed: visit.completed,
    };

    await fetchJson(getApiUrl('/sync-api/patients/upsert'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patient: payload }),
    });
    return true;
  }

  const { error: patientError } = await supabase
    .from('patients')
    .upsert({ ...patient }, { onConflict: 'id' });

  if (patientError) {
    console.error('Помилка збереження пацієнта:', patientError);
    return false;
  }

  const { error: visitError } = await supabase
    .from('visits')
    .upsert({ ...visit, patient_id: patient.id }, { onConflict: 'id' });

  if (visitError) {
    console.error('Помилка збереження візиту:', visitError);
    return false;
  }

  return true;
}

// Оновити статус візиту
export async function updateVisitStatus(
  visitId: string,
  status: string,
  aiSummary?: string
) {
  if (!USE_SUPABASE) {
    await fetchJson(getApiUrl(`/sync-api/patients/${encodeURIComponent(visitId)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: { status, aiSummary } }),
    });
    return true;
  }

  const { error } = await supabase
    .from('visits')
    .update({ status, ai_summary: aiSummary })
    .eq('id', visitId);

  if (error) {
    console.error('Помилка оновлення статусу:', error);
    return false;
  }
  return true;
}

// Видалити всі тестові дані
export async function clearTestData() {
  if (!USE_SUPABASE) {
    await fetchJson(getApiUrl('/sync-api/patients'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [] }),
    });
    return true;
  }

  const { error } = await supabase
    .from('patients')
    .delete()
    .eq('is_test', true);

  if (error) {
    console.error('Помилка видалення тестових даних:', error);
    return false;
  }
  return true;
}

// Оновити дані пацієнта та/або візиту (тихий no-op якщо запис не в Supabase)
export async function updatePatientInSupabase(visitId: string, updates: Record<string, unknown>) {
  if (!USE_SUPABASE) {
    await fetchJson(getApiUrl(`/sync-api/patients/${encodeURIComponent(visitId)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    });
    return;
  }

  console.log("💾 Saving updates to Supabase for visitId:", visitId, updates);
  
  const visitUpdate: Record<string, unknown> = {};
  if ('procedure' in updates) visitUpdate.procedure = updates.procedure;
  if ('status' in updates) visitUpdate.status = updates.status;
  if ('aiSummary' in updates) visitUpdate.ai_summary = updates.aiSummary;
  if ('notes' in updates) visitUpdate.notes = updates.notes;
  if ('primaryNotes' in updates) visitUpdate.primary_notes = updates.primaryNotes;
  if ('protocol' in updates) visitUpdate.protocol = updates.protocol;
  if ('noShow' in updates) visitUpdate.no_show = updates.noShow;
  if ('completed' in updates) visitUpdate.completed = updates.completed;
  if ('date' in updates) visitUpdate.visit_date = updates.date;
  if ('time' in updates) visitUpdate.visit_time = updates.time;
  if ('files' in updates) visitUpdate.files = updates.files;
  if ('protocolHistory' in updates) visitUpdate.protocol_history = updates.protocolHistory;

  if (Object.keys(visitUpdate).length > 0) {
    console.log("📝 Updating visit:", visitUpdate);
    const { error } = await supabase.from('visits').update(visitUpdate).eq('id', visitId);
    if (error) {
      console.error('❌ Помилка оновлення візиту:', error);
    } else {
      console.log("✅ Visit updated successfully");
    }
  }

  const patientUpdate: Record<string, unknown> = {};
  if ('phone' in updates) patientUpdate.phone = updates.phone;
  if ('birthDate' in updates) patientUpdate.birth_date = updates.birthDate;
  if ('allergies' in updates) patientUpdate.allergies = updates.allergies;
  if ('diagnosis' in updates) patientUpdate.diagnosis = updates.diagnosis;
  if ('name' in updates) patientUpdate.name = updates.name;
  if ('patronymic' in updates) patientUpdate.patronymic = updates.patronymic;

  if (Object.keys(patientUpdate).length > 0) {
    console.log("👤 Updating patient profile:", patientUpdate);
    const { data } = await supabase.from('visits').select('patient_id').eq('id', visitId).single();
    if (data?.patient_id) {
      const { error } = await supabase.from('patients').update(patientUpdate).eq('id', data.patient_id);
      if (error) {
        console.error('❌ Помилка оновлення профілю пацієнта:', error);
      } else {
        console.log("✅ Patient profile updated successfully");
      }
    } else {
      console.warn("⚠️  Could not find patient_id for visit:", visitId);
    }
  }
}

// Create a brand-new visit row that references the same patient profile as an existing visit.
// Used when rescheduling a completed visit: the old record stays as archive, a new one is created.
export async function createNewVisitForExistingPatient(
  oldVisitId: string,
  newVisit: Omit<VisitRow, 'patient_id'>,
  patientUpdates?: Partial<PatientRow>
): Promise<boolean> {
  if (!USE_SUPABASE) {
    // Non-Supabase (dev sync server): use upsert with a minimal payload
    await fetchJson(getApiUrl('/sync-api/patients/upsert'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient: {
          id: newVisit.id,
          name: '__DERIVED__',
          ...(patientUpdates || {}),
        },
        visit: newVisit,
      }),
    });
    return true;
  }

  const { data: oldVisit, error: lookupErr } = await supabase
    .from('visits')
    .select('patient_id')
    .eq('id', oldVisitId)
    .single();

  if (lookupErr || !oldVisit?.patient_id) {
    console.error('❌ createNewVisitForExistingPatient: cannot find patient_id for', oldVisitId, lookupErr);
    return false;
  }

  const { error } = await supabase
    .from('visits')
    .insert({ ...newVisit, patient_id: oldVisit.patient_id });

  if (error) {
    console.error('❌ createNewVisitForExistingPatient: insert failed', error);
    return false;
  }

  // If patientUpdates provided (e.g. allergies), repair the patient profile record
  if (patientUpdates && Object.keys(patientUpdates).length > 0) {
    const { error: patErr } = await supabase
      .from('patients')
      .update(patientUpdates)
      .eq('id', oldVisit.patient_id);
    if (patErr) {
      console.warn('⚠️ createNewVisitForExistingPatient: patient profile update failed', patErr);
    } else {
      console.log('✅ Patient profile repaired for patient_id', oldVisit.patient_id);
    }
  }

  console.log('✅ New visit created for patient_id', oldVisit.patient_id, 'visit_id', newVisit.id);
  return true;
}

const PATIENT_FILES_BUCKET = 'patient-files';

// Sterile deep-delete: Storage files + all visits + patient record
export async function deletePatientVisitFromSupabase(visitId: string) {
  if (!USE_SUPABASE) {
    await fetchJson(getApiUrl(`/sync-api/patients/${encodeURIComponent(visitId)}`), {
      method: 'DELETE',
    });
    return;
  }

  // 1. Resolve patient_id from visit (visit.id === app patient.id)
  const { data: visitData } = await supabase
    .from('visits')
    .select('patient_id')
    .eq('id', visitId)
    .single();
  const patientId: string = visitData?.patient_id ?? visitId;

  // 2. Fetch ALL visits for this patient to collect every storage path
  const { data: allVisits } = await supabase
    .from('visits')
    .select('id, files')
    .eq('patient_id', patientId);

  const visitIds: string[] = allVisits?.map((v: { id: string }) => v.id) ?? [visitId];

  // 3. Collect storage paths from JSONB files in all visits
  const storagePathsFromJsonb: string[] = [];
  for (const v of (allVisits ?? [])) {
    const files = (v as { files?: Array<{ url?: string; storageKey?: string }> }).files ?? [];
    for (const f of files) {
      // From storageKey (direct path)
      if (f.storageKey) {
        storagePathsFromJsonb.push(f.storageKey);
        continue;
      }
      // From public URL: extract path after /patient-files/
      if (f.url) {
        const marker = `/object/public/${PATIENT_FILES_BUCKET}/`;
        const idx = f.url.indexOf(marker);
        if (idx >= 0) {
          storagePathsFromJsonb.push(decodeURIComponent(f.url.slice(idx + marker.length)));
        }
      }
    }
  }

  // 4. Also list Storage folders for each visit ID (catches any files not reflected in JSONB)
  const storagePathsFromListing: string[] = [];
  for (const vid of visitIds) {
    const { data: listed } = await supabase.storage
      .from(PATIENT_FILES_BUCKET)
      .list(vid, { limit: 200 });
    if (listed && listed.length > 0) {
      for (const f of listed) storagePathsFromListing.push(`${vid}/${f.name}`);
    }
  }

  // 5. Merge and deduplicate all paths, then delete from Storage
  const allPaths = Array.from(new Set([...storagePathsFromJsonb, ...storagePathsFromListing]));
  if (allPaths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from(PATIENT_FILES_BUCKET)
      .remove(allPaths);
    if (storageError) console.warn('⚠️ Storage delete failed:', storageError.message);
    else console.log(`🗑️ Storage: deleted ${allPaths.length} file(s)`);
  }

  // 6. Delete all visits for this patient
  const { error: visitsError } = await supabase
    .from('visits')
    .delete()
    .eq('patient_id', patientId);
  if (visitsError) console.error('Помилка видалення візитів:', visitsError);

  // 7. Delete patient record
  const { error: patientError } = await supabase
    .from('patients')
    .delete()
    .eq('id', patientId);
  if (patientError) console.error('Помилка видалення пацієнта:', patientError);
  else console.log(`🗑️ Patient ${patientId} fully deleted from DB`);
}

function inferContentType(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'doc') return 'application/msword';
  return 'application/octet-stream';
}

// Завантажити файл в Supabase Storage, повертає публічний URL або null
export async function uploadFileToSupabaseStorage(visitId: string, file: File): Promise<string | null> {
  if (!USE_SUPABASE) {
    console.warn('[Storage] USE_SUPABASE=false, skipping upload');
    return null;
  }

  // --- PRE-UPLOAD VALIDATION ---
  const contentType = file.type || inferContentType(file.name);
  console.log('[Storage] → uploadFileToSupabaseStorage', {
    visitId,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    contentType,
    bucket: PATIENT_FILES_BUCKET,
  });

  if (!file.size || file.size === 0) {
    console.error('[Storage] ✗ file.size is 0 — aborting upload for:', file.name);
    return null;
  }

  try {
    // Path must be ASCII-only: Cyrillic/special chars in filenames cause broken public URLs.
    // We store only timestamp + random token + extension. Original name stays in FileItem.name.
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const safePathName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const path = `${visitId}/${safePathName}`;
    console.log('[Storage] upload path:', path, '| original name:', file.name);

    const { data, error } = await supabase.storage
      .from(PATIENT_FILES_BUCKET)
      .upload(path, file, { upsert: false, contentType });

    if (error) {
      console.error('[Storage] ✗ upload failed — full error object:', error);
      console.error('[Storage] ✗ error.message:', error.message);
      console.error('[Storage] ✗ statusCode:', (error as any).statusCode ?? (error as any).status ?? 'n/a');
      return null;
    }

    console.log('[Storage] ✓ upload OK, path:', data.path);
    const { data: urlData } = supabase.storage
      .from(PATIENT_FILES_BUCKET)
      .getPublicUrl(data.path);
    return urlData.publicUrl;
  } catch (err) {
    console.error('[Storage] ✗ upload threw exception:', err);
    return null;
  }
}

// Знайти публічний URL файлу в Storage для legacy-записів, де URL не був збережений
export async function resolveVisitFilePublicUrl(visitId: string, fileName: string): Promise<string | null> {
  if (!USE_SUPABASE) return null;
  try {
    const safeName = fileName.replace(/\s+/g, '_');
    const { data, error } = await supabase.storage
      .from(PATIENT_FILES_BUCKET)
      .list(visitId, { limit: 200, sortBy: { column: 'name', order: 'desc' } });

    if (error || !data?.length) return null;

    const hit = data.find((item) => item.name === safeName || item.name.endsWith(`-${safeName}`));
    if (!hit?.name) return null;

    const path = `${visitId}/${hit.name}`;
    const { data: urlData } = supabase.storage
      .from(PATIENT_FILES_BUCKET)
      .getPublicUrl(path);

    return urlData.publicUrl || null;
  } catch (err) {
    console.warn('⚠️ Storage resolve URL exception:', err);
    return null;
  }
}

// Знайти незакриті візити (status not completed/no_show/ready AND visit_date < today — not including today)
export async function getUnclosedVisits() {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('visits')
    .select('*, patients (*)')
    .not('status', 'in', '(completed,no_show,ready)')
    .lt('visit_date', today);
  if (error) console.error(error);
  return data ?? [];
}

// Видалити файл з Supabase Storage
export async function deleteFileFromSupabaseStorage(publicUrl: string): Promise<void> {
  if (!USE_SUPABASE) return;
  try {
    // Extract path from URL: .../storage/v1/object/public/patient-files/{path}
    const marker = `/object/public/${PATIENT_FILES_BUCKET}/`;
    const idx = publicUrl.indexOf(marker);
    if (idx < 0) return;
    const filePath = decodeURIComponent(publicUrl.slice(idx + marker.length));
    const { error } = await supabase.storage.from(PATIENT_FILES_BUCKET).remove([filePath]);
    if (error) console.warn('⚠️ Storage delete failed:', error.message);
  } catch (err) {
    console.warn('⚠️ Storage delete exception:', err);
  }
}