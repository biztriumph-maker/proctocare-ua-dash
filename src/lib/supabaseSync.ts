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
};

// Перетворює дані з Supabase у формат дашборду
export function mapToDashboardPatient(visit: VisitRow & { patients: PatientRow }) {
  const p = visit.patients;
  return {
    id: visit.id,
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

// Видалити візит пацієнта
export async function deletePatientVisitFromSupabase(visitId: string) {
  if (!USE_SUPABASE) {
    await fetchJson(getApiUrl(`/sync-api/patients/${encodeURIComponent(visitId)}`), {
      method: 'DELETE',
    });
    return;
  }

  const { error } = await supabase.from('visits').delete().eq('id', visitId);
  if (error) console.error('Помилка видалення візиту:', error);
}