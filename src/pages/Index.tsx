import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Plus, Phone, MessageCircle, AlertTriangle } from "lucide-react";
import { ViewToggle } from "@/components/ViewToggle";
import { StatusFilterBar, type FilterType } from "@/components/StatusFilterBar";
import { AIAlertSection } from "@/components/AIAlertSection";
import { PatientCard, type Patient, type PatientStatus } from "@/components/PatientCard";
import { PatientDetailView } from "@/components/PatientDetailView";
import { CalendarView } from "@/components/CalendarView";
import { NewEntryForm, type NewEntryData } from "@/components/NewEntryForm";
import { SearchBar } from "@/components/SearchBar";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { REMOTE_SYNC_EVENT } from "@/lib/sharedStateSync";
import { savePatientToSupabase, loadPatientsFromSupabase, updatePatientInSupabase, deletePatientVisitFromSupabase, createNewVisitForExistingPatient, subscribeToPatientsRealtime, replacePatientsSnapshot, isSupabaseDataMode } from "@/lib/supabaseSync";

const today = new Date();
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getCurrentScheduleDates() {
  const now = new Date();
  const todayIso = localDateStr(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = localDateStr(tomorrow);
  return { todayIso, tomorrowIso };
}

const todayDateStr = localDateStr(today);
const tomorrowDateStr = localDateStr(tomorrow);

// Nearest upcoming Sunday (for calendar mock patient)
const _sunday = new Date();
const _daysToSunday = (7 - _sunday.getDay()) % 7 || 7;
_sunday.setDate(_sunday.getDate() + _daysToSunday);
const sundayDateStr = localDateStr(_sunday);

const ASSISTANT_CHAT_LS_KEY = "proctocare_assistant_chat";
const TEMP_CHAT_LOGS_LS_KEY = "proctocare_temp_chat_logs";
const ASSISTANT_CHAT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type AssistantLogMessage = {
  sender: "ai" | "patient" | "doctor";
  text: string;
  time: string;
};

type AssistantStoredSession = {
  messages: AssistantLogMessage[];
  waitingForDietAck: boolean;
  dietInstructionSent: boolean;
  waitingForStep2Ack: boolean;
  step2AckResult: "none" | "confirmed" | "question";
  welcomeSent: boolean;
  savedAt?: number;
};

type DashboardAssistantAlert = {
  id: string;
  patientId: string;
  visitIso: string;
  patientName: string;
  patientPhone?: string;
  question: string;
  appointmentDate: Date;
  appointmentTime: string;
  chatPreview: AssistantLogMessage[];
  sos: boolean;
};

function getVisitIsoFromSessionKey(key: string): string {
  const parts = key.split("__");
  return parts[1] || "";
}

function normalizeAndPruneAssistantStore(store: Record<string, unknown>): { cleaned: Record<string, AssistantStoredSession>; changed: boolean } {
  const cleaned: Record<string, AssistantStoredSession> = {};
  const now = Date.now();
  let changed = false;

  for (const [key, value] of Object.entries(store)) {
    if (!value || typeof value !== "object") {
      changed = true;
      continue;
    }

    const session = value as Partial<AssistantStoredSession>;
    if (!Array.isArray(session.messages)) {
      changed = true;
      continue;
    }

    let savedAt = typeof session.savedAt === "number" ? session.savedAt : NaN;
    if (!Number.isFinite(savedAt)) {
      const visitIso = getVisitIsoFromSessionKey(key);
      const visitTs = new Date(`${visitIso}T00:00:00`).getTime();
      savedAt = Number.isFinite(visitTs) ? visitTs : now;
      changed = true;
    }

    if (now - savedAt > ASSISTANT_CHAT_TTL_MS) {
      changed = true;
      continue;
    }

    cleaned[key] = {
      messages: session.messages as AssistantLogMessage[],
      waitingForDietAck: !!session.waitingForDietAck,
      dietInstructionSent: !!session.dietInstructionSent,
      waitingForStep2Ack: !!session.waitingForStep2Ack,
      step2AckResult: session.step2AckResult === "confirmed" || session.step2AckResult === "question" ? session.step2AckResult : "none",
      welcomeSent: !!session.welcomeSent,
      savedAt,
    };
  }

  return { cleaned, changed };
}

function readAssistantStoreWithCleanup(): Record<string, AssistantStoredSession> {
  try {
    const raw = localStorage.getItem(ASSISTANT_CHAT_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const { cleaned, changed } = normalizeAndPruneAssistantStore(parsed);
    if (changed) localStorage.setItem(ASSISTANT_CHAT_LS_KEY, JSON.stringify(cleaned));
    return cleaned;
  } catch {
    return {};
  }
}

function cleanupTemporaryChatLogs(): void {
  try {
    const raw = localStorage.getItem(TEMP_CHAT_LOGS_LS_KEY);
    if (!raw) return;
    const now = Date.now();
    const parsed = JSON.parse(raw) as unknown;

    if (Array.isArray(parsed)) {
      const cleaned = parsed.filter((entry) => {
        if (!entry || typeof entry !== "object") return false;
        const rec = entry as { savedAt?: number; timestamp?: number; createdAt?: number };
        const ts = rec.savedAt || rec.timestamp || rec.createdAt || now;
        return now - ts <= ASSISTANT_CHAT_TTL_MS;
      });
      localStorage.setItem(TEMP_CHAT_LOGS_LS_KEY, JSON.stringify(cleaned));
      return;
    }

    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, { savedAt?: number; timestamp?: number; createdAt?: number }>;
      const cleanedObj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        const ts = v?.savedAt || v?.timestamp || v?.createdAt || now;
        if (now - ts <= ASSISTANT_CHAT_TTL_MS) cleanedObj[k] = v;
      }
      localStorage.setItem(TEMP_CHAT_LOGS_LS_KEY, JSON.stringify(cleanedObj));
    }
  } catch {
    // ignore malformed temporary logs
  }
}

function buildDashboardAssistantAlerts(patients: Patient[]): DashboardAssistantAlert[] {
  const sessions = readAssistantStoreWithCleanup();
  cleanupTemporaryChatLogs();
  const byId = new Map(patients.map((p) => [p.id, p]));

  const alerts: DashboardAssistantAlert[] = [];
  for (const [key, session] of Object.entries(sessions)) {
    if (session.step2AckResult !== "question") continue;

    const [patientId, visitIso] = key.split("__");
    if (!patientId || !visitIso) continue;

    const patient = byId.get(patientId);
    const lastPatientMessage = [...session.messages].reverse().find((m) => m.sender === "patient");
    const appointmentDate = new Date(`${visitIso}T00:00:00`);
    const isValidDate = !Number.isNaN(appointmentDate.getTime());

    alerts.push({
      id: key,
      patientId,
      visitIso,
      patientName: patient ? `${patient.name}${patient.patronymic ? ` ${patient.patronymic}` : ""}` : `Пацієнт ${patientId}`,
      patientPhone: patient?.phone,
      question: (lastPatientMessage?.text || "Пацієнт потребує консультації щодо дієти").trim(),
      appointmentDate: isValidDate ? appointmentDate : new Date(),
      appointmentTime: patient?.time || "--:--",
      chatPreview: session.messages.slice(-3),
      sos: true,
    });
  }

  return alerts.sort((a, b) => {
    const [hA, mA] = (a.appointmentTime || "00:00").split(":").map((x) => parseInt(x || "0", 10));
    const [hB, mB] = (b.appointmentTime || "00:00").split(":").map((x) => parseInt(x || "0", 10));
    const tA = a.appointmentDate.getTime() + ((hA * 60 + mA) * 60000);
    const tB = b.appointmentDate.getTime() + ((hB * 60 + mB) * 60000);
    return tA - tB;
  });
}

function getDoctorPhoneForQuickReply(): string {
  try {
    const raw = localStorage.getItem("proctocare_doctor_profile");
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { phone?: string; phoneNumber?: string; contactPhone?: string };
    const phone = (parsed.phone || parsed.phoneNumber || parsed.contactPhone || "").trim();
    return phone;
  } catch {
    return "";
  }
}

const MOCK_PATIENTS: Patient[] = [
  { id: "1", name: "Коваленко Олена", patronymic: "Василівна", time: "08:00", procedure: "Колоноскопія", status: "ready", aiSummary: "Підготовка завершена, результати аналізів в нормі" },
  { id: "2", name: "Мельник Ігор", patronymic: "Петрович", time: "09:00", procedure: "Ректоскопія", status: "progress", aiSummary: "Очищення розпочато, чекаємо підтвердження" },
  { id: "3", name: "Шевченко Тарас", patronymic: "Олексійович", time: "11:00", procedure: "Консультація", status: "risk", aiSummary: "Не відповідає 12+ годин, препарат не прийнятий" },
  { id: "4", name: "Бондаренко Вікторія", patronymic: "Іванівна", time: "14:00", procedure: "Колоноскопія", status: "ready", aiSummary: "Всі етапи підготовки пройдені успішно" },
  { id: "5", name: "Ткаченко Наталія", patronymic: "Миколаївна", time: "16:00", procedure: "Аноскопія", status: "progress", aiSummary: "Дієта дотримується, очікуємо прийом препарату" },
  { id: "6", name: "Лисенко Андрій", patronymic: "Сергійович", time: "17:00", procedure: "Колоноскопія", status: "risk", aiSummary: "Алергія не підтверджена, потрібна консультація" },
  { id: "mock-petushkov", name: "Петушков Сергій", patronymic: "Юрійович", time: "09:00", procedure: "Поліпектомія при колоноскопії 1 клас 1А", status: "planning", aiSummary: "Записаний на процедуру, очікує підготовки", date: sundayDateStr, fromForm: true },
];

const MOCK_TOMORROW: Patient[] = [];

const statusToFilter: Record<PatientStatus, FilterType> = {
  planning: "attention",
  ready: "ready",
  progress: "attention",
  risk: "risk",
};

function personKey(patient: Pick<Patient, "name" | "patronymic">): string {
  const compactName = patient.name.replace(/\s+/g, " ").trim().toLowerCase();
  const nameParts = compactName.split(" ").filter(Boolean);

  const surname = nameParts[0] || "";
  const firstName = nameParts[1] || "";
  const explicitPatronymic = (patient.patronymic || "").replace(/\s+/g, " ").trim().toLowerCase();
  const parsedPatronymic = nameParts.length > 2 ? nameParts.slice(2).join(" ") : "";
  const patronymic = explicitPatronymic || parsedPatronymic;

  return `${surname}|${firstName}|${patronymic}`;
}

function profileCompleteness(patient: Patient): number {
  let score = 0;
  if (patient.birthDate?.trim()) score += 2;
  if (patient.phone?.trim()) score += 2;
  if (patient.allergies?.trim()) score += 1;
  if (patient.diagnosis?.trim()) score += 1;
  if (patient.notes?.trim() || patient.primaryNotes?.trim()) score += 1;
  if (patient.protocol?.trim()) score += 1;
  if ((patient.files?.length || 0) > 0) score += 1;
  if ((patient.phoneHistory?.length || 0) > 0) score += 1;
  if ((patient.notesHistory?.length || 0) > 0) score += 1;
  if ((patient.diagnosisHistory?.length || 0) > 0) score += 1;
  if ((patient.allergiesHistory?.length || 0) > 0) score += 1;
  if ((patient.birthDateHistory?.length || 0) > 0) score += 1;
  if ((patient.protocolHistory?.length || 0) > 0) score += 1;
  return score;
}

function hydrateMissingProfile(target: Patient, source?: Patient): Patient {
  if (!source) return target;

  const out = { ...target };
  // Only copy true patient-PROFILE fields (stored in patients table in Supabase).
  // Visit-specific fields (notes, primaryNotes, protocol, files, protocolHistory)
  // MUST NOT be copied between different visit rows — they belong to individual appointments.
  const scalarFields: Array<keyof Patient> = [
    "birthDate",
    "phone",
    "allergies",
    "diagnosis",
    "lastVisit",
    // "notes" intentionally excluded — stored in visits.notes, per-visit
    // "primaryNotes" intentionally excluded — stored in visits.primary_notes, per-visit
    // "protocol" intentionally excluded — visit-specific
  ];

  for (const field of scalarFields) {
    const current = out[field];
    const fallback = source[field];
    if ((typeof current !== "string" || !current.trim()) && typeof fallback === "string" && fallback.trim()) {
      out[field] = fallback;
    }
  }

  const listFields: Array<keyof Patient> = [
    // "files" intentionally excluded — stored in visits.files, per-visit
    "allergiesHistory",
    "diagnosisHistory",
    "notesHistory",
    "phoneHistory",
    "birthDateHistory",
    // "protocolHistory" intentionally excluded — visit-specific
    "procedureHistory",
  ];

  for (const field of listFields) {
    const current = out[field] as unknown;
    const fallback = source[field] as unknown;
    const currentEmpty = !Array.isArray(current) || current.length === 0;
    if (currentEmpty && Array.isArray(fallback) && fallback.length > 0) {
      out[field] = fallback as never;
    }
  }

  return out;
}

function scheduleSortValue(patient: Patient): number {
  const datePart = patient.date || "0000-00-00";
  const timePart = patient.time || "00:00";
  return Number(`${datePart.replace(/-/g, "")}${timePart.replace(":", "")}`);
}

function parsedIdentity(patient: Pick<Patient, "name" | "patronymic">): { surname: string; firstName: string; patronymic: string } {
  const compactName = patient.name.replace(/\s+/g, " ").trim().toLowerCase();
  const nameParts = compactName.split(" ").filter(Boolean);

  const surname = nameParts[0] || "";
  const firstName = nameParts[1] || "";
  const explicitPatronymic = (patient.patronymic || "").replace(/\s+/g, " ").trim().toLowerCase();
  const parsedPatronymic = nameParts.length > 2 ? nameParts.slice(2).join(" ") : "";
  const patronymic = explicitPatronymic || parsedPatronymic;

  return { surname, firstName, patronymic };
}

function isSamePerson(a: Pick<Patient, "name" | "patronymic">, b: Pick<Patient, "name" | "patronymic">): boolean {
  if (personKey(a) === personKey(b)) return true;

  const pa = parsedIdentity(a);
  const pb = parsedIdentity(b);
  if (!pa.surname || !pb.surname || pa.surname !== pb.surname) return false;

  if (pa.firstName && pb.firstName && pa.firstName === pb.firstName) return true;
  if (pa.patronymic && pb.patronymic && pa.patronymic === pb.patronymic) return true;

  return false;
}

function arePatientsEquivalentForView(a: Patient, b: Patient): boolean {
  return JSON.stringify({
    id: a.id,
    name: a.name,
    patronymic: a.patronymic,
    time: a.time,
    date: a.date,
    procedure: a.procedure,
    status: a.status,
    birthDate: a.birthDate,
    phone: a.phone,
    allergies: a.allergies,
    diagnosis: a.diagnosis,
    lastVisit: a.lastVisit,
    notes: a.notes,
    primaryNotes: a.primaryNotes,
    protocol: a.protocol,
    files: a.files,
    allergiesHistory: a.allergiesHistory,
    diagnosisHistory: a.diagnosisHistory,
    notesHistory: a.notesHistory,
    phoneHistory: a.phoneHistory,
    birthDateHistory: a.birthDateHistory,
    protocolHistory: a.protocolHistory,
    procedureHistory: a.procedureHistory,
  }) === JSON.stringify({
    id: b.id,
    name: b.name,
    patronymic: b.patronymic,
    time: b.time,
    date: b.date,
    procedure: b.procedure,
    status: b.status,
    birthDate: b.birthDate,
    phone: b.phone,
    allergies: b.allergies,
    diagnosis: b.diagnosis,
    lastVisit: b.lastVisit,
    notes: b.notes,
    primaryNotes: b.primaryNotes,
    protocol: b.protocol,
    files: b.files,
    allergiesHistory: b.allergiesHistory,
    diagnosisHistory: b.diagnosisHistory,
    notesHistory: b.notesHistory,
    phoneHistory: b.phoneHistory,
    birthDateHistory: b.birthDateHistory,
    protocolHistory: b.protocolHistory,
    procedureHistory: b.procedureHistory,
  });
}

function normalizePersonName(patient: Patient): Patient {
  const compact = patient.name.replace(/\s+/g, " ").trim();
  const hasInitials = compact.includes(".");
  if (!hasInitials) return patient;

  const parts = compact.split(" ");
  const surname = parts[0] || compact;
  return {
    ...patient,
    name: surname,
    patronymic: patient.patronymic || undefined,
  };
}

function extractLatestRescheduleTarget(patient: Patient): string | undefined {
  const markers = (patient.protocolHistory || [])
    .filter((h) => typeof h.value === "string" && h.value.startsWith("__RESCHEDULED_TO__:"))
    .map((h) => ({
      target: h.value.replace("__RESCHEDULED_TO__:", "").trim(),
      date: h.date || "",
      timestamp: h.timestamp || "",
    }))
    .filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.target));

  if (markers.length === 0) return undefined;
  markers.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    return a.timestamp.localeCompare(b.timestamp);
  });
  return markers[markers.length - 1].target;
}

function rebuildPetushkovRecord(patients: Patient[]): Patient[] {
  const petushkov = patients.filter((p) => p.name.toLowerCase().includes("петушков"));
  if (petushkov.length <= 1) return patients;

  const others = patients.filter((p) => !p.name.toLowerCase().includes("петушков"));
  const latestRescheduleTargets = petushkov
    .map((p) => ({ patient: p, target: extractLatestRescheduleTarget(p) }))
    .filter((x): x is { patient: Patient; target: string } => !!x.target)
    .sort((a, b) => scheduleSortValue(a.patient) - scheduleSortValue(b.patient));

  const explicitTarget = latestRescheduleTargets.length > 0
    ? latestRescheduleTargets[latestRescheduleTargets.length - 1].target
    : undefined;

  const rescheduleTargets = new Set<string>();
  if (explicitTarget) rescheduleTargets.add(explicitTarget);

  const candidateScore = (p: Patient): number => {
    let score = 0;
    score += profileCompleteness(p) * 100;
    score += ((p.protocolHistory?.length || 0) + (p.procedureHistory?.length || 0) + (p.notesHistory?.length || 0)) * 10;
    if (!p.fromForm) score += 25;
    if (p.status !== "planning") score += 5;
    if (p.date && rescheduleTargets.has(p.date)) score += 1000;
    return score;
  };

  const canonical = petushkov
    .slice()
    .sort((a, b) => {
      const byScore = candidateScore(b) - candidateScore(a);
      if (byScore !== 0) return byScore;
      return scheduleSortValue(b) - scheduleSortValue(a);
    })[0];

  const strongestDonor = petushkov
    .filter((p) => p.id !== canonical.id)
    .slice()
    .sort((a, b) => profileCompleteness(b) - profileCompleteness(a))[0];

  const merged = hydrateMissingProfile({ ...canonical }, strongestDonor);

  if (explicitTarget && merged.date !== explicitTarget) {
    merged.date = explicitTarget;
  }

  if (explicitTarget) {
    const targetVisit = petushkov
      .filter((p) => p.date === explicitTarget)
      .sort((a, b) => profileCompleteness(b) - profileCompleteness(a))[0];
    if (targetVisit?.time) merged.time = targetVisit.time;
  }
  return [...others, merged];
}

function unifyProfilesAcrossVisits(patients: Patient[]): Patient[] {
  let changed = false;

  const out = patients.map((patient) => {
    const donor = patients
      .filter((p) => p.id !== patient.id && isSamePerson(p, patient))
      .sort((a, b) => profileCompleteness(b) - profileCompleteness(a))[0];

    const merged = hydrateMissingProfile(patient, donor);
    if (!arePatientsEquivalentForView(patient, merged)) changed = true;
    return merged;
  });

  return changed ? out : patients;
}

function removeLegacyMockPetushkovDuplicate(patients: Patient[]): Patient[] {
  const hasRealPetushkov = patients.some((p) => p.id !== "mock-petushkov" && p.name.toLowerCase().includes("петушков"));
  if (!hasRealPetushkov) return patients;

  const mock = patients.find((p) => p.id === "mock-petushkov");
  if (!mock) return patients;

  const hasSameReal = patients.some((p) => p.id !== "mock-petushkov" && isSamePerson(p, mock));
  if (!hasSameReal) return patients;

  return patients.filter((p) => p.id !== "mock-petushkov");
}

function normalizeDemoScheduleDates(patients: Patient[]): Patient[] {
  const { todayIso } = getCurrentScheduleDates();
  const demoTodayIds = new Set(["1", "2", "3", "4", "5", "6"]);

  return patients.map((patient) => {
    if (demoTodayIds.has(patient.id)) {
      if (patient.date === todayIso) return patient;
      return { ...patient, date: todayIso };
    }
    return patient;
  });
}

function isoToDisplayDate(iso?: string): string {
  const parts = (iso || "").split("-");
  if (parts.length !== 3) return "";
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

function pickFocusDateForSearch(patients: Patient[], query: string, todayIso: string): string | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;

  const matches = patients.filter((p) => p.name.toLowerCase().includes(q) && !!p.date);
  if (matches.length === 0) return undefined;

  // 1. Active today — patient is physically present right now
  const activeToday = matches.find((p) => p.date === todayIso && !p.noShow && !p.completed);
  if (activeToday?.date) return activeToday.date;

  // 2. Future active visit — takes priority over a stale completed-today record
  const futureActive = matches
    .filter((p) => (p.date || "") > todayIso && !p.noShow && !p.completed)
    .sort((a, b) => scheduleSortValue(a) - scheduleSortValue(b))[0];
  if (futureActive?.date) return futureActive.date;

  // 3. Any today record (completed / noshow — fallback for reference)
  const todayAny = matches.find((p) => p.date === todayIso);
  if (todayAny?.date) return todayAny.date;

  // 4. Latest visit overall
  const latest = matches.slice().sort((a, b) => scheduleSortValue(b) - scheduleSortValue(a))[0];
  return latest?.date;
}

function enrichPatientWithVisitHistory(target: Patient, allPatients: Patient[]): Patient {
  const samePersonVisits = allPatients
    .filter((p) => isSamePerson(p, target))
    .filter((p) => !!p.date)
    .slice()
    .sort((a, b) => scheduleSortValue(a) - scheduleSortValue(b));

  if (samePersonVisits.length <= 1) return target;

  const protocolHistory = samePersonVisits
    .filter((v) => !!v.protocol?.trim())
    .map((v) => ({
      value: (v.protocol || "").trim(),
      timestamp: isoToDisplayDate(v.date),
      date: v.date || "",
    }));

  const procedureHistory = samePersonVisits
    .filter((v) => !!v.procedure?.trim())
    .map((v) => ({
      value: (v.procedure || "").trim(),
      timestamp: isoToDisplayDate(v.date),
      date: v.date || "",
    }));

  const currentDate = target.date || "9999-99-99";
  const lastCompletedVisit = samePersonVisits
    .filter((v) => (v.date || "") < currentDate)
    .filter((v) => !v.noShow)
    .filter((v) => !!v.completed || v.status === "ready")
    .sort((a, b) => scheduleSortValue(b) - scheduleSortValue(a))[0];

  return {
    ...target,
    fromForm: samePersonVisits.length > 1 ? false : target.fromForm,
    lastVisit: lastCompletedVisit?.date ? isoToDisplayDate(lastCompletedVisit.date) : target.lastVisit,
    protocolHistory: protocolHistory.length > 0 ? protocolHistory : target.protocolHistory,
    procedureHistory: procedureHistory.length > 0 ? procedureHistory : target.procedureHistory,
  };
}

const ASSISTANT_NOTE_PATTERNS = [
  /пацієнт\s+потребує\s+консультац(і|и)ї\s+щодо\s+дієт(и|і)/i,
  /пацієнт\s+потребує\s+консультац(і|и)ї\s+по\s+дієт(і|е)/i,
];

function stripAssistantMarkersFromText(value: string | undefined): string | undefined {
  if (!value || !value.trim()) return value;
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => !ASSISTANT_NOTE_PATTERNS.some((rx) => rx.test(line.trim())));

  const compact = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return compact || "";
}

function sanitizePatientAssistantNotes(patient: Patient): Patient {
  let changed = false;
  const next: Patient = { ...patient };

  const cleanedNotes = stripAssistantMarkersFromText(patient.notes);
  if (cleanedNotes !== patient.notes) {
    next.notes = cleanedNotes;
    changed = true;
  }

  const cleanedPrimaryNotes = stripAssistantMarkersFromText(patient.primaryNotes);
  if (cleanedPrimaryNotes !== patient.primaryNotes) {
    next.primaryNotes = cleanedPrimaryNotes;
    changed = true;
  }

  if (Array.isArray(patient.notesHistory) && patient.notesHistory.length > 0) {
    const cleanedHistory = patient.notesHistory
      .map((entry) => ({ ...entry, value: stripAssistantMarkersFromText(entry.value) || "" }))
      .filter((entry) => entry.value.trim());

    const isSameLength = cleanedHistory.length === patient.notesHistory.length;
    const isSameValues = isSameLength && cleanedHistory.every((entry, idx) => entry.value === patient.notesHistory?.[idx]?.value);
    if (!isSameValues) {
      next.notesHistory = cleanedHistory;
      changed = true;
    }
  }

  return changed ? next : patient;
}

function sanitizePatientsAssistantNotes(patients: Patient[]): Patient[] {
  let changed = false;
  const next = patients.map((patient) => {
    const cleaned = sanitizePatientAssistantNotes(patient);
    if (cleaned !== patient) changed = true;
    return cleaned;
  });
  return changed ? next : patients;
}

function loadStoredPatients(currentTodayIso: string, currentTomorrowIso: string): Patient[] | null {
  const saved = localStorage.getItem("proctocare_all_patients");
  if (!saved) return null;

  try {
    const parsed = JSON.parse(saved);
    const cleaned = parsed.filter((p: Patient) => !["t1", "t2", "t3", "t4"].includes(p.id));
    const withoutKnownTests = cleaned.filter((p: Patient) => {
      const id = String(p.id || "");
      const fullName = `${p.name || ""} ${p.patronymic || ""}`.trim();
      const testId = /^(e2e-|status-e2e-|sync-fields-|observe-fields-|verify-refresh-|uibirth-|mod-|remaining-|svc-|pdf-|pdf-health-|file-)/i.test(id);
      const testName = /^(STAT\d+|E2E\d+)/i.test(fullName) || /test\s*test/i.test(fullName);
      return !testId && !testName;
    });
    return normalizeDemoScheduleDates(
      rebuildPetushkovRecord(
        removeLegacyMockPetushkovDuplicate(unifyProfilesAcrossVisits(sanitizePatientsAssistantNotes(withoutKnownTests)))
      )
    );
  } catch (e) {
    console.error("Failed to parse saved patients", e);
    return null;
  }
}

export default function Index() {
  const { todayIso, tomorrowIso } = useMemo(() => getCurrentScheduleDates(), []);
  const [view, setView] = useState<"operational" | "calendar">("operational");
  const [filter, setFilter] = useState<FilterType>("all");
  const [showForm, setShowForm] = useState(false);
  const [formPrefill, setFormPrefill] = useState<{ date?: string; time?: string }>({});
  const [showTomorrow, setShowTomorrow] = useState(false);
  const [trainingLog, setTrainingLog] = useState<string[]>([]);
  const trainingMode = false;

  const logTraining = useCallback((message: string) => {
    if (!trainingMode) return;
    const now = new Date();
    setTrainingLog((prev) => [
      `${now.toLocaleString()} · ${message}`,
      ...prev,
    ].slice(0, 30));
  }, [trainingMode]);

  const [patients, setPatients] = useState<Patient[]>(() => {
    const { todayIso: currentTodayIso, tomorrowIso: currentTomorrowIso } = getCurrentScheduleDates();
    const stored = loadStoredPatients(currentTodayIso, currentTomorrowIso);
    if (stored) return stored;
    return [
      ...MOCK_PATIENTS.map(p => ({ ...p, date: p.date || currentTodayIso })),
      ...MOCK_TOMORROW.map(p => ({ ...p, date: p.date || currentTomorrowIso })),
    ].map((p) => ({ ...p }));
  });
  const patientsRef = useRef<Patient[]>(patients);
  const selectedPatientRef = useRef<Patient | null>(null);

  useEffect(() => {
    patientsRef.current = patients;
  }, [patients]);

  useEffect(() => {
    setPatients((prev) => sanitizePatientsAssistantNotes(prev));
  }, []);

  useEffect(() => {
    setPatients((prev) => unifyProfilesAcrossVisits(prev));
  }, [patients]);

  useEffect(() => {
    setPatients((prev) => removeLegacyMockPetushkovDuplicate(prev));
  }, [patients]);

  useEffect(() => {
    setPatients((prev) => rebuildPetushkovRecord(prev));
  }, [patients]);

  // Cleanup old assistant sessions and temporary logs on mount
  useEffect(() => {
    readAssistantStoreWithCleanup();
    cleanupTemporaryChatLogs();
  }, []);

  const lastFetchRef = useRef<string | null>(null);
  const refreshPatientsFromSupabase = useCallback(async (reason: string) => {
    try {
      const data = await loadPatientsFromSupabase();
      if (!data) return;

      if (!isSupabaseDataMode && data.length === 0 && patientsRef.current.length > 0) {
        await replacePatientsSnapshot(patientsRef.current as unknown as Array<Record<string, unknown>>);
        const seededSerialized = JSON.stringify(patientsRef.current);
        lastFetchRef.current = seededSerialized;
        console.log('🔄 Test sync seeded from local state:', patientsRef.current.length, 'patients');
        return;
      }

      const normalized = data as Patient[];
      const nextSerialized = JSON.stringify(normalized);
      if (nextSerialized === lastFetchRef.current) return;

      console.log(`🔄 Supabase sync (${reason}):`, normalized.length, "patients");
      setPatients(normalized);
      lastFetchRef.current = nextSerialized;

      const activeSelected = selectedPatientRef.current;
      if (activeSelected) {
        const selectedKey = personKey(activeSelected);
        const byId = normalized.find((p) => p.id === activeSelected.id);
        const byVisitAndPerson = normalized.find((p) =>
          (personKey(p) === selectedKey || isSamePerson(p, activeSelected)) &&
          p.time === activeSelected.time &&
          (!!activeSelected.date ? p.date === activeSelected.date : true)
        );
        const byPerson = normalized
          .filter((p) => personKey(p) === selectedKey || isSamePerson(p, activeSelected))
          .sort((a, b) => profileCompleteness(b) - profileCompleteness(a))[0];

        const base = byId || byVisitAndPerson || byPerson;
        if (base) {
          // Guard: if the selected card is a freshly-created optimistic record not yet
          // persisted in DB (byId=null, byVisitAndPerson=null), the only match is byPerson
          // which may be a DIFFERENT record (e.g. the old completed v7 for same person).
          // Don't replace an optimistic card with a stale DB record — wait for the next
          // poll cycle when the new visit has actually been saved.
          if (!byId && !byVisitAndPerson && base.id !== activeSelected.id) {
            return;
          }
          const donor = normalized
            .filter((p) => p.id !== base.id && isSamePerson(p, base))
            .sort((a, b) => profileCompleteness(b) - profileCompleteness(a))[0];
          const hydrated = hydrateMissingProfile(base, donor);
          const enriched = enrichPatientWithVisitHistory(hydrated, normalized);

          setSelectedPatient((prev) => {
            if (!prev) return prev;
            // Only preserve locally saved notes/protocol for the SAME visit that hasn't
            // synced to Supabase yet. Never restore for a new planning visit (fromForm: true)
            // — those must always open sterile.
            const isNewPlanningVisit = enriched.fromForm && enriched.status === "planning";
            const safe = (!isNewPlanningVisit && prev.notes && enriched.notes == null)
              ? { ...enriched, notes: prev.notes }
              : enriched;
            // CRITICAL: preserve allergies from local state if DB returned empty/null/unknown.
            // Allergies belong to the PATIENT (not the visit) and must NEVER be overwritten
            // by a sync that returns an empty or "unknown" value — treat blank DB value as
            // "not yet written" and keep whatever the local UI already has.
            const isAllergyBlankInDb = !safe.allergies || safe.allergies.trim() === "";
            const withAllergies = (prev.allergies && isAllergyBlankInDb)
              ? { ...safe, allergies: prev.allergies }
              : safe;
            if (arePatientsEquivalentForView(prev, withAllergies)) return prev;
            return withAllergies;
          });
        }
      }
    } catch (error) {
      console.error(`❌ Supabase sync error (${reason}):`, error);
    }
  }, []);

  useEffect(() => {
    void refreshPatientsFromSupabase("initial");

    const unsubscribeRealtime = subscribeToPatientsRealtime(() => {
      void refreshPatientsFromSupabase("realtime");
    });

    const pollInterval = window.setInterval(() => {
      void refreshPatientsFromSupabase("poll");
    }, 5000);

    const onFocus = () => {
      // Force fresh fetch — bypass dedup cache so any changes on another device are picked up
      lastFetchRef.current = null;
      void refreshPatientsFromSupabase("focus");
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Reset cache so mobile/bg-throttled tab always gets fresh data on return
        lastFetchRef.current = null;
        void refreshPatientsFromSupabase("visibility");
      }
    };

    const onOnline = () => {
      // Device came back online (mobile reconnect after sleep/network switch)
      lastFetchRef.current = null;
      void refreshPatientsFromSupabase("online");
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);

    return () => {
      unsubscribeRealtime();
      clearInterval(pollInterval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
    };
  }, [refreshPatientsFromSupabase]);

  // Пацієнти зберігаються в Supabase, не в localStorage

  const [assistantAlerts, setAssistantAlerts] = useState<DashboardAssistantAlert[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [newlyCreatedId, setNewlyCreatedId] = useState<string | null>(null);
  const [skeletonPatient, setSkeletonPatient] = useState<Patient | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const doctorPhoneForQuickReply = useMemo(() => getDoctorPhoneForQuickReply(), []);
  const pendingUnclosedReopenRef = useRef(false);
  const [unclosedModalReopenTrigger, setUnclosedModalReopenTrigger] = useState(0);

  useEffect(() => {
    selectedPatientRef.current = selectedPatient;
  }, [selectedPatient]);

  const refreshAssistantAlerts = useCallback(() => {
    setAssistantAlerts(buildDashboardAssistantAlerts(patients));
  }, [patients]);

  useEffect(() => {
    refreshAssistantAlerts();
  }, [refreshAssistantAlerts]);

  useEffect(() => {
    const onRemoteUpdated = () => {
      // Пацієнти живуть в Supabase — перезавантажуємо тільки алерти асистента
      refreshAssistantAlerts();
    };

    window.addEventListener(REMOTE_SYNC_EVENT, onRemoteUpdated);
    return () => window.removeEventListener(REMOTE_SYNC_EVENT, onRemoteUpdated);
  }, [refreshAssistantAlerts, todayIso, tomorrowIso]);

  useEffect(() => {
    const onAssistantStorageUpdated = () => refreshAssistantAlerts();
    window.addEventListener("proctocare-assistant-chat-updated", onAssistantStorageUpdated);
    return () => window.removeEventListener("proctocare-assistant-chat-updated", onAssistantStorageUpdated);
  }, [refreshAssistantAlerts]);

  useEffect(() => {
    if (!selectedPatient) return;

    const selectedKey = personKey(selectedPatient);
    const byId = patients.find((p) => p.id === selectedPatient.id);
    const byVisitAndPerson = patients.find((p) =>
      (personKey(p) === selectedKey || isSamePerson(p, selectedPatient)) &&
      p.time === selectedPatient.time &&
      (!!selectedPatient.date ? p.date === selectedPatient.date : true)
    );
    const byPerson = patients
      .filter((p) => personKey(p) === selectedKey || isSamePerson(p, selectedPatient))
      .sort((a, b) => profileCompleteness(b) - profileCompleteness(a))[0];

    const base = byId || byVisitAndPerson || byPerson;
    if (!base) return;

    const donor = patients
      .filter((p) => p.id !== base.id && isSamePerson(p, base))
      .sort((a, b) => profileCompleteness(b) - profileCompleteness(a))[0];

    const hydrated = hydrateMissingProfile(base, donor);
    const enriched = enrichPatientWithVisitHistory(hydrated, patients);
    // Only preserve locally saved notes for the SAME visit that hasn't synced yet.
    // Never restore for a new planning visit (fromForm: true) — must stay sterile.
    const isNewPlanningVisit = enriched.fromForm && enriched.status === "planning";
    const safe = (!isNewPlanningVisit && selectedPatient.notes && enriched.notes == null)
      ? { ...enriched, notes: selectedPatient.notes }
      : enriched;
    // CRITICAL: preserve allergies from local state if DB returned empty/null/unknown.
    const isAllergyBlankInDb = !safe.allergies || safe.allergies.trim() === "";
    const withAllergies = (selectedPatient.allergies && isAllergyBlankInDb)
      ? { ...safe, allergies: selectedPatient.allergies }
      : safe;
    if (!arePatientsEquivalentForView(selectedPatient, withAllergies)) {
      setSelectedPatient(withAllergies);
    }
  }, [patients, selectedPatient]);

  const todayPatients = useMemo(() => {
    const raw = patients.filter(p => !p.date || p.date === todayIso);
    // Hide no-date phantom records when the same person already has a real scheduled visit
    return raw.filter(p => {
      if (p.date === todayIso) return true; // explicit today date — always show
      // No-date record: hide if same person has another visit with a concrete date
      return !patients.some(other =>
        other.id !== p.id &&
        isSamePerson(other, p) &&
        !!other.date &&
        !other.completed &&
        !other.noShow
      );
    });
  }, [patients, todayIso]);
  const tomorrowPatients = useMemo(() => patients.filter(p => p.date === tomorrowIso), [patients, tomorrowIso]);

  const counts = useMemo(() => ({
    total: todayPatients.length,
    ready: todayPatients.filter((p) => p.status === "ready").length,
    risk: todayPatients.filter((p) => p.status === "risk").length,
    attention: todayPatients.filter((p) => p.status === "progress" || p.status === "planning").length,
  }), [todayPatients]);

  const filtered = useMemo(() => {
    let list = todayPatients;
    if (filter !== "all") {
      list = list.filter((p) => statusToFilter[p.status] === filter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [filter, todayPatients, searchQuery]);

  const filteredTomorrow = useMemo(() => {
    let list = tomorrowPatients;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [tomorrowPatients, searchQuery]);

  const openNewEntry = useCallback((date?: string, hour?: number) => {
    setFormPrefill({
      date: date || undefined,
      time: hour !== undefined ? `${String(hour).padStart(2, "0")}:00` : undefined,
    });
    setSelectedPatient(null);
    setShowForm(true);
  }, []);

  const handleSaveEntry = useCallback((entry: NewEntryData) => {
    // Clear search so the saved record is not confused with search results
    setSearchQuery("");
    const newId = `new-${Date.now()}`;
    const newPatient: Patient = {
      id: newId,
      patientDbId: entry.existingPatientDbId || undefined,
      name: entry.name,
      patronymic: entry.patronymic,
      time: entry.time,
      procedure: entry.procedures?.length > 0 ? entry.procedures.join(", ") : entry.procedure,
      status: "planning",
      aiSummary: entry.aiPrep ? "Асистент надсилає інструкції..." : "Очікує підготовки",
      birthDate: entry.birthDate,
      phone: entry.phone,
      primaryNotes: entry.notes,
      date: entry.date,
      fromForm: true,
      // Чистий лист: diagnosis та notes/protocol порожні для нового візиту
      diagnosis: undefined,
      notes: undefined,
      protocol: undefined,
    };
      void savePatientToSupabase(
  { id: newId, name: entry.name, patronymic: entry.patronymic, phone: entry.phone, birth_date: entry.birthDate },
  { id: newId, visit_date: entry.date || todayIso, visit_time: entry.time, procedure: newPatient.procedure, status: "planning", ai_summary: newPatient.aiSummary, from_form: true, primary_notes: entry.notes || undefined },
  entry.existingPatientDbId || undefined
);
    setSkeletonPatient(newPatient);
    setShowForm(false);
    setNewlyCreatedId(newId);
    setTimeout(() => {
      setSkeletonPatient(null);
      setPatients((prev) => [...prev, newPatient]);
      setSelectedPatient(newPatient);
      toast.success(`Запис створено: ${entry.name} о ${entry.time}`, {
        description: entry.aiPrep ? "Асистент розпочав підготовку" : undefined,
      });
      logTraining(`Нова навчальна запис: ${entry.name} ${entry.date} ${entry.time}`);
    }, 1500);
    setTimeout(() => setNewlyCreatedId(null), 4500);
  }, [logTraining]);

  const handleSendDashboardReply = useCallback((alertId: string, message: string) => {
    const text = message.trim();
    if (!text) return;

    const sessions = readAssistantStoreWithCleanup();
    const session = sessions[alertId];
    if (!session) return;

    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const hhmm = now.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
    const messageTime = `${dd}.${mm} | ${hhmm}`;

    sessions[alertId] = {
      ...session,
      messages: [...session.messages, { sender: "doctor", text, time: messageTime }],
      waitingForDietAck: false,
      waitingForStep2Ack: false,
      step2AckResult: "none",
      savedAt: Date.now(),
    };

    localStorage.setItem(ASSISTANT_CHAT_LS_KEY, JSON.stringify(sessions));
    cleanupTemporaryChatLogs();
    window.dispatchEvent(new CustomEvent("proctocare-assistant-chat-updated"));

    const patientId = alertId.split("__")[0] || "";
    const patientName = assistantAlerts.find((a) => a.id === alertId)?.patientName;

    setPatients((prev) =>
      prev.map((p) =>
        p.id === patientId
          ? { ...p, status: "progress" as PatientStatus, aiSummary: "Лікар відповів у чаті, очікуємо реакцію пацієнта" }
          : p
      )
    );

    setAssistantAlerts((prev) => prev.filter((a) => a.id !== alertId));
    toast.success(`Відповідь надіслано пацієнту${patientName ? `: ${patientName}` : ""}`);
  }, [assistantAlerts]);

  const handlePatientClick = useCallback((patient: Patient) => {
    // Priority order for which card to open when same person has multiple records:
    // 1. Active future visit (date in future, not completed, not noShow)
    // 2. Waiting planning card (fromForm, planning, no time, today or no date)
    // 3. The patient card as clicked
    const todayIsoNow = getCurrentScheduleDates().todayIso;
    const samePersonVisits = patients.filter((p) => isSamePerson(p, patient));
    const activeFuture = samePersonVisits.find(
      (p) => !p.completed && !p.noShow && p.date && p.date > todayIsoNow
    );
    const waitingCard = !activeFuture && samePersonVisits.find(
      (p) => p.fromForm && p.status === "planning" && !p.completed && !p.noShow && (!p.time || p.time === "")
    );
    const target = activeFuture || waitingCard || patient;

    const donor = patients
      .filter((p) => p.id !== target.id && isSamePerson(p, target))
      .sort((a, b) => profileCompleteness(b) - profileCompleteness(a))[0];

    const hydrated = hydrateMissingProfile(target, donor);
    setSelectedPatient(enrichPatientWithVisitHistory(hydrated, patients));
  }, [patients]);

  const handleNoShow = useCallback((patientId: string) => {
    const current = patientsRef.current.find((p) => p.id === patientId);
    const existingProtocol = current?.protocol?.trim() || "";
    const annotatedProtocol = existingProtocol
      ? `🚫 Прийом аннульовано (неявка пацієнта)\n\n${existingProtocol}`
      : "🚫 Прийом аннульовано (неявка пацієнта)";
    setPatients((prev) =>
      prev.map((p) =>
        p.id === patientId
          ? { ...p, noShow: true, completed: false, status: "risk" as PatientStatus, protocol: annotatedProtocol }
          : p
      )
    );
    void updatePatientInSupabase(patientId, { noShow: true, completed: false, status: "risk", protocol: annotatedProtocol })
      .then(() => refreshPatientsFromSupabase("noShow"));
    toast("Пацієнта позначено як «Не з'явився»");
  }, [refreshPatientsFromSupabase]);

  const handleComplete = useCallback((patientId: string) => {
    setPatients((prev) =>
      prev.map((p) =>
        p.id === patientId
          ? { ...p, completed: true, noShow: false, status: "ready" as PatientStatus }
          : p
      )
    );
    void updatePatientInSupabase(patientId, { completed: true, noShow: false, status: "ready" })
      .then(() => refreshPatientsFromSupabase("complete"));
    toast.success("Процедуру позначено як виконану");
  }, [refreshPatientsFromSupabase]);

  const handleAfterComplete = useCallback((completedId: string) => {
    const pats = patientsRef.current;
    const next = pats.find(
      (p) => p.id !== completedId && (!p.date || p.date === todayIso) && !p.completed && !p.noShow
    );
    if (next) {
      handlePatientClick(next);
    } else {
      setSelectedPatient(null);
      toast.success("Всі прийоми опрацьовано! 🎉");
    }
  }, [todayIso, handlePatientClick]);

  const handleDeletePatient = useCallback(async (patientId: string) => {
    // Resolve the actual record (by id or by identity match)
    const allCurrent = patientsRef.current ?? [];
    const sel = selectedPatientRef.current;
    const byId = allCurrent.find((p) => p.id === patientId);
    const target = byId ?? (sel && !byId
      ? allCurrent.find((p) =>
          isSamePerson(p, sel) &&
          p.time === sel.time &&
          (!!sel.date ? p.date === sel.date : true)
        )
      : undefined);
    const resolvedId = target?.id ?? patientId;
    const patientName = target?.name ?? '';

    // 1. Close UI immediately — card disappears, list cleans up
    setSelectedPatient(null);
    setPatients((prev) => prev.filter((p) => p.id !== resolvedId));

    // 2. Await full deep-delete: Storage files + visits + patient row
    await toast.promise(
      deletePatientVisitFromSupabase(resolvedId),
      {
        loading: `Видалення ${patientName || 'пацієнта'}…`,
        success: `${patientName || 'Пацієнт'} повністю видалений`,
        error: 'Помилка при видаленні — перевірте консоль',
      }
    );
  }, []);

  // Called when PatientDetailView reschedules a completed visit.
  // Reuses an existing blank/no-date record for the same person if one exists (UPDATE),
  //// Clear search bar — save logic must be fully isolated from search state
    setSearchQuery("");
     otherwise creates a NEW visit record in Supabase so the old completed record stays as archive.
  const handleCreateNewVisit = useCallback((newVisitData: { date: string; time?: string }) => {
    const donor = selectedPatientRef.current;
    if (!donor) return;

    // Try to find an existing blank/no-date planning record for the same person
    const existingBlank = patientsRef.current.find(p =>
      p.id !== donor.id &&
      !p.completed &&
      !p.noShow &&
      !p.date &&
      isSamePerson(p, donor)
    );

    if (existingBlank) {
      // UPDATE the blank record — no duplicate inserted in DB
      const updated: Patient = {
        ...existingBlank,
        date: newVisitData.date,
        time: newVisitData.time ?? "",
        status: "planning" as PatientStatus,
      };
      setPatients(prev => prev.map(p => p.id === existingBlank.id ? updated : p));
      setSelectedPatient(enrichPatientWithVisitHistory(updated, patientsRef.current));
      void updatePatientInSupabase(existingBlank.id, {
        date: newVisitData.date,
        ...(newVisitData.time ? { time: newVisitData.time } : {}),
        status: "planning",
      }).then(() => refreshPatientsFromSupabase("rescheduleBlank"));
      return;
    }

    const newId = `new-${Date.now()}`;
    const newPatient: Patient = {
      id: newId,
      patientDbId: donor.patientDbId,
      name: donor.name,
      patronymic: donor.patronymic,
      phone: donor.phone || '',
      birthDate: donor.birthDate,
      allergies: donor.allergies,
      // Hard reset of all visit-specific fields per .cursorrules rule #2:
      // New visit opens sterile — doctor fills in fresh data for this appointment.
      diagnosis: undefined,
      notes: undefined,
      primaryNotes: undefined,
      protocol: undefined,
      files: [],
      procedureHistory: donor.procedureHistory, // keep history (read-only reference)
      protocolHistory: undefined,               // no protocol history for brand-new visit
      time: newVisitData.time ?? "",
      date: newVisitData.date,
      procedure: donor.procedure,
      status: "planning",
      aiSummary: "Очікує підготовки",
      fromForm: true,
      completed: false,
      noShow: false,
    };

    // Optimistically add to list and open card
    setPatients((prev) => [...prev, newPatient]);
    setSelectedPatient(newPatient);

    // Persist in Supabase (look up patient_id from old visit, insert new visit row)
    // Also pass donor allergies so the patient record is repaired if it was corrupted previously
    void createNewVisitForExistingPatient(donor.id, {
      id: newId,
      visit_date: newVisitData.date,
      ...(newVisitData.time ? { visit_time: newVisitData.time } : {}),
      procedure: donor.procedure,
      status: 'planning',
      from_form: true,
    }, donor.allergies ? { allergies: donor.allergies } : undefined).then(() => refreshPatientsFromSupabase("createNewVisit"));
  }, [refreshPatientsFromSupabase]);

  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = tomorrowDate.toLocaleDateString("uk-UA", { weekday: "short", day: "numeric", month: "short" });

  const tomorrowRiskCount = tomorrowPatients.filter(p => p.status === "risk").length;

  const allCalendarPatients = useMemo(() => [
    ...patients,
  ], [patients]);

  const calendarFocusDate = useMemo(() => {
    return pickFocusDateForSearch(allCalendarPatients, searchQuery, todayIso);
  }, [allCalendarPatients, searchQuery, todayIso]);

  // Search ALWAYS redirects to Calendar tab — Operational view is excluded from search flow
  useEffect(() => {
    if (!searchQuery.trim()) return;
    setView("calendar");
  }, [searchQuery]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b-[2px] border-white px-3 sm:px-6 pt-2 pb-2 sm:pt-3 sm:pb-3 space-y-1.5 sm:space-y-2.5 shadow-[0_2px_4px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div>
            <h1 className="text-base sm:text-xl font-bold text-foreground leading-tight tracking-tight">ProctoCare</h1>
            <p className="text-[11px] sm:text-sm text-muted-foreground">
              {new Date().toLocaleDateString("uk-UA", { weekday: "long", day: "numeric", month: "long" })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SearchBar onSearch={setSearchQuery} />
            <button
              onClick={() => openNewEntry()}
              className={cn(
                "w-9 h-9 sm:w-11 sm:h-11 flex items-center justify-center rounded-full bg-primary text-primary-foreground",
                "shadow-[0_2px_8px_rgba(0,0,0,0.15),0_0_0_3px_hsl(var(--primary)/0.2)]",
                "hover:shadow-[0_4px_16px_rgba(0,0,0,0.2),0_0_0_4px_hsl(var(--primary)/0.25)]",
                "active:scale-[0.93] transition-all duration-200"
              )}
            >
              <Plus size={20} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        <div className="max-w-7xl mx-auto space-y-1.5 sm:space-y-2.5">
          <ViewToggle
            activeView={view}
            onViewChange={setView}
            disabledOperational={!!searchQuery.trim()}
          />
          {view === "operational" && (
            <StatusFilterBar activeFilter={filter} onFilterChange={setFilter} counts={counts} />
          )}
          {trainingMode && (
            <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3 text-xs text-foreground flex flex-wrap gap-2">
              <strong>Учебный режим</strong>
              <button
                onClick={() => {
                  const id = `training-${Date.now()}`;
                  const patient: Patient = {
                    id,
                    name: "Тестовий Пацієнт",
                    patronymic: "Тренувальний",
                    time: "12:00",
                    procedure: "Тестова процедура",
                    status: "progress",
                    aiSummary: "Тренувальна запис",
                    birthDate: "01.01.1980",
                    phone: "+380501234567",
                    primaryNotes: "Пробна запис",
                    date: todayIso,
                    fromForm: true,
                  };
                  setPatients((prev) => [...prev, patient]);
                  logTraining(`Додано тест-пацієнта (${id})`);
                }}
                className="px-2 py-1 border border-primary rounded-md bg-white hover:bg-primary/10"
              >
                + Тестова запис
              </button>
              <button
                onClick={() => {
                  setPatients((_prev) => {
                    const resetArr = [
                      ...MOCK_PATIENTS.map((p) => ({ ...p, date: p.date || todayIso })),
                      ...MOCK_TOMORROW.map((p) => ({ ...p, date: p.date || tomorrowIso })),
                    ];
                    return resetArr;
                  });
                  logTraining("Скинуто на мок-дані");
                }}
                className="px-2 py-1 border border-primary rounded-md bg-white hover:bg-primary/10"
              >
                Скинути тестову базу
              </button>
              <button
                onClick={() => setTrainingLog([])}
                className="px-2 py-1 border border-primary rounded-md bg-white hover:bg-primary/10"
              >
                Очистити лог
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-2 sm:py-4 pb-24">
        {view === "operational" ? (
          <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] lg:grid-cols-[340px_1fr] xl:grid-cols-[360px_1fr] gap-3 sm:gap-5">
            {/* Column 1: AI Alerts */}
            <div className="space-y-3 sm:space-y-4">
              <AIAlertSection
                alerts={assistantAlerts}
                onSendReply={handleSendDashboardReply}
                doctorPhone={doctorPhoneForQuickReply}
                onVisitClosed={() => void refreshPatientsFromSupabase("visitClosed")}
                reopenTrigger={unclosedModalReopenTrigger}
                onOpenVisit={(visitId) => {
                  const target = allCalendarPatients.find((p) => p.id === visitId);
                  if (target) {
                    pendingUnclosedReopenRef.current = true;
                    handlePatientClick(enrichPatientWithVisitHistory(target, allCalendarPatients));
                  }
                }}
              />

              {/* Tomorrow card — same size as AI alerts */}
              <button
                onClick={() => setShowTomorrow(!showTomorrow)}
                className={cn(
                  "w-full rounded-xl p-4 text-center transition-all duration-200 active:scale-[0.98] animate-reveal-up",
                  showTomorrow
                    ? "bg-[hsl(263,70%,50%)] text-white shadow-card"
                    : "bg-[hsl(270,80%,90%)] border-2 border-[hsl(270,70%,80%)] shadow-card hover:shadow-card-hover"
                )}
              >
                <div className="flex items-center justify-center gap-2 mb-2">
                  <h3 className={cn("text-sm font-semibold", showTomorrow ? "text-white" : "text-foreground")}>
                    Завтра · {tomorrowStr}
                  </h3>
                  {tomorrowRiskCount > 0 && (
                    <span className="w-6 h-6 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold shadow-sm">
                      {tomorrowRiskCount}
                    </span>
                  )}
                </div>
                <p className={cn("text-xs", showTomorrow ? "text-white/80" : "text-muted-foreground")}>
                  {tomorrowPatients.length} записів · {tomorrowRiskCount > 0 ? `${tomorrowRiskCount} потребує уваги` : "Все в нормі"}
                </p>
              </button>
            </div>

            {/* Column 2: Patient Timeline — toggles between today and tomorrow */}
            <div className="space-y-2 sm:space-y-3">
              {showTomorrow ? (
                <>
                  {/* Проблематика block */}
                  {(() => {
                    const riskTomorrow = filteredTomorrow.filter(p => p.status === "risk");
                    return riskTomorrow.length > 0 ? (
                      <div className="space-y-2 animate-reveal-up">
                        <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                          <AlertTriangle size={14} className="text-destructive" />
                          Проблематика на завтра
                        </h3>
                        {riskTomorrow.map((patient) => (
                          <div
                            key={patient.id}
                            className="flex items-center justify-between gap-3 bg-surface-raised rounded-lg p-3 border-2 border-destructive/20 shadow-card"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-foreground">
                                ⚠️ {patient.name}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {patient.aiSummary}
                              </p>
                            </div>
                            <button
                              onClick={() => handlePatientClick(patient)}
                              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-xs font-bold shrink-0 transition-all hover:bg-destructive/90 active:scale-[0.96] shadow-sm"
                            >
                              {patient.aiSummary.toLowerCase().includes("аналіз") ? (
                                <><MessageCircle size={14} /> Чат</>
                              ) : (
                                <><Phone size={14} /> Зателефонувати</>
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null;
                  })()}

                  {/* Tomorrow schedule */}
                  <h3 className="text-sm font-bold text-foreground mt-3">
                    Записи на завтра
                  </h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
                    {(() => {
                      const morning = filteredTomorrow.filter(p => parseInt(p.time) < 13);
                      const afternoon = filteredTomorrow.filter(p => parseInt(p.time) >= 13);
                      const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;
                      if (!isDesktop) {
                        return filteredTomorrow.map((patient, i) => (
                          <PatientCard key={patient.id} patient={patient} index={i} onClick={handlePatientClick} />
                        ));
                      }
                      return (
                        <>
                          <div className="space-y-2 sm:space-y-3">
                            {morning.map((patient, i) => (
                              <PatientCard key={patient.id} patient={patient} index={i} onClick={handlePatientClick} />
                            ))}
                          </div>
                          <div className="space-y-2 sm:space-y-3">
                            {afternoon.map((patient, i) => (
                              <PatientCard key={patient.id} patient={patient} index={morning.length + i} onClick={handlePatientClick} />
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </>
              ) : (
                <>
                  <div className="hidden md:flex items-baseline gap-3 mb-1">
                    <h3 className="text-lg font-bold text-foreground">Сьогоднішні записи</h3>
                    <span className="text-base font-semibold text-primary">
                      {new Date().toLocaleDateString("uk-UA", { day: "numeric", month: "long" })}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
                    {(() => {
                      const morning = filtered.filter(p => parseInt(p.time) < 13);
                      const afternoon = filtered.filter(p => parseInt(p.time) >= 13);
                      const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;
                      if (!isDesktop) {
                        return filtered.map((patient, i) => (
                          <PatientCard key={patient.id} patient={patient} index={i} onClick={handlePatientClick} isNew={patient.id === newlyCreatedId} onNoShow={handleNoShow} onComplete={handleComplete} onAfterComplete={() => handleAfterComplete(patient.id)} />
                        ));
                      }
                      return (
                        <>
                          <div className="space-y-2 sm:space-y-3">
                            {morning.map((patient, i) => (
                              <PatientCard key={patient.id} patient={patient} index={i} onClick={handlePatientClick} isNew={patient.id === newlyCreatedId} onNoShow={handleNoShow} onComplete={handleComplete} onAfterComplete={() => handleAfterComplete(patient.id)} />
                            ))}
                          </div>
                          <div className="space-y-2 sm:space-y-3">
                            {afternoon.map((patient, i) => (
                              <PatientCard key={patient.id} patient={patient} index={morning.length + i} onClick={handlePatientClick} isNew={patient.id === newlyCreatedId} onNoShow={handleNoShow} onComplete={handleComplete} onAfterComplete={() => handleAfterComplete(patient.id)} />
                            ))}
                          </div>
                        </>
                      );
                    })()}
                    {skeletonPatient && <SkeletonCard patient={skeletonPatient} />}
                  </div>
                  {filtered.length === 0 && !skeletonPatient && (
                    <div className="text-center py-12 text-muted-foreground text-sm animate-fade-in">
                      Немає пацієнтів з таким статусом
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <CalendarView
            onSlotClick={(date, hour) => {
              const y = date.getFullYear();
              const m = String(date.getMonth() + 1).padStart(2, "0");
              const d = String(date.getDate()).padStart(2, "0");
              const dateStr = `${y}-${m}-${d}`;
              const timeStr = `${String(hour).padStart(2, "0")}:00`;

              // If a prepared "waiting" planning card is open (no time set) — assign date+time to it
              // instead of opening the new-entry form.
              const openCard = selectedPatientRef.current;
              if (
                openCard &&
                openCard.fromForm &&
                openCard.status === "planning" &&
                !openCard.completed &&
                !openCard.noShow &&
                (!openCard.time || openCard.time === "")
              ) {
                const updates = { date: dateStr, time: timeStr };
                setPatients((prev) =>
                  prev.map((p) => (p.id === openCard.id ? { ...p, ...updates } : p))
                );
                setSelectedPatient((prev) => prev ? { ...prev, ...updates } : prev);
                void updatePatientInSupabase(openCard.id, updates).then(() =>
                  refreshPatientsFromSupabase("assignDate")
                );
                toast.success(`Дату призначено: ${String(d).padStart(2, "0")}.${m}.${y} о ${timeStr}`);
                return;
              }

              openNewEntry(dateStr, hour);
            }}
            onPatientClick={(p) => {
              const incomingKey = personKey({ name: p.name, patronymic: p.patronymic });
              // Prefer the strongest match first to keep mobile and desktop patient detail in sync.
              const exactById = p.id ? allCalendarPatients.find((rp) => rp.id === p.id) : undefined;
              const exactByDateTimeName = allCalendarPatients.find((rp) =>
                (personKey(rp) === incomingKey || isSamePerson(rp, { name: p.name, patronymic: p.patronymic })) &&
                rp.time === p.time &&
                (!!p.date ? rp.date === p.date : true)
              );
              const byTimeAndPerson = allCalendarPatients.find((rp) =>
                rp.time === p.time && (personKey(rp) === incomingKey || isSamePerson(rp, { name: p.name, patronymic: p.patronymic }))
              );
              const byPerson = allCalendarPatients
                .filter((rp) => personKey(rp) === incomingKey || isSamePerson(rp, { name: p.name, patronymic: p.patronymic }))
                .sort((a, b) => profileCompleteness(b) - profileCompleteness(a))[0];

              const real = exactById || exactByDateTimeName || byTimeAndPerson || byPerson;
              if (real) {
                const donor = allCalendarPatients
                  .filter((rp) => rp.id !== real.id && isSamePerson(rp, real))
                  .sort((a, b) => profileCompleteness(b) - profileCompleteness(a))[0];
                const hydrated = hydrateMissingProfile(real, donor);
                setSelectedPatient(enrichPatientWithVisitHistory(hydrated, allCalendarPatients));
                return;
              }

              const fallbackBase: Patient = {
                id: `cal-${p.name}-${p.time}`,
                name: p.name,
                patronymic: p.patronymic,
                time: p.time,
                procedure: p.procedure,
                status: p.status,
                aiSummary: "Дані з календаря",
                date: p.date || todayIso,
                fromForm: true,
              };
              const fallbackDonor = allCalendarPatients
                .filter((rp) => isSamePerson(rp, fallbackBase))
                .sort((a, b) => profileCompleteness(b) - profileCompleteness(a))[0];
              const hydratedFallback = hydrateMissingProfile(fallbackBase, fallbackDonor);
              setSelectedPatient(enrichPatientWithVisitHistory(hydratedFallback, allCalendarPatients));
            }}
            searchQuery={searchQuery}
            realPatients={allCalendarPatients}
            focusDate={calendarFocusDate}
          />
        )}
      </main>

      {trainingMode && (
        <section className="max-w-7xl mx-auto px-3 sm:px-6 pb-4">
          <div className="bg-surface-raised border border-border rounded-xl p-3 text-xs text-muted-foreground">
            <div className="font-bold text-sm text-primary mb-2">Лог навчального режиму</div>
            {trainingLog.length === 0 ? (
              <p className="italic">Немає подій, почніть роботу через кнопки навчального режиму.</p>
            ) : (
              <ul className="list-disc list-inside space-y-1 h-24 overflow-y-auto">
                {trainingLog.map((line, idx) => (
                  <li key={`${line}-${idx}`} className="break-all">{line}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {showForm && (
        <NewEntryForm
          prefillDate={formPrefill.date}
          prefillTime={formPrefill.time}
          realPatients={allCalendarPatients}
          onClose={() => setShowForm(false)}
          onSave={handleSaveEntry}
        />
      )}
      {selectedPatient && (
        <PatientDetailView
          patient={selectedPatient}
          allPatients={allCalendarPatients}
          onClose={() => {
            if (pendingUnclosedReopenRef.current) {
              pendingUnclosedReopenRef.current = false;
              setUnclosedModalReopenTrigger((n) => n + 1);
            }
            setSelectedPatient(null);
          }}
          onDelete={handleDeletePatient}
          onUpdatePatient={(updates) => {
            setPatients((prev) => {
              const currentById = prev.find((p) => p.id === selectedPatient.id);
              const currentByIdentity = prev.find((p) =>
                isSamePerson(p, selectedPatient) &&
                p.time === selectedPatient.time &&
                (!!selectedPatient.date ? p.date === selectedPatient.date : true)
              );
              const currentByPerson = prev
                .filter((p) => isSamePerson(p, selectedPatient))
                .sort((a, b) => profileCompleteness(b) - profileCompleteness(a))[0];

              const current = currentById || currentByIdentity || currentByPerson;
              const targetId = current?.id || selectedPatient.id;

              const samePerson = prev.filter((p) => p.id !== targetId && isSamePerson(p, selectedPatient));
              const donor = samePerson.sort((a, b) => profileCompleteness(b) - profileCompleteness(a))[0];

              const merged = hydrateMissingProfile({ ...(current || selectedPatient), ...updates }, donor);
              const updated = current
                ? prev.map((p) => (p.id === targetId ? merged : p))
                : [...prev, merged];
              const updatedPatient = updated.find((p) => p.id === targetId) || merged;
              if (updatedPatient) {
                logTraining(`Збережено зміни пацієнта: ${updatedPatient.name}`);
              }
              return updated;
            });
            setSelectedPatient((prev) => {
              if (!prev) return prev;
              return { ...prev, ...updates };
            });
            void updatePatientInSupabase(selectedPatient.id, updates);
          }}
          onCreateNewVisit={handleCreateNewVisit}
          onOpenVisit={(visitId) => {
            const target = allCalendarPatients.find((p) => p.id === visitId);
            if (target) setSelectedPatient(enrichPatientWithVisitHistory(target, allCalendarPatients));
          }}
        />
      )}

    </div>
  );
}

function SkeletonCard({ patient }: { patient: Patient }) {
  return (
    <div className="w-full bg-surface-raised rounded-xl border-l-4 border-l-status-progress px-4 py-3 border border-border/50 shadow-card animate-pulse">
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-muted animate-pulse" />
          <div className="h-3.5 w-14 bg-muted rounded animate-pulse" />
          <div className="h-3.5 w-24 bg-muted rounded-full animate-pulse" />
        </div>
        <div className="h-4.5 w-36 bg-muted rounded animate-pulse" />
        <div className="flex items-center gap-2">
          <div className="h-3.5 w-24 bg-muted rounded animate-pulse" />
          <div className="h-3.5 w-44 bg-primary/10 rounded animate-pulse" />
        </div>
      </div>
      <p className="text-xs text-primary font-medium mt-2 flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        Створення запису для {patient.name}...
      </p>
    </div>
  );
}
