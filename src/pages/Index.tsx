import { useState, useMemo, useCallback, useEffect } from "react";
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

const today = new Date();
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  { id: "mock-petushkov", name: "Петушков Сергій", patronymic: "Юрійович", time: "09:00", procedure: "Поліпектомія при колоноскопії", status: "planning", aiSummary: "Записаний на процедуру, очікує підготовки", date: sundayDateStr, fromForm: true },
];

const MOCK_TOMORROW: Patient[] = [];

const statusToFilter: Record<PatientStatus, FilterType> = {
  planning: "attention",
  ready: "ready",
  progress: "attention",
  risk: "risk",
};

function personKey(patient: Pick<Patient, "name" | "patronymic">): string {
  return `${patient.name.trim().toLowerCase()}|${(patient.patronymic || "").trim().toLowerCase()}`;
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
  const scalarFields: Array<keyof Patient> = [
    "birthDate",
    "phone",
    "allergies",
    "diagnosis",
    "lastVisit",
    "notes",
    "primaryNotes",
    "protocol",
  ];

  for (const field of scalarFields) {
    const current = out[field];
    const fallback = source[field];
    if ((typeof current !== "string" || !current.trim()) && typeof fallback === "string" && fallback.trim()) {
      out[field] = fallback;
    }
  }

  const listFields: Array<keyof Patient> = [
    "files",
    "allergiesHistory",
    "diagnosisHistory",
    "notesHistory",
    "phoneHistory",
    "birthDateHistory",
    "protocolHistory",
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

function rebuildPetushkovRecord(patients: Patient[]): Patient[] {
  const petushkov = patients.filter((p) => p.name.toLowerCase().includes("петушков"));
  if (petushkov.length <= 1) return patients;

  const others = patients.filter((p) => !p.name.toLowerCase().includes("петушков"));
  const richest = petushkov.slice().sort((a, b) => profileCompleteness(b) - profileCompleteness(a))[0];
  const latest = petushkov.slice().sort((a, b) => scheduleSortValue(b) - scheduleSortValue(a))[0];

  const merged = hydrateMissingProfile(normalizePersonName({ ...latest }), richest);
  return [...others, merged];
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

export default function Index() {
  const [view, setView] = useState<"operational" | "calendar">("operational");
  const [filter, setFilter] = useState<FilterType>("all");
  const [showForm, setShowForm] = useState(false);
  const [formPrefill, setFormPrefill] = useState<{ date?: string; time?: string }>({});
  const [showTomorrow, setShowTomorrow] = useState(false);
  const [trainingLog, setTrainingLog] = useState<string[]>([]);
  const trainingMode = true; // Удалить при подключении внешней базы данных

  const logTraining = useCallback((message: string) => {
    const now = new Date();
    setTrainingLog((prev) => [
      `${now.toLocaleString()} · ${message}`,
      ...prev,
    ].slice(0, 30));
  }, []);

  const [patients, setPatients] = useState<Patient[]>(() => {
    const saved = localStorage.getItem("proctocare_all_patients");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Clean up legacy tomorrow mock patients just in case they were cached
        const cleaned = parsed.filter((p: Patient) => !["t1", "t2", "t3", "t4"].includes(p.id));
        return rebuildPetushkovRecord(sanitizePatientsAssistantNotes(cleaned));
      } catch (e) {
        console.error("Failed to parse saved patients", e);
      }
    }
    return [
      ...MOCK_PATIENTS.map(p => ({ ...p, date: p.date || todayDateStr })),
      ...MOCK_TOMORROW.map(p => ({ ...p, date: p.date || tomorrowDateStr })),
    ];
  });

  useEffect(() => {
    setPatients((prev) => sanitizePatientsAssistantNotes(prev));
  }, []);

  // Cleanup old assistant sessions and temporary logs on mount
  useEffect(() => {
    readAssistantStoreWithCleanup();
    cleanupTemporaryChatLogs();
  }, []);

  useEffect(() => {
    localStorage.setItem("proctocare_all_patients", JSON.stringify(patients));
  }, [patients]);

  const [assistantAlerts, setAssistantAlerts] = useState<DashboardAssistantAlert[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [newlyCreatedId, setNewlyCreatedId] = useState<string | null>(null);
  const [skeletonPatient, setSkeletonPatient] = useState<Patient | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const doctorPhoneForQuickReply = useMemo(() => getDoctorPhoneForQuickReply(), []);

  const refreshAssistantAlerts = useCallback(() => {
    setAssistantAlerts(buildDashboardAssistantAlerts(patients));
  }, [patients]);

  useEffect(() => {
    refreshAssistantAlerts();
  }, [refreshAssistantAlerts]);

  useEffect(() => {
    const onAssistantStorageUpdated = () => refreshAssistantAlerts();
    window.addEventListener("proctocare-assistant-chat-updated", onAssistantStorageUpdated);
    return () => window.removeEventListener("proctocare-assistant-chat-updated", onAssistantStorageUpdated);
  }, [refreshAssistantAlerts]);

  useEffect(() => {
    if (!selectedPatient) return;
    const actual = patients.find((p) => p.id === selectedPatient.id);
    if (!actual) return;

    const historyA = JSON.stringify(selectedPatient.notesHistory || []);
    const historyB = JSON.stringify(actual.notesHistory || []);
    if (
      selectedPatient.notes !== actual.notes ||
      selectedPatient.primaryNotes !== actual.primaryNotes ||
      historyA !== historyB
    ) {
      setSelectedPatient((prev) => prev ? {
        ...prev,
        notes: actual.notes,
        primaryNotes: actual.primaryNotes,
        notesHistory: actual.notesHistory,
      } : prev);
    }
  }, [patients, selectedPatient]);

  const todayPatients = useMemo(() => patients.filter(p => !p.date || p.date === todayDateStr), [patients]);
  const tomorrowPatients = useMemo(() => patients.filter(p => p.date === tomorrowDateStr), [patients]);

  const counts = useMemo(() => ({
    total: todayPatients.length,
    ready: todayPatients.filter((p) => p.status === "ready").length,
    risk: todayPatients.filter((p) => p.status === "risk").length,
    attention: todayPatients.filter((p) => p.status === "progress").length,
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
    const newId = `new-${Date.now()}`;
    const newPatient: Patient = {
      id: newId,
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
    };
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
    const donor = patients
      .filter((p) => p.id !== patient.id && personKey(p) === personKey(patient))
      .sort((a, b) => profileCompleteness(b) - profileCompleteness(a))[0];

    setSelectedPatient(hydrateMissingProfile(patient, donor));
  }, [patients]);

  const handleNoShow = useCallback((patientId: string) => {
    setPatients((prev) =>
      prev.map((p) =>
        p.id === patientId ? { ...p, noShow: true } : p
      )
    );
    toast("Пацієнта позначено як «Не з'явився»");
  }, []);

  const handleComplete = useCallback((patientId: string) => {
    setPatients((prev) =>
      prev.map((p) =>
        p.id === patientId ? { ...p, completed: true, status: "ready" as PatientStatus } : p
      )
    );
    toast.success("Процедуру позначено як виконану");
  }, []);

  const handleDeletePatient = useCallback((patientId: string) => {
    setPatients((prev) => prev.filter((p) => p.id !== patientId));
    setSelectedPatient(null);
    toast("Запис видалено");
  }, []);

  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = tomorrowDate.toLocaleDateString("uk-UA", { weekday: "short", day: "numeric", month: "short" });

  const tomorrowRiskCount = tomorrowPatients.filter(p => p.status === "risk").length;

  const allCalendarPatients = useMemo(() => [
    ...patients,
  ], [patients]);

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
          <ViewToggle activeView={view} onViewChange={setView} />
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
                    date: todayDateStr,
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
                      ...MOCK_PATIENTS.map((p) => ({ ...p, date: p.date || todayDateStr })),
                      ...MOCK_TOMORROW.map((p) => ({ ...p, date: p.date || tomorrowDateStr })),
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
                          <PatientCard key={patient.id} patient={patient} index={i} onClick={handlePatientClick} isNew={patient.id === newlyCreatedId} onNoShow={handleNoShow} onComplete={handleComplete} />
                        ));
                      }
                      return (
                        <>
                          <div className="space-y-2 sm:space-y-3">
                            {morning.map((patient, i) => (
                              <PatientCard key={patient.id} patient={patient} index={i} onClick={handlePatientClick} isNew={patient.id === newlyCreatedId} onNoShow={handleNoShow} onComplete={handleComplete} />
                            ))}
                          </div>
                          <div className="space-y-2 sm:space-y-3">
                            {afternoon.map((patient, i) => (
                              <PatientCard key={patient.id} patient={patient} index={morning.length + i} onClick={handlePatientClick} isNew={patient.id === newlyCreatedId} onNoShow={handleNoShow} onComplete={handleComplete} />
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
              openNewEntry(`${y}-${m}-${d}`, hour);
            }}
            onPatientClick={(p) => {
              // Prefer stable ID lookup from calendar to avoid losing patient context.
              const real = (p.id
                ? allCalendarPatients.find((rp) => rp.id === p.id)
                : allCalendarPatients.find((rp) => rp.name === p.name && rp.time === p.time));
              setSelectedPatient(real || {
                id: `cal-${p.name}-${p.time}`,
                name: p.name,
                patronymic: p.patronymic,
                time: p.time,
                procedure: p.procedure,
                status: p.status,
                aiSummary: "Дані з календаря",
              });
            }}
            searchQuery={searchQuery}
            realPatients={allCalendarPatients}
            focusDate={(() => {
              if (!searchQuery.trim()) return undefined;
              const q = searchQuery.toLowerCase();
              const match = allCalendarPatients.find(p => p.name.toLowerCase().includes(q) && p.date);
              return match?.date || undefined;
            })()}
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
          onClose={() => setShowForm(false)}
          onSave={handleSaveEntry}
        />
      )}
      {selectedPatient && (
        <PatientDetailView
          patient={selectedPatient}
          onClose={() => setSelectedPatient(null)}
          onDelete={handleDeletePatient}
          onUpdatePatient={(updates) => {
            setPatients((prev) => {
              const current = prev.find((p) => p.id === selectedPatient.id);
              const samePerson = prev.filter((p) => p.id !== selectedPatient.id && personKey(p) === personKey(selectedPatient));
              const donor = samePerson.sort((a, b) => profileCompleteness(b) - profileCompleteness(a))[0];

              const merged = hydrateMissingProfile({ ...(current || selectedPatient), ...updates }, donor);
              const updated = prev.map((p) => (p.id === selectedPatient.id ? merged : p));
              const updatedPatient = updated.find((p) => p.id === selectedPatient.id);
              if (updatedPatient) {
                logTraining(`Збережено зміни пацієнта: ${updatedPatient.name}`);
              }
              return updated;
            });
            setSelectedPatient((prev) => {
              if (!prev) return prev;
              return { ...prev, ...updates };
            });
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
