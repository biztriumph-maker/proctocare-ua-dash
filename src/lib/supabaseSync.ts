import { supabase } from './supabaseClient';

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
  const { data, error } = await supabase
    .from('visits')
    .select(`*, patients (*)`)
    .order('visit_time', { ascending: true });

  if (error) {
    console.error('Помилка завантаження:', error);
    return null;
  }

  return data.map((v: any) => mapToDashboardPatient(v));
}

// Зберегти нового пацієнта
export async function savePatientToSupabase(
  patient: PatientRow,
  visit: Omit<VisitRow, 'patient_id'>
) {
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