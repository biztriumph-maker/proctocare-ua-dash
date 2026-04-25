import { useState, useRef, useEffect, useMemo } from "react";
import {
  AGENT_CHAT_MESSAGES,
  PATIENT_QUICK_REPLIES,
  AI_SUMMARY_BY_STATUS,
  EVENT_LOG_LABELS,
  classifyProcedureGroup,
  ROADMAP_MESSAGES,
} from "@/config/agentMessages";
import { supabase } from "@/lib/supabaseClient";
import { isSupabaseDataMode } from "@/lib/supabaseSync";
import { X, MessageCircle, AlertTriangle, User, Activity, Phone, Send, Pencil, FileText, Trash2, ClipboardList, ChevronRight, ChevronDown, Check, Calendar, RotateCcw, Loader2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { correctNameSpelling } from "@/lib/nameCorrection";
import type { Patient, PatientStatus, HistoryEntry } from "./PatientCard";
import { computePatientStatus, AllergyShield } from "./PatientCard";
import { useIsMobile } from "@/hooks/use-mobile";
import { Progress } from "@/components/ui/progress";
import { CountryPhoneInput } from "./CountryPhoneInput";
import { PatientServices, ReschedulePicker } from "./PatientServices";
import { toast } from "sonner";
import { isPhoneValueValid, normalizePhoneValue } from "@/lib/phoneCountry";
import { allergyStatusLabel, parseAllergyState } from "@/lib/allergyState";
import { PatientAllergies } from "./PatientAllergies";
import { PatientFiles, type FileItem } from "./PatientFiles";
import { PatientProfile } from "./PatientProfile";
import { usePatientContext } from "@/hooks/usePatientContext";

interface ChatMessage {
  sender: "ai" | "patient" | "doctor";
  text: string;
  time: string;
  unanswered?: boolean;
  quickReply?: {
    yes: string;
    no?: string;
    context?: "greeting" | "diet" | "start_prep" | "drug_choice" | "question_resolved";
  };
}

interface PatientDetailViewProps {
  patient: Patient;
  allPatients?: Patient[];
  onClose: () => void;
  onUpdatePatient?: (updates: Partial<Patient>) => void;
  onDelete?: (patientId: string) => Promise<void> | void;
  /** Called when a completed visit is rescheduled — creates a fresh visit record instead of mutating the old one */
  onCreateNewVisit?: (newVisit: { date: string; time?: string }) => Promise<void> | void;
  /** Called when doctor clicks "open" on an archived visit — switches to that visit's card */
  onOpenVisit?: (visitId: string) => void;
}

const statusLabel: Record<PatientStatus, string> = {
  planning: "Планування",
  progress: "Підготовка",
  yellow:   "Підготовка",
  risk:     "Потребує уваги",
  ready:    "Допущено до процедури",
};

const statusDot: Record<PatientStatus, string> = {
  planning: "bg-slate-400",
  progress: "bg-yellow-500",
  yellow:   "bg-yellow-500",
  risk:     "bg-red-500",
  ready:    "bg-green-500",
};

const statusBadgeBg: Record<PatientStatus, string> = {
  planning: "bg-slate-100 text-slate-700",
  progress: "bg-yellow-100 text-yellow-800",
  yellow:   "bg-yellow-100 text-yellow-800",
  risk:     "bg-red-100 text-red-700",
  ready:    "bg-green-100 text-green-700",
};

function calcAge(birthDate: string): { age: number | null; ageStr: string } {
  const parts = birthDate.split(".");
  if (parts.length === 3 && parts[2].length === 4) {
    const bd = new Date(+parts[2], +parts[1] - 1, +parts[0]);
    if (!isNaN(bd.getTime())) {
      const today = new Date();
      let age = today.getFullYear() - bd.getFullYear();
      const m = today.getMonth() - bd.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
      if (age >= 0 && age < 150) {
        const ld = age % 10, lt = age % 100;
        const s = (lt >= 11 && lt <= 14) ? "років" : ld === 1 ? "рік" : (ld >= 2 && ld <= 4) ? "роки" : "років";
        return { age, ageStr: `${age} ${s}` };
      }
    }
  }
  return { age: null, ageStr: "—" };
}

function normalizePhoneWithPlus(value: string): string {
  return normalizePhoneValue(value);
}

function getStorablePhone(value: string): string {
  return normalizePhoneValue(value);
}

function getTodayIsoKyiv(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kiev" }).format(new Date());
}

function formatHistory(history?: Array<{ value: string; timestamp: string; date: string }>, value?: string): string {
  const entries = history || [];
  if (entries.length > 0) {
    return entries
      .filter((item) => item.value.trim())
      .map((item) => `${item.value} (${item.timestamp})`)
      .join(", ");
  }
  return value || "";
}

function isoToDisplay(isoDate?: string, fallback?: string): string {
  const parts = isoDate?.split("-");
  if (parts?.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
  return fallback || isoDate || "";
}

function displayToIso(displayDate?: string): string {
  const parts = displayDate?.split(".");
  if (parts?.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return "";
}

const RESCHEDULED_MARKER = "__RESCHEDULED_TO__:";

/** Переміщує курсор у самий кінець тексту у input або textarea. */
function focusAtEnd(el: HTMLInputElement | HTMLTextAreaElement) {
  const len = el.value.length;
  el.selectionStart = len;
  el.selectionEnd = len;
}

function formatDateUkrainian(ddmmyyyy: string): string {
  const months = ["січня","лютого","березня","квітня","травня","червня","липня","серпня","вересня","жовтня","листопада","грудня"];
  const [d, m, y] = ddmmyyyy.split(".");
  if (!d || !m || !y) return ddmmyyyy;
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1] ?? ""} ${y}`;
}

function mergeUniqueHistoryEntries(
  primary: Array<{ value: string; timestamp: string; date: string }> | undefined,
  seeded: Array<{ value: string; timestamp: string; date: string }>
): Array<{ value: string; timestamp: string; date: string }> {
  const map = new Map<string, { value: string; timestamp: string; date: string }>();
  for (const item of [...seeded, ...(primary || [])]) {
    map.set(`${item.date}|${item.value}`, item);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function getInitialActiveProtocol(patient: Patient, activeVisitIso: string): string {
  const sameVisitEntry = (patient.protocolHistory || [])
    .filter((h) => h.date === activeVisitIso && !h.value.startsWith(RESCHEDULED_MARKER))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .at(-1);
  if (sameVisitEntry?.value?.trim()) return sameVisitEntry.value;

  if (typeof patient.protocol === "string" && patient.protocol.trim()) {
    return patient.protocol;
  }

  const todayIso = getTodayIsoKyiv();
  if (activeVisitIso > todayIso) return "";

  return patient.protocol || "";
}

// ── Текстовий двигун асистента (Блок 5 / 5.1 ТЗ) ─────────────────────────────
// Статуси: planning (сірий) | yellow (підготовка) | risk (червоний) | ready (зелений)

function getPatientNameInfo(patient: Patient): { salutation: string; firstName: string; address: string } {
  const parts = (patient.name || "").trim().split(/\s+/).filter(Boolean);
  const firstName = parts.length >= 2 ? parts[1] : (parts[0] || "Пацієнт");
  const patronymic = (patient.patronymic || "").trim();
  const isFemale = patronymic.endsWith("івна") || patronymic.endsWith("ївна") || patronymic.endsWith("вна");
  const salutation = isFemale ? "Пані" : "Пане";
  const address = patronymic ? `${salutation} ${firstName} ${patronymic}` : `${salutation} ${firstName}`;
  return { salutation, firstName, address };
}

function buildGreetingMessage(patient: Patient, appointmentIsoDate: string, appointmentTime: string, serviceName: string): string {
  const { address } = getPatientNameInfo(patient);
  return AGENT_CHAT_MESSAGES.greetingTemplate({
    patientAddress: address,
    serviceName: serviceName || "процедуру",
    appointmentDisplay: isoToDisplay(appointmentIsoDate),
    appointmentTime: appointmentTime || "--:--",
  });
}

function buildDrugSelectionMessage(patient: Patient): string {
  const { salutation, firstName } = getPatientNameInfo(patient);
  return AGENT_CHAT_MESSAGES.drugSelectionTemplate({ salutation, firstName });
}

/** "Я готова" for female, "Я готовий" for male — based on patronymic suffix */
function getReadyButtonText(patient: Patient): string {
  const { salutation } = getPatientNameInfo(patient);
  return salutation === "Пані" ? "Я готова" : "Я готовий";
}

// ── Autonomous assistant trigger helpers ─────────────────────────────────────

const WELCOME_SENT_LS_KEY = "proctocare_welcome_sent";
const ASSISTANT_CHAT_LS_KEY = "proctocare_assistant_chat";
const ASSISTANT_CHAT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type AssistantSessionState = {
  messages: ChatMessage[];
  waitingForDietAck: boolean;
  dietInstructionSent: boolean;
  waitingForStep2Ack: boolean;
  step2AckResult: "none" | "confirmed" | "question";
  welcomeSent: boolean;
  drugChoice: 'fortrans' | 'izyklin' | null;
};

type AssistantSessionStoredState = AssistantSessionState & {
  savedAt: number;
};

function getVisitIsoFromSessionKey(key: string): string {
  const parts = key.split("__");
  return parts[1] || "";
}

function normalizeAndPruneAssistantStore(store: Record<string, unknown>): { cleaned: Record<string, AssistantSessionStoredState>; changed: boolean } {
  const cleaned: Record<string, AssistantSessionStoredState> = {};
  const now = Date.now();
  let changed = false;

  for (const [key, value] of Object.entries(store)) {
    if (!value || typeof value !== "object") {
      changed = true;
      continue;
    }

    const session = value as Partial<AssistantSessionStoredState>;
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
      messages: session.messages,
      waitingForDietAck: !!session.waitingForDietAck,
      dietInstructionSent: !!session.dietInstructionSent,
      waitingForStep2Ack: !!session.waitingForStep2Ack,
      step2AckResult: session.step2AckResult === "confirmed" || session.step2AckResult === "question" ? session.step2AckResult : "none",
      welcomeSent: !!session.welcomeSent,
      drugChoice: session.drugChoice === "fortrans" || session.drugChoice === "izyklin" ? session.drugChoice : null,
      savedAt,
    };
  }

  return { cleaned, changed };
}

function isViberPhoneValid(phone: string): boolean {
  return isPhoneValueValid(phone);
}

function getWelcomeEntry(patientId: string, visitIso: string): { time: string; text: string } | null {
  try {
    const raw = localStorage.getItem(WELCOME_SENT_LS_KEY);
    if (!raw) return null;
    const store = JSON.parse(raw) as Record<string, { time: string; text: string } | boolean>;
    const entry = store[`${patientId}__${visitIso}`];
    if (!entry || typeof entry === "boolean") return null;
    return entry as { time: string; text: string };
  } catch {
    return null;
  }
}

function parseWelcomeText(text: string): { greeting: string; body: string } {
  try {
    const parsed = JSON.parse(text) as { greeting?: string; body?: string };
    if (parsed.greeting && parsed.body) {
      return {
        greeting: parsed.greeting,
        body: `**${parsed.greeting}**\n\n${parsed.body}`,
      };
    }
  } catch {
    // Backward compatibility for old plain-text entries.
  }
  return { greeting: "", body: text };
}

function isWelcomeSent(patientId: string, visitIso: string): boolean {
  try {
    const raw = localStorage.getItem(WELCOME_SENT_LS_KEY);
    if (!raw) return false;
    const store = JSON.parse(raw) as Record<string, unknown>;
    return !!store[`${patientId}__${visitIso}`];
  } catch {
    return false;
  }
}

function markWelcomeSent(patientId: string, visitIso: string, time: string, text: string): void {
  try {
    const raw = localStorage.getItem(WELCOME_SENT_LS_KEY);
    const store = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    store[`${patientId}__${visitIso}`] = { time, text };
    localStorage.setItem(WELCOME_SENT_LS_KEY, JSON.stringify(store));
  } catch { /* ignore storage errors */ }
}

function getAssistantSession(patientId: string, visitIso: string): AssistantSessionState | null {
  try {
    const raw = localStorage.getItem(ASSISTANT_CHAT_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const { cleaned, changed } = normalizeAndPruneAssistantStore(parsed);
    if (changed) localStorage.setItem(ASSISTANT_CHAT_LS_KEY, JSON.stringify(cleaned));
    const entry = cleaned[`${patientId}__${visitIso}`];
    if (!entry || !Array.isArray(entry.messages)) return null;
    return {
      messages: entry.messages,
      waitingForDietAck: !!entry.waitingForDietAck,
      dietInstructionSent: !!entry.dietInstructionSent,
      waitingForStep2Ack: !!entry.waitingForStep2Ack,
      step2AckResult: entry.step2AckResult === "confirmed" || entry.step2AckResult === "question" ? entry.step2AckResult : "none",
      welcomeSent: !!entry.welcomeSent,
      drugChoice: entry.drugChoice === "fortrans" || entry.drugChoice === "izyklin" ? entry.drugChoice : null,
    };
  } catch {
    return null;
  }
}

function saveAssistantSession(patientId: string, visitIso: string, session: AssistantSessionState): void {
  try {
    const raw = localStorage.getItem(ASSISTANT_CHAT_LS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const { cleaned } = normalizeAndPruneAssistantStore(parsed);
    cleaned[`${patientId}__${visitIso}`] = {
      ...session,
      savedAt: Date.now(),
    };
    localStorage.setItem(ASSISTANT_CHAT_LS_KEY, JSON.stringify(cleaned));
    window.dispatchEvent(new CustomEvent("proctocare-assistant-chat-updated"));
  } catch {
    // ignore storage errors
  }
}

function renderHistory(history?: Array<{ value: string; timestamp: string; date: string }>) {
  if (!history || history.length === 0) return null;
  return (
    <div className="mt-1 text-[10px] text-muted-foreground space-y-0.5">
      {history.slice().reverse().map((item, idx) => (
        <div key={`${item.date}-${idx}`} className="flex items-baseline gap-1.5">
          <span className="font-bold shrink-0">{isoToDisplay(item.date, item.timestamp)}</span>
          <span>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

// Повертає найважливішу послугу для відображення в заголовку
function getPrimaryService(services: string[]): string {
  if (services.length === 0) return "";
  if (services.length === 1) return services[0];
  // Пріоритет: Поліпектомія > Біопсія > Колоноскопія/Гастроскопія > решта
  const priority = (s: string) => {
    if (s.includes("Поліпектомія") || s.includes("Розширена біопсія")) return 1;
    if (s.includes("Біопсія") || s.includes("OLGA") || s.includes("Гістологія")) return 2;
    if (s.includes("Колоноскопія") || s.includes("Гастроскопія") || s.includes("Ректо")) return 3;
    if (s.includes("Медичний сон")) return 5;
    return 4;
  };
  return [...services].sort((a, b) => priority(a) - priority(b))[0];
}

function getServiceCategory(services: string[]): { label: string; color: string; bgColor: string } {
  const priorityMap = {
    "ОПЕРАЦІЯ": { priority: 1, keywords: ["Поліпектомія", "Розширена біопсія"], color: "#F39C12", bgColor: "#FFF3CD" },
    "ДІАГНОСТИКА": { priority: 2, keywords: ["Колоноскопія", "Гастроскопія", "Ректоскопія", "Ректо-сигмоскопія", "Біопсія"], color: "#3498DB", bgColor: "#D1ECF1" },
    "КОНСУЛЬТАЦІЯ": { priority: 3, keywords: ["Консультація"], color: "#95A5A6", bgColor: "#F8F9FA" },
  };

  let highestPriority = Infinity;
  let selectedCategory = "КОНСУЛЬТАЦІЯ"; // default

  for (const service of services) {
    const cleanService = service.replace(/ з медичний сон/g, "").trim();
    for (const [category, { priority, keywords }] of Object.entries(priorityMap)) {
      if (keywords.some(keyword => cleanService.includes(keyword))) {
        if (priority < highestPriority) {
          highestPriority = priority;
          selectedCategory = category;
        }
      }
    }
  }

  const config = priorityMap[selectedCategory as keyof typeof priorityMap];
  return { label: selectedCategory, color: config.color, bgColor: config.bgColor };
}

function getMockProfile(patient: Patient) {
  const birthDateStr = patient.birthDate || "";
  const { ageStr } = calcAge(birthDateStr);
  const normalizedAllergy = patient.allergies ?? "";
  return {
    birthDate: birthDateStr,
    age: ageStr,
    phone: patient.phone || "",
    allergies: normalizedAllergy,
    diagnosis: patient.diagnosis || "",
    lastVisit: patient.lastVisit || "",
    notes: patient.notes || patient.primaryNotes || "",
  };
}

function getMockChat(patient: Patient): ChatMessage[] {
  if (patient.fromForm) return [];
  const base: ChatMessage[] = [
    { sender: "ai", text: "Доброго дня! Починайте підготовку за інструкцією: дієта без клітковини за 3 дні до процедури.", time: "09:00" },
    { sender: "patient", text: "Дякую. А що саме не можна їсти?", time: "09:15" },
    { sender: "ai", text: "Виключіть: хліб, каші, овочі, фрукти, горіхи. Дозволено: білий рис, курка, риба, бульйон.", time: "09:16" },
  ];

  if (patient.status === "risk") {
    base.push(
      { sender: "patient", text: "У мене алергія на один з препаратів. Що робити?", time: "10:20", unanswered: true },
    );
  } else if (patient.status === "progress") {
    base.push(
      { sender: "patient", text: "Препарат прийнято, починаю очищення.", time: "14:00" },
      { sender: "ai", text: "Чудово! Продовжуйте за графіком. Наступна порція о 18:00.", time: "14:01" },
    );
  } else {
    base.push(
      { sender: "patient", text: "Все зроблено, почуваюсь добре.", time: "18:00" },
      { sender: "ai", text: "Підготовка завершена. Завтра о 08:00 чекаємо вас натщесерце.", time: "18:01" },
    );
  }

  return base;
}

function getPreparationProgress(patient: Patient, _services?: string[]): { percent: number; steps: { label: string; done: boolean }[] } {
  const status = patient.status;
  const group = classifyProcedureGroup(patient.procedure || "");
  const isActive = status === "progress" || status === "yellow" || status === "risk";

  // Група Г — Гастроскопія: 2 кроки
  if (group === 'G') {
    const steps = [
      { label: "Підготовка вечері", done: status === "ready" || isActive },
      { label: "Готовий до процедури", done: status === "ready" },
    ];
    return { percent: Math.round((steps.filter(s => s.done).length / steps.length) * 100), steps };
  }

  // Група К — Колоноскопія / Ректоскопія: 3 кроки
  if (group === 'K') {
    const steps = [
      { label: "Дієта та підготовка", done: status === "ready" || isActive },
      { label: "Прийом препарату", done: status === "ready" },
      { label: "Готовий до процедури", done: status === "ready" },
    ];
    return { percent: Math.round((steps.filter(s => s.done).length / steps.length) * 100), steps };
  }

  // Fallback — невизначена процедура: 4 кроки (старий вигляд)
  const steps = [
    { label: "Дієта 3 дні", done: status === "ready" || status === "progress" || status === "risk" },
    { label: "Прийом препарату", done: status === "ready" || status === "progress" },
    { label: "Очищення завершено", done: status === "ready" },
    { label: "Готовий до процедури", done: status === "ready" },
  ];
  return { percent: Math.round((steps.filter(s => s.done).length / steps.length) * 100), steps };
}

export function PatientDetailView({ patient, allPatients = [], onClose, onUpdatePatient, onDelete, onCreateNewVisit, onOpenVisit }: PatientDetailViewProps) {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<"card" | "assistant" | "files">("card");
  const mobileTabScrollRef = useRef<HTMLDivElement>(null);
  const [focusField, setFocusField] = useState<{ field: string; value: string; history?: HistoryEntry[] } | null>(null);
  const [deletePhase, setDeletePhase] = useState<"idle" | "confirm" | "countdown">("idle");
  const [deleteCountdown, setDeleteCountdown] = useState(30);
  const deleteTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [localFullName, setLocalFullName] = useState(() => {
    const raw = `${patient.name}${patient.patronymic ? ` ${patient.patronymic}` : ""}`;
    return correctNameSpelling(raw);
  });
  const nameInputRef = useRef<HTMLInputElement>(null);
  const ctx = usePatientContext(patient, allPatients);
  const profile = ctx.profile;
  const activeVisitIso = ctx.activeVisitIso;
  const activeVisitDisplayDate = ctx.activeVisitDisplayDate;
  const relatedVisits = ctx.relatedVisits;

  const hasPastVisitFromAll = ctx.hasPastVisits;
  const lastCompletedVisitFromAll = ctx.lastCompletedVisit;
  const completedPastVisitDates = ctx.completedPastVisitDates;
  const archivedVisitOutcomeByDate = ctx.archivedVisitOutcomeByDate;
  const currentVisitOutcome = ctx.currentVisitOutcome;

  useEffect(() => {
    // Closed visits should not keep focus overlays mounted in DOM.
    if (currentVisitOutcome && focusField) setFocusField(null);
  }, [currentVisitOutcome, focusField]);
  
  const isCompletedPastVisit = ctx.isCompletedPastVisit;
  const isNoShowPast = ctx.isNoShowPast;
  const shouldClearVisitFields = ctx.shouldClearVisitFields;
  const initialNotes = ctx.initialNotes;
  const initialProtocol = ctx.initialProtocol;
  const initialPhone = ctx.initialPhone;
  const initialServices = ctx.initialServices;
  const initialDiagnosis = ctx.initialDiagnosis;

  const [fields, setFields] = useState({
    phone: initialPhone,
    allergies: profile.allergies, // CRITICAL: allergies belong to patient, never cleared
    diagnosis: initialDiagnosis,
    notes: initialNotes,
    protocol: initialProtocol,
    birthDate: profile.birthDate,
  });
  const currentAllergy = useMemo(() => parseAllergyState(fields.allergies), [fields.allergies]);

  const [localServices, setLocalServices] = useState<string[]>(initialServices);
  const [showReschedulePicker, setShowReschedulePicker] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const restoredAssistantSession = getAssistantSession(patient.id, activeVisitIso);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    if (!mobileTabScrollRef.current) return;
    mobileTabScrollRef.current.scrollTop = 0;
  }, [activeTab, isMobile]);

  const [emulatedMessages, setEmulatedMessages] = useState<ChatMessage[]>(() => {
    if (restoredAssistantSession?.messages?.length) {
      return restoredAssistantSession.messages;
    }
    const entry = getWelcomeEntry(patient.id, activeVisitIso);
    if (!entry) return [];
    const text = buildGreetingMessage(patient, activeVisitIso, patient.time, patient.procedure || "");
    return [{ sender: "ai", text, time: entry.time, quickReply: { yes: getReadyButtonText(patient), no: "Є запитання", context: "start_prep" } }];
  });
  const [waitingForDietAck, setWaitingForDietAck] = useState(restoredAssistantSession?.waitingForDietAck ?? false);
  const [dietInstructionSent, setDietInstructionSent] = useState(restoredAssistantSession?.dietInstructionSent ?? false);
  const [waitingForStep2Ack, setWaitingForStep2Ack] = useState(restoredAssistantSession?.waitingForStep2Ack ?? false);
  const [step2AckResult, setStep2AckResult] = useState<"none" | "confirmed" | "question">(restoredAssistantSession?.step2AckResult ?? "none");
  const [welcomeSent, setWelcomeSent] = useState(() => restoredAssistantSession?.welcomeSent ?? isWelcomeSent(patient.id, activeVisitIso));
  const [drugChoice, setDrugChoice] = useState<'fortrans' | 'izyklin' | null>(
    restoredAssistantSession?.drugChoice ?? patient.drugChoice ?? null
  );
  const [isTyping, setIsTyping] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for stable reads inside the init effect without adding to its deps.
  // Prevents wiping locally-generated greeting when Supabase normalizes a
  // temp visit ID (new-{ts}) to a real UUID — the key in localStorage changes,
  // but the in-memory state should be preserved until the save-effect re-persists it.
  const emulatedMessagesRef = useRef(emulatedMessages);
  const welcomeSentRef = useRef(welcomeSent);
  const prevPatientIdRef = useRef(patient.id);
  const drugChoiceRef = useRef(drugChoice);
  const step2AckResultRef = useRef(step2AckResult);
  const dietInstructionSentRef = useRef(dietInstructionSent);
  const patientRef = useRef(patient);

  useEffect(() => {
    const restored = getAssistantSession(patient.id, activeVisitIso);
    if (restored) {
      setEmulatedMessages(restored.messages);
      setWaitingForDietAck(restored.waitingForDietAck);
      setDietInstructionSent(restored.dietInstructionSent);
      setWaitingForStep2Ack(restored.waitingForStep2Ack);
      setStep2AckResult(restored.step2AckResult);
      setWelcomeSent(restored.welcomeSent);
      setDrugChoice(restored.drugChoice);
      return;
    }

    const entry = getWelcomeEntry(patient.id, activeVisitIso);
    if (entry) {
      const text = buildGreetingMessage(patient, activeVisitIso, patient.time, patient.procedure || "");
      setEmulatedMessages([{ sender: "ai", text, time: entry.time, quickReply: { yes: getReadyButtonText(patient), no: "Є запитання", context: "start_prep" } }]);
      setWelcomeSent(true);
      setWaitingForDietAck(false);
      setDietInstructionSent(false);
      setWaitingForStep2Ack(false);
      setStep2AckResult("none");
      return;
    }

    // No localStorage entry found for this patient.id / visitIso combination.
    // Supabase ID normalization: the temp "new-{ts}" visit ID was replaced with a real
    // UUID after the DB insert confirmed. Preserve in-memory state — the save-effect
    // will re-persist everything under the new key on next tick.
    const prevId = prevPatientIdRef.current;
    prevPatientIdRef.current = patient.id;
    if (prevId.startsWith("new-") && (emulatedMessagesRef.current.length > 0 || welcomeSentRef.current)) {
      return;
    }

    setEmulatedMessages([]);
    setWelcomeSent(false);
    setWaitingForDietAck(false);
    setDietInstructionSent(false);
    setWaitingForStep2Ack(false);
    setStep2AckResult("none");
  }, [patient.id, activeVisitIso]);

  // Keep refs in sync after every render so effects can always read the latest
  // values without adding them to dependency arrays.
  useEffect(() => {
    emulatedMessagesRef.current = emulatedMessages;
    welcomeSentRef.current = welcomeSent;
    prevPatientIdRef.current = patient.id;
    drugChoiceRef.current = drugChoice;
    step2AckResultRef.current = step2AckResult;
    dietInstructionSentRef.current = dietInstructionSent;
    patientRef.current = patient;
  });

  useEffect(() => {
    saveAssistantSession(patient.id, activeVisitIso, {
      messages: emulatedMessages,
      waitingForDietAck,
      dietInstructionSent,
      waitingForStep2Ack,
      step2AckResult,
      welcomeSent,
      drugChoice,
    });
  }, [patient.id, activeVisitIso, emulatedMessages, waitingForDietAck, dietInstructionSent, waitingForStep2Ack, step2AckResult, welcomeSent, drugChoice]);

  // Realtime: cross-device assistant action sync.
  // Reconstructs full AI conversation on receiving device from DB state transitions.
  // Self-exclusion via refs: if this device already applied the action, refs reflect
  // post-action state → condition is false → no double-render or duplicate messages.
  useEffect(() => {
    if (!isSupabaseDataMode || patient.id.startsWith("new-")) return;
    const visitId = patient.id;

    const makeTime = () => {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, "0");
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const hhmm = now.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
      return `${dd}.${mm} | ${hhmm}`;
    };

    const applyRemoteTransition = (row: Record<string, unknown>) => {
      const newDrug   = row.drug_choice as string | null | undefined;
      const newStatus = row.status     as string | null | undefined;
      const t = makeTime();

      // ── 1. Drug choice → patient reply + confirm + roadmap ─────────────────
      // Self-exclusion: newDrug already equals ref (this device just saved it)
      if (
        (newDrug === 'fortrans' || newDrug === 'izyklin') &&
        newDrug !== drugChoiceRef.current &&
        !dietInstructionSentRef.current
      ) {
        const choice     = newDrug as 'fortrans' | 'izyklin';
        const drugName   = choice === 'fortrans' ? 'Фортранс' : 'Ізіклін';
        const patientTxt = choice === 'fortrans' ? PATIENT_QUICK_REPLIES.fortrans : PATIENT_QUICK_REPLIES.izyklin;
        const group      = classifyProcedureGroup(patientRef.current.procedure || '');
        const roadmap    = group === 'G'
          ? ROADMAP_MESSAGES.groupG()
          : ROADMAP_MESSAGES.groupK({ drugChoice: choice });
        setDrugChoice(choice);
        setDietInstructionSent(true);
        setEmulatedMessages((prev) => [
          ...prev.map((m) => m.quickReply ? { ...m, quickReply: undefined } : m),
          { sender: 'patient' as const, text: patientTxt, time: t },
          { sender: 'ai'     as const, text: AGENT_CHAT_MESSAGES.drugChoiceConfirm({ drugName }), time: t },
          { sender: 'ai'     as const, text: roadmap, time: t },
        ]);
        return;
      }

      // ── 2. Status → 'yellow' (start_prep yes) → patient reply + drug selection ──
      // Self-exclusion: drug_choice question already visible OR diet step already done
      if (
        newStatus === 'yellow' &&
        step2AckResultRef.current !== 'question' &&
        !dietInstructionSentRef.current &&
        !emulatedMessagesRef.current.some((m) => m.quickReply?.context === 'drug_choice')
      ) {
        const drugText  = buildDrugSelectionMessage(patientRef.current);
        const readyText = getReadyButtonText(patientRef.current);
        setEmulatedMessages((prev) => [
          ...prev.map((m) => m.quickReply ? { ...m, quickReply: undefined } : m),
          { sender: 'patient' as const, text: readyText, time: t },
          {
            sender: 'ai' as const,
            text: drugText,
            time: t,
            quickReply: {
              yes: PATIENT_QUICK_REPLIES.fortrans,
              no:  PATIENT_QUICK_REPLIES.izyklin,
              context: 'drug_choice' as const,
            },
          },
        ]);
        return;
      }

      // ── 3. Status → 'risk' → patient reply + typing + "Є запитання" response ──
      // Self-exclusion: step2AckResult already 'question' (this device just set it)
      if (newStatus === 'risk' && step2AckResultRef.current !== 'question') {
        const { address } = getPatientNameInfo(patientRef.current);
        setStep2AckResult('question');
        setEmulatedMessages((prev) => [
          ...prev.map((m) => m.quickReply ? { ...m, quickReply: undefined } : m),
          { sender: 'patient' as const, text: PATIENT_QUICK_REPLIES.dietNo, time: t },
        ]);
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        setIsTyping(true);
        typingTimerRef.current = setTimeout(() => {
          setIsTyping(false);
          setEmulatedMessages((prev) => [...prev, {
            sender: 'ai' as const,
            text: AGENT_CHAT_MESSAGES.hasQuestionResponse({ address }),
            time: makeTime(),
            quickReply: { yes: PATIENT_QUICK_REPLIES.questionResolved, context: 'question_resolved' as const },
          }]);
        }, 1000);
        return;
      }

      // ── 4. Status → 'yellow' (question resolved) → patient reply + typing + confirm ──
      // Self-exclusion: step2AckResult already 'none' (this device just reset it)
      if (newStatus === 'yellow' && step2AckResultRef.current === 'question') {
        setStep2AckResult('none');
        setEmulatedMessages((prev) => [
          ...prev.map((m) => m.quickReply ? { ...m, quickReply: undefined } : m),
          { sender: 'patient' as const, text: PATIENT_QUICK_REPLIES.questionResolved, time: t },
        ]);
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        setIsTyping(true);
        typingTimerRef.current = setTimeout(() => {
          setIsTyping(false);
          setEmulatedMessages((prev) => [...prev, {
            sender: 'ai' as const,
            text: AGENT_CHAT_MESSAGES.questionResolvedConfirm,
            time: makeTime(),
          }]);
        }, 800);
        return;
      }
    };

    const channel = supabase
      .channel(`pdv-${visitId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'visits' },
        (payload) => {
          const row = (payload.new ?? {}) as Record<string, unknown>;
          if (row.id !== visitId) return;
          applyRemoteTransition(row);
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') console.error('[PDV Realtime] channel error for visit', visitId);
      });

    // Mobile: reconcile state when tab regains focus (WS channel may have dropped)
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      const { data } = await supabase
        .from('visits')
        .select('id, drug_choice, status')
        .eq('id', visitId)
        .single();
      if (data) applyRemoteTransition(data as Record<string, unknown>);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      void supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [patient.id]);

  // Cleanup typing timer on unmount
  useEffect(() => () => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
  }, []);

  const baseChat = getMockChat(patient);
  const chat = [...baseChat, ...emulatedMessages];
  const unanswered = chat.filter((m) => m.unanswered);
  const preparation = getPreparationProgress(patient, localServices);

  const effectiveStatus = useMemo<PatientStatus>(() => {
    if (patient.noShow) return "risk";
    if (patient.completed) return "ready";
    if (step2AckResult === "question") return "risk";
    return computePatientStatus(patient);
  }, [patient, step2AckResult]);

  useEffect(() => {
    if (!onUpdatePatient) return;
    if (patient.status === effectiveStatus) return;

    const aiSummaryByStatus: Record<PatientStatus, string> = AI_SUMMARY_BY_STATUS;

    onUpdatePatient({
      status: effectiveStatus,
      aiSummary: aiSummaryByStatus[effectiveStatus],
    });
  }, [effectiveStatus, onUpdatePatient, patient.status]);

  // Clear notes field when a visit is marked as completed, so the card
  // is clean and ready for the next visit session.
  const prevCompletedRef = useRef(patient.completed);
  useEffect(() => {
    const wasCompleted = prevCompletedRef.current;
    prevCompletedRef.current = patient.completed;
    if (!wasCompleted && patient.completed) {
      const updates: Record<string, unknown> = {};

      // Archive current protocol to history and persist the text in DB.
      // We do NOT clear protocol to "" — keeping it in the DB row lets
      // enrichPatientWithVisitHistory build protocolHistory for future visits,
      // enabling the "copy from last visit" button and archive content display.
      if (fields.protocol?.trim()) {
        const newEntry = { value: fields.protocol.trim(), timestamp: activeVisitDisplayDate, date: activeVisitIso };
        const existingHistory = patient.protocolHistory || [];
        const hasEntry = existingHistory.some((h) => h.date === activeVisitIso && !h.value.startsWith(RESCHEDULED_MARKER));
        updates.protocolHistory = hasEntry ? existingHistory : [...existingHistory, newEntry];
        // Save (not clear) so the text survives page refresh via visits.protocol column
        updates.protocol = fields.protocol.trim();
      }

      // Clear notes
      if (fields.notes?.trim()) {
        setFields((prev) => ({ ...prev, notes: "" }));
        updates.notes = "";
      }

      // Clear services: save empty procedure to DB so it doesn't reappear on reload
      if (localServices.length > 0) {
        setLocalServices([]);
        updates.procedure = "";
      }

      // Reset only diagnosis — allergies MUST NEVER be cleared (they belong to the patient profile).
      if (fields.diagnosis?.trim()) {
        setFields((prev) => ({ ...prev, diagnosis: "" }));
        updates.diagnosis = "";
      }

      if (Object.keys(updates).length > 0) {
        onUpdatePatient?.(updates as Partial<Patient>);
      }
    }
  }, [patient.completed]); // eslint-disable-line react-hooks/exhaustive-deps

  const serviceCategory = getServiceCategory(localServices);

  const mergedProtocolHistory = ctx.protocolHistory;
  const mergedProcedureHistory = ctx.procedureHistory;
  const relatedCompletedFiles = ctx.relatedFiles;
  const initialFiles = ctx.currentFiles;
  const [localFiles, setLocalFiles] = useState<FileItem[]>(initialFiles);
  const lastFocusSaveMeta = useRef<{ field: string; at: number } | null>(null);

  useEffect(() => {
    const nextProfile = getMockProfile(patient);
    const nextCompletedPast = (patient.completed || patient.status === "ready")
      && (!patient.date || patient.date <= getTodayIsoKyiv());
    const nextNoShowPast = !!patient.noShow
      && (!patient.date || patient.date <= getTodayIsoKyiv());
    const nextShouldClear = nextCompletedPast || nextNoShowPast;
    const nextNotes = nextShouldClear ? "" : (patient.notes ?? patient.primaryNotes ?? "");
    // Completed/no-show past visits: keep active protocol field empty (or preserve if doctor already
    // typed/copied into it). Never auto-fill from DB. Sync only when not protected by user.
    const nextProtocol = nextShouldClear ? "" : getInitialActiveProtocol(patient, activeVisitIso);
    const nextPhone = patient.phone || "";
    const nextAllergies = nextProfile.allergies; // CRITICAL: allergies belong to patient, never cleared
    const nextDiagnosis = nextShouldClear ? "" : nextProfile.diagnosis;
    const nextServices = nextShouldClear
      ? []
      : (patient.procedure ? patient.procedure.split(", ") : []);
    const nextInitialFiles = patient.files || [];

    const savedMeta = lastFocusSaveMeta.current;
    // 2s window — just enough for the async PATCH to complete and the realtime echo to arrive.
    // A longer window blocks cross-device sync: if mobile deletes a field, desktop keeps stale
    // data for the full duration. 2s covers save latency (<1s) plus a small safety margin.
    const protectedField = savedMeta && Date.now() - savedMeta.at < 2000 ? savedMeta.field : null;

    setLocalFullName(correctNameSpelling(`${patient.name}${patient.patronymic ? ` ${patient.patronymic}` : ""}`));
    setFields((prev) => ({
      phone: protectedField === "phone" ? prev.phone : nextPhone,
      allergies: protectedField === "allergies" ? prev.allergies : nextAllergies,
      diagnosis: protectedField === "diagnosis" ? prev.diagnosis : nextDiagnosis,
      notes: protectedField === "notes" ? prev.notes : nextNotes,
      // Preserve existing protocol when rescheduling a planning visit to a future date.
      // getInitialActiveProtocol returns "" for future dates (visit hasn't happened yet),
      // but if the doctor already typed protocol, wiping it would be data loss.
      protocol: protectedField === "protocol" ? prev.protocol
        : (nextProtocol === "" && prev.protocol.trim() !== "" && activeVisitIso > getTodayIsoKyiv()) ? prev.protocol
        : nextProtocol,
      birthDate: protectedField === "birthDate" ? prev.birthDate : nextProfile.birthDate,
    }));
    setLocalServices(nextServices);
    setLocalFiles(nextInitialFiles);
  }, [
    patient.id,
    patient.name,
    patient.patronymic,
    patient.time,
    patient.date,
    patient.procedure,
    patient.birthDate,
    patient.phone,
    patient.allergies,
    patient.diagnosis,
    patient.lastVisit,
    patient.notes,
    patient.primaryNotes,
    patient.protocol,
    patient.files,
    patient.fromForm,
    activeVisitIso,
  ]);

  const rescheduleNoticeOriginalDate = useMemo(() => {
    const markerForActive = mergedProtocolHistory
      .filter((h) => h.value.startsWith(RESCHEDULED_MARKER))
      .filter((h) => h.value.replace(RESCHEDULED_MARKER, "") === activeVisitIso)
      .sort((a, b) => b.date.localeCompare(a.date))[0];

    if (markerForActive) return isoToDisplay(markerForActive.date);

    // Backward compatibility: infer from nearest archived record if older data has no explicit marker.
    const archivedCandidates = new Set<string>();
    for (const h of mergedProtocolHistory) {
      if (!h.value.startsWith(RESCHEDULED_MARKER) && h.date && h.date !== activeVisitIso) archivedCandidates.add(h.date);
    }
    for (const h of mergedProcedureHistory) {
      if (h.date && h.date !== activeVisitIso) archivedCandidates.add(h.date);
    }
    for (const f of localFiles) {
      const iso = displayToIso(f.date);
      if (iso && iso !== activeVisitIso) archivedCandidates.add(iso);
    }

    const nearestArchivedIso = Array.from(archivedCandidates)
      .filter((d) => d < activeVisitIso)
      .sort((a, b) => b.localeCompare(a))[0];

    if (!nearestArchivedIso) return null;

    const activeTs = new Date(activeVisitIso + "T00:00:00").getTime();
    const archivedTs = new Date(nearestArchivedIso + "T00:00:00").getTime();
    const daysDiff = Math.round((activeTs - archivedTs) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 0 || daysDiff > 31) return null;

    return isoToDisplay(nearestArchivedIso);
  }, [mergedProtocolHistory, mergedProcedureHistory, localFiles, activeVisitIso]);

  // ── Autonomous assistant readiness ──────────────────────────────────────────
  const allFieldsReady = useMemo(() => {
    const hasName = localFullName.trim().split(/\s+/).filter(Boolean).length >= 2;
    const hasPhone = isViberPhoneValid(fields.phone);
    const hasService = localServices.length > 0;
    const hasDateTime = !!(patient.date && patient.time);
    return hasName && hasPhone && hasService && hasDateTime;
  }, [localFullName, fields.phone, localServices, patient.date, patient.time]);


  const missingFields = useMemo(() => {
    const missing: string[] = [];
    if (localFullName.trim().split(/\s+/).filter(Boolean).length < 2) missing.push("ПІБ");
    if (!isViberPhoneValid(fields.phone)) missing.push("Тел");
    if (localServices.length === 0) missing.push("Послуга");
    if (!patient.date || !patient.time) missing.push("Дата/Час");
    return missing;
  }, [localFullName, fields.phone, localServices, patient.date, patient.time]);

  // Build event log from state flags
  const eventLogs: EventLog[] = useMemo(() => {
    const logs: EventLog[] = [];
    const nowTime = new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
    logs.push({
      timestamp: patient.time || "--:--",
      event: EVENT_LOG_LABELS.cardOpened(isoToDisplay(activeVisitIso)),
      status: "completed",
    });
    if (welcomeSent) logs.push({
      timestamp: nowTime,
      event: EVENT_LOG_LABELS.welcomeSent,
      status: "completed",
    });
    if (dietInstructionSent) logs.push({
      timestamp: nowTime,
      event: EVENT_LOG_LABELS.dietSent,
      status: "completed",
    });
    if (waitingForStep2Ack) logs.push({
      timestamp: nowTime,
      event: EVENT_LOG_LABELS.waitingForPatient,
      status: "pending",
    });
    if (step2AckResult === "confirmed") logs.push({
      timestamp: nowTime,
      event: EVENT_LOG_LABELS.patientConfirmed,
      status: "completed",
    });
    if (step2AckResult === "question") logs.push({
      timestamp: nowTime,
      event: EVENT_LOG_LABELS.patientHasQuestion,
      status: "warning",
    });
    if (rescheduleNoticeOriginalDate) logs.push({
      timestamp: nowTime,
      event: EVENT_LOG_LABELS.rescheduled(rescheduleNoticeOriginalDate),
      status: "warning",
    });
    if (logs.length === 1) {
      logs.push({
        timestamp: patient.time || "--:--",
        event: EVENT_LOG_LABELS.waitingForAction,
        status: "pending",
      });
    }
    return logs.reverse();
  }, [welcomeSent, dietInstructionSent, waitingForStep2Ack, step2AckResult, rescheduleNoticeOriginalDate, patient.time, activeVisitIso]);

  // Auto-send welcome message when all 4 fields are filled for the first time
  useEffect(() => {
    if (!allFieldsReady || welcomeSent) return;
    const timer = setTimeout(() => {
      const serviceName = localServices.length > 0 ? localServices.join(", ") : (patient.procedure || "");
      const messageText = buildGreetingMessage(patient, activeVisitIso, patient.time, serviceName);
      const _ts = new Date();
      const _dd = String(_ts.getDate()).padStart(2, "0");
      const _mm = String(_ts.getMonth() + 1).padStart(2, "0");
      const _hhmm = _ts.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
      const messageTime = `${_dd}.${_mm} | ${_hhmm}`;
      setEmulatedMessages((prev) => [...prev, {
        sender: "ai",
        text: messageText,
        time: messageTime,
        quickReply: { yes: getReadyButtonText(patient), no: "Є запитання", context: "start_prep" },
      }]);
      setWaitingForDietAck(false);
      setDietInstructionSent(false);
      setWaitingForStep2Ack(false);
      setStep2AckResult("none");
      markWelcomeSent(patient.id, activeVisitIso, messageTime, messageText);
      setWelcomeSent(true);
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFieldsReady, welcomeSent]);

  const handleQuickReply = (answer: "yes" | "no", context: "greeting" | "diet" | "start_prep" | "drug_choice" | "question_resolved" = "start_prep") => {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const hhmm = now.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
    const replyTime = `${dd}.${mm} | ${hhmm}`;

    const replyTextMap: Record<string, string> = {
      "start_prep_yes": getReadyButtonText(patient),
      "start_prep_no":  "Є запитання",
      "drug_choice_yes": PATIENT_QUICK_REPLIES.fortrans,
      "drug_choice_no":  PATIENT_QUICK_REPLIES.izyklin,
      "diet_yes": PATIENT_QUICK_REPLIES.dietYes,
      "diet_no":  PATIENT_QUICK_REPLIES.dietNo,
      "greeting_yes": PATIENT_QUICK_REPLIES.greetingYes,
      "greeting_no":  PATIENT_QUICK_REPLIES.greetingNo,
      "question_resolved_yes": PATIENT_QUICK_REPLIES.questionResolved,
    };
    const replyText = replyTextMap[`${context}_${answer}`] ?? answer;

    // Знімаємо кнопки з попереднього повідомлення, додаємо відповідь пацієнта
    setEmulatedMessages((prev) =>
      prev
        .map((m) => m.quickReply ? { ...m, quickReply: undefined } : m)
        .concat({ sender: "patient", text: replyText, time: replyTime })
    );

    // ── Блок 5: "Розпочати підготовку" / "Є запитання" ───────────────────────
    if (context === "start_prep") {
      if (answer === "no") {
        const { address } = getPatientNameInfo(patient);
        setStep2AckResult("question");
        onUpdatePatient?.({ status: "risk" as PatientStatus, aiSummary: AI_SUMMARY_BY_STATUS.risk });
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        setIsTyping(true);
        typingTimerRef.current = setTimeout(() => {
          setIsTyping(false);
          setEmulatedMessages((prev) => [...prev, {
            sender: "ai" as const,
            text: AGENT_CHAT_MESSAGES.hasQuestionResponse({ address }),
            time: replyTime,
            quickReply: { yes: PATIENT_QUICK_REPLIES.questionResolved, context: "question_resolved" },
          }]);
        }, 2000);
        return;
      }
      // answer === "yes" → починаємо підготовку
      onUpdatePatient?.({ status: "yellow" as PatientStatus, aiSummary: AI_SUMMARY_BY_STATUS.yellow });
      const drugText = buildDrugSelectionMessage(patient);
      setEmulatedMessages((prev) => [...prev, {
        sender: "ai",
        text: drugText,
        time: replyTime,
        quickReply: {
          yes: PATIENT_QUICK_REPLIES.fortrans,
          no:  PATIENT_QUICK_REPLIES.izyklin,
          context: "drug_choice",
        },
      }]);
      return;
    }

    // ── Блок 5.1 + Блок 6: Вибір препарату → Дорожня карта ──────────────────
    if (context === "drug_choice") {
      const choice: 'fortrans' | 'izyklin' = answer === "yes" ? "fortrans" : "izyklin";
      const drugName = answer === "yes" ? "Фортранс" : "Ізіклін";
      setDrugChoice(choice);
      onUpdatePatient?.({ drugChoice: choice });

      const group = classifyProcedureGroup(patient.procedure || "");
      const roadmapText = group === 'G'
        ? ROADMAP_MESSAGES.groupG()
        : ROADMAP_MESSAGES.groupK({ drugChoice: choice });

      setEmulatedMessages((prev) => [
        ...prev,
        { sender: "ai", text: AGENT_CHAT_MESSAGES.drugChoiceConfirm({ drugName }), time: replyTime },
        { sender: "ai", text: roadmapText, time: replyTime },
      ]);
      setDietInstructionSent(true);
      return;
    }

    // ── Блок 5 ТЗ: "Питання вирішено. Розпочати!" → скидаємо risk, повертаємо yellow ──
    if (context === "question_resolved") {
      setStep2AckResult("none");
      onUpdatePatient?.({ status: "yellow" as PatientStatus, aiSummary: AI_SUMMARY_BY_STATUS.yellow });
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      setIsTyping(true);
      typingTimerRef.current = setTimeout(() => {
        setIsTyping(false);
        setEmulatedMessages((prev) => [...prev, {
          sender: "ai" as const,
          text: AGENT_CHAT_MESSAGES.questionResolvedConfirm,
          time: replyTime,
        }]);
      }, 800);
      return;
    }

    // ── Залишкова логіка для diet (backward compat) ───────────────────────────
    if (context === "diet" && answer === "no") {
      setEmulatedMessages((prev) => [...prev, {
        sender: "ai",
        text: AGENT_CHAT_MESSAGES.forwardedToDoctor,
        time: replyTime,
      }]);
      setStep2AckResult("question");
      setWaitingForStep2Ack(false);
    }
    if (context === "diet" && answer === "yes") {
      setStep2AckResult("confirmed");
      setWaitingForStep2Ack(false);
    }
    setWaitingForDietAck(false);
  };

  const handleHasQuestion = () => {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const hhmm = now.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
    const time = `${dd}.${mm} | ${hhmm}`;
    const { address } = getPatientNameInfo(patient);
    setEmulatedMessages((prev) => [
      ...prev.map((m) => (m.quickReply ? { ...m, quickReply: undefined } : m)),
      { sender: "patient" as const, text: PATIENT_QUICK_REPLIES.dietNo, time },
    ]);
    setStep2AckResult("question");
    onUpdatePatient?.({ status: "risk" as PatientStatus, aiSummary: AI_SUMMARY_BY_STATUS.risk });
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    setIsTyping(true);
    typingTimerRef.current = setTimeout(() => {
      setIsTyping(false);
      setEmulatedMessages((prev) => [...prev, {
        sender: "ai" as const,
        text: AGENT_CHAT_MESSAGES.hasQuestionResponse({ address }),
        time,
        quickReply: { yes: PATIENT_QUICK_REPLIES.questionResolved, context: "question_resolved" },
      }]);
    }, 2000);
  };

  // Derive lastVisit from the latest valid archived date: completed visit from schedule
  // or archived protocol/procedure date (excluding no-show/incomplete visits when known).
  const derivedLastVisitInfo = (() => {
    const currentDate = patient.date || "9999-99-99";
    const latestCompletedIso = lastCompletedVisitFromAll?.date;
    // Only count as "closed" if the visit date is today or in the past — future visits with stale
    // completed=true in DB must not pollute lastVisit or archive logic.
    const closedCurrentVisitIso = patient.date
      && patient.date <= getTodayIsoKyiv()
      && (patient.completed || patient.status === "ready" || (patient.status as string) === "completed" || patient.noShow)
      ? patient.date
      : undefined;
    const closedCurrentVisitOutcome: "completed" | "no-show" | undefined = patient.noShow
      ? "no-show"
      : ((patient.completed || patient.status === "ready" || (patient.status as string) === "completed") ? "completed" : undefined);

    const visitByIso = new Map<string, Patient>();
    for (const visit of relatedVisits) {
      if (!visit.date) continue;
      const existing = visitByIso.get(visit.date);
      if (!existing) {
        visitByIso.set(visit.date, visit);
        continue;
      }

      const existingRank = (existing.noShow ? 0 : 1) + ((existing.completed || existing.status === "ready" || (existing.status as string) === "completed") ? 2 : 0);
      const currentRank = (visit.noShow ? 0 : 1) + ((visit.completed || visit.status === "ready" || (visit.status as string) === "completed") ? 2 : 0);
      if (currentRank >= existingRank) visitByIso.set(visit.date, visit);
    }

    const archivedDateCandidates = new Set<string>();
    for (const h of mergedProtocolHistory) {
      if (!h.date || h.value.startsWith(RESCHEDULED_MARKER)) continue;
      if (h.date >= currentDate) continue;
      const linkedVisit = visitByIso.get(h.date);
      if (linkedVisit) {
        if (linkedVisit.noShow) continue;
        if (!linkedVisit.completed && linkedVisit.status !== "ready" && (linkedVisit.status as string) !== "completed") continue;
      }
      archivedDateCandidates.add(h.date);
    }
    for (const h of mergedProcedureHistory) {
      if (!h.date || h.date >= currentDate) continue;
      const linkedVisit = visitByIso.get(h.date);
      if (linkedVisit) {
        if (linkedVisit.noShow) continue;
        if (!linkedVisit.completed && linkedVisit.status !== "ready" && (linkedVisit.status as string) !== "completed") continue;
      }
      archivedDateCandidates.add(h.date);
    }

    const latestArchivedIso = Array.from(archivedDateCandidates).sort().reverse()[0];
    const bestIso = [closedCurrentVisitIso, latestCompletedIso, latestArchivedIso]
      .filter((d): d is string => !!d)
      .sort()
      .reverse()[0];

    const bestDisplay = bestIso ? isoToDisplay(bestIso) : "";
    const outcomeFromBestIso: "completed" | "no-show" | undefined =
      bestIso
        ? (bestIso === closedCurrentVisitIso
            ? closedCurrentVisitOutcome
            : (visitByIso.get(bestIso)?.noShow
                ? "no-show"
                : ((visitByIso.get(bestIso)?.completed || visitByIso.get(bestIso)?.status === "ready" || (visitByIso.get(bestIso)?.status as string) === "completed")
                  ? "completed"
                  : undefined)))
        : undefined;

    return { lastVisit: bestDisplay, outcome: outcomeFromBestIso };
  })();
  const mergedProfile = { ...profile, ...fields, lastVisit: derivedLastVisitInfo.lastVisit || profile.lastVisit };
  const isLastVisitNoShow = derivedLastVisitInfo.outcome === "no-show";
  // A visit that has been completed counts as a past visit — so the patient is always "repeat" after first visit
  const isRepeatPatient = !patient.fromForm || hasPastVisitFromAll || mergedProcedureHistory.length > 0 || mergedProtocolHistory.length > 0 || !!(patient.completed || patient.status === "ready");

  const hasUnsavedChanges = 
    fields.notes !== initialNotes || 
    fields.protocol !== initialProtocol || 
    fields.phone !== initialPhone ||
    fields.allergies !== profile.allergies ||
    fields.diagnosis !== initialDiagnosis ||
    fields.birthDate !== profile.birthDate ||
    localServices.join(", ") !== (patient.procedure || "") ||
    JSON.stringify(localFiles) !== JSON.stringify(initialFiles);

  const addHistoryEntry = (
    history: Array<{ value: string; timestamp: string; date: string }> | undefined,
    newValue: string,
    entryDateIso?: string
  ) => {
    const todayIso = entryDateIso || getTodayIsoKyiv();
    const displayDate = isoToDisplay(todayIso);
    const trimmed = newValue.trim();

    const current = history ? [...history] : [];
    const lastEntry = current[current.length - 1];

    // If value was cleared, drop today's entry so stale text does not linger.
    if (!trimmed) {
      if (lastEntry?.date === todayIso) return current.slice(0, -1);
      return current;
    }

    // Same calendar day → replace last entry instead of appending
    if (lastEntry?.date === todayIso) {
      return [...current.slice(0, -1), { value: trimmed, timestamp: displayDate, date: todayIso }];
    }

    return [...current, { value: trimmed, timestamp: displayDate, date: todayIso }];
  };

  const handleFocusOpen = (field: string, value?: string | null, history?: HistoryEntry[]) => {
    setFocusField({ field, value: value ?? "", history });
  };

  // Відкриває картку конкретного архівного візиту по відображуваній даті
  const handleOpenVisitByDate = (displayDate: string) => {
    const iso = displayToIso(displayDate);
    const target = relatedVisits.find((v) => v.date === iso);
    if (target) onOpenVisit?.(target.id);
  };

  const handleAllergyChange = (value: string) => {
    setFields((prev) => ({ ...prev, allergies: value }));
    onUpdatePatient?.({ allergies: value });
  };

  const handleNameBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();
    if (!raw) { setEditingName(false); return; }
    const corrected = correctNameSpelling(raw);
    setLocalFullName(corrected);
    setEditingName(false);
    const parts = corrected.trim().split(/\s+/);
    const newName = parts.slice(0, 2).join(" ");
    const newPatronymic = parts.slice(2).join(" ");
    const currentName = patient.name || "";
    const currentPatronymic = patient.patronymic || "";
    if (newName !== currentName || newPatronymic !== currentPatronymic) {
      if (onUpdatePatient) onUpdatePatient({ name: newName, patronymic: newPatronymic || undefined });
    }
  };

  const handleFocusSave = (value: string) => {
    if (focusField) {
      lastFocusSaveMeta.current = { field: focusField.field, at: Date.now() };
      skipNextAutoSave.current = true;
      const trimmedValue = value.trim();
      const preparedValue = focusField.field === "phone" ? getStorablePhone(trimmedValue) : trimmedValue;
      const fieldName = focusField.field;
      setFields((prev) => {
        if (focusField.field === "allergies" || focusField.field === "diagnosis") {
          // сохраняем как последний вариант, не накапливаем старые значения
          return { ...prev, [focusField.field]: preparedValue };
        }

        if (focusField.field === "notes") {
          // Нужен только последний вариант заметки — предыдущие записи удаляются
          return { ...prev, notes: preparedValue };
        }

        return { ...prev, [focusField.field]: preparedValue };
      });

      if (onUpdatePatient) {
        if (fieldName === "phone") {
          onUpdatePatient({ phone: preparedValue });
        } else if (fieldName === "birthDate") {
          onUpdatePatient({ birthDate: preparedValue });
        } else if (fieldName === "allergies") {
          onUpdatePatient({ allergies: preparedValue });
        } else if (fieldName === "diagnosis") {
          onUpdatePatient({ diagnosis: preparedValue });
        } else if (fieldName === "notes") {
          onUpdatePatient({ notes: preparedValue });
        } else if (fieldName === "protocol") {
          onUpdatePatient({ protocol: preparedValue });
        }
      }
    }
    setFocusField(null);
  };

  const handleFocusCancel = () => {
    setFocusField(null);
  };

  const handleServicesChange = (services: string[]) => {
    setLocalServices(services);
    onUpdatePatient?.({ procedure: services.join(", ") });
  };

  const handleFilesChange = (newFiles: FileItem[]) => {
    setLocalFiles(newFiles);
    onUpdatePatient?.({ files: newFiles });
  };

  const handleCloseRequest = () => {
    setFocusField(null);
    setShowReschedulePicker(false);
    setHistoryModalOpen(false);
    try {
      handleSaveChanges(true);
    } catch (e) {
      console.error("Save on close failed:", e);
    }
    onClose();
  };

  const handleDeleteVisit = () => {
    if (!onDelete) return;
    setDeletePhase("confirm");
  };

  const handleConfirmDelete = () => {
    setDeletePhase("countdown");
    let remaining = 30;
    setDeleteCountdown(remaining);
    deleteTimerRef.current = setInterval(() => {
      remaining--;
      setDeleteCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(deleteTimerRef.current!);
        deleteTimerRef.current = null;
        onDelete!(patient.id);
      }
    }, 1000);
  };

  const handleRestoreFromDelete = () => {
    if (deleteTimerRef.current) {
      clearInterval(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    setDeletePhase("idle");
    setDeleteCountdown(30);
  };

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) {
        clearInterval(deleteTimerRef.current);
        deleteTimerRef.current = null;
      }
    };
  }, []);

  const handleApplyReschedule = async (newDate: string, newTime: string) => {
    if (!onUpdatePatient && !onCreateNewVisit) return;

    const d = new Date(newDate + "T00:00:00");
    const formatted = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;

    // — Completed/ready visit: create a FRESH visit record so the archive stays intact.
    const isCompletedVisit = patient.completed || patient.status === "ready";
    if (isCompletedVisit && onCreateNewVisit) {
      if (fields.protocol.trim() && onUpdatePatient) {
        onUpdatePatient({ protocol: fields.protocol.trim() });
      }
      setShowReschedulePicker(false);
      await onCreateNewVisit({ date: newDate, time: newTime });
      setFields((prev) => ({ ...prev, protocol: "" }));
      toast.success(`Прийом перенесено: ${formatted} · ${newTime}`);
      return;
    }

    // — Planning visit: move the appointment date on the same record.
    // Per .cursorrules Rule 1: reschedule is NOT completion.
    if (!onUpdatePatient) return;
    skipNextAutoSave.current = true;
    onUpdatePatient({ date: newDate, time: newTime });
    setShowReschedulePicker(false);
    toast.success(`Прийом перенесено: ${formatted} · ${newTime}`);
  };

  const autoSaveMounted = useRef(false);
  const skipNextAutoSave = useRef(false);
  useEffect(() => {
    if (!autoSaveMounted.current) {
      autoSaveMounted.current = true;
      return;
    }
    if (!onUpdatePatient) return;
    if (skipNextAutoSave.current) {
      skipNextAutoSave.current = false;
      return;
    }
    const timer = setTimeout(() => handleSaveChanges(true), 1200);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, localFiles, localServices]);

  const handleSaveChanges = (silent = false) => {
    if (!hasUnsavedChanges && !silent) return;
    if (!hasUnsavedChanges && silent) return;

    if (onUpdatePatient) {
      const hasTodayHistoryEntry = (history?: Array<{ value: string; timestamp: string; date: string }>) => {
        if (!history || history.length === 0) return false;
        return history[history.length - 1]?.date === getTodayIsoKyiv();
      };

      const currentAllergyState = parseAllergyState(fields.allergies);
      const currentAllergyHistoryValue = currentAllergyState.status === "allergen"
        ? currentAllergyState.allergen
        : allergyStatusLabel(currentAllergyState.status);

      const patientAllergyState = parseAllergyState(patient.allergies || "");
      const patientAllergyHistoryValue = patientAllergyState.status === "allergen"
        ? patientAllergyState.allergen
        : allergyStatusLabel(patientAllergyState.status);

      const allergiesHistory = (fields.allergies !== (patient.allergies || "")) || (currentAllergyHistoryValue !== patientAllergyHistoryValue)
        ? addHistoryEntry(patient.allergiesHistory, currentAllergyHistoryValue)
        : patient.allergiesHistory;
      const diagnosisHistory = (fields.diagnosis !== (patient.diagnosis || "")) || (!fields.diagnosis.trim() && hasTodayHistoryEntry(patient.diagnosisHistory))
        ? addHistoryEntry(patient.diagnosisHistory, fields.diagnosis)
        : patient.diagnosisHistory;
      const notesHistory = (fields.notes !== (patient.notes || "")) || (!fields.notes.trim() && hasTodayHistoryEntry(patient.notesHistory))
        ? addHistoryEntry(patient.notesHistory, fields.notes)
        : patient.notesHistory;
      const phoneHistory = fields.phone.trim() && fields.phone !== (patient.phone || "")
        ? addHistoryEntry(patient.phoneHistory, fields.phone)
        : patient.phoneHistory;
      const birthDateHistory = fields.birthDate.trim() && fields.birthDate !== (patient.birthDate || "")
        ? addHistoryEntry(patient.birthDateHistory, fields.birthDate)
        : patient.birthDateHistory;
      const protocolHistory = fields.protocol.trim() && fields.protocol !== (patient.protocol || "")
        ? addHistoryEntry(patient.protocolHistory, fields.protocol, activeVisitIso)
        : patient.protocolHistory;
      const procedureValue = localServices.join(", ");
      const procedureHistory = procedureValue.trim() && procedureValue !== (patient.procedure || "")
        ? addHistoryEntry(patient.procedureHistory, procedureValue, activeVisitIso)
        : patient.procedureHistory;

      const updates: Partial<Patient> = {};
      const stringified = (v: unknown) => JSON.stringify(v ?? null);

      if (fields.notes !== (patient.notes || "")) updates.notes = fields.notes;
      // For completed past visits: only save protocol if doctor explicitly typed/copied something
      // (fields.protocol is non-empty). Never write "" over a saved archived conclusion.
      const isCompletedPast = (patient.completed || patient.status === "ready")
        && (!patient.date || patient.date <= getTodayIsoKyiv());
      const protocolChanged = fields.protocol !== (patient.protocol || "");
      if (isCompletedPast ? (fields.protocol.trim() && protocolChanged) : protocolChanged) {
        updates.protocol = fields.protocol;
      }
      if (getStorablePhone(fields.phone) !== (patient.phone || "")) updates.phone = getStorablePhone(fields.phone);
      if (fields.allergies !== (patient.allergies || "")) updates.allergies = fields.allergies;
      if (fields.diagnosis !== (patient.diagnosis || "")) {
        // For planning visits diagnosis starts empty for UX but we must NOT write "" to DB
        // unless it was explicitly cleared (shouldClearVisitFields) or doctor typed something.
        if (shouldClearVisitFields || fields.diagnosis.trim() !== "") {
          updates.diagnosis = fields.diagnosis;
        }
      }
      if (fields.birthDate !== (patient.birthDate || "")) updates.birthDate = fields.birthDate;
      if (procedureValue !== (patient.procedure || "")) updates.procedure = procedureValue;
      if (stringified(localFiles) !== stringified(patient.files || [])) updates.files = localFiles;

      if (stringified(allergiesHistory) !== stringified(patient.allergiesHistory)) updates.allergiesHistory = allergiesHistory;
      if (stringified(diagnosisHistory) !== stringified(patient.diagnosisHistory)) updates.diagnosisHistory = diagnosisHistory;
      if (stringified(notesHistory) !== stringified(patient.notesHistory)) updates.notesHistory = notesHistory;
      if (stringified(phoneHistory) !== stringified(patient.phoneHistory)) updates.phoneHistory = phoneHistory;
      if (stringified(birthDateHistory) !== stringified(patient.birthDateHistory)) updates.birthDateHistory = birthDateHistory;
      if (stringified(protocolHistory) !== stringified(patient.protocolHistory)) updates.protocolHistory = protocolHistory;
      if (stringified(procedureHistory) !== stringified(patient.procedureHistory)) updates.procedureHistory = procedureHistory;

      if (Object.keys(updates).length > 0) {
        onUpdatePatient(updates as Record<string, unknown>);
        if (!silent) toast.success("Дані пацієнта успішно збережено");
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-fade-in" onClick={handleCloseRequest} />


      <div className={cn(
        "relative z-10 w-full h-[92dvh] sm:h-auto bg-[hsl(210,40%,96%)] rounded-t-2xl sm:rounded-2xl shadow-2xl animate-slide-up safe-bottom max-h-[92dvh] overflow-hidden flex flex-col min-h-0",
        "sm:max-w-[95vw]"
      )}>
        {/* Handle (mobile) */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/25" />
        </div>

        {/* Sticky Header */}
        <div className="flex items-start justify-between px-5 sm:px-6 pb-3 pt-2 sm:pt-5 border-b border-border/60 bg-card rounded-t-2xl shrink-0 relative z-10">
          <div className="min-w-0 flex-1">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <span className={cn("w-3 h-3 rounded-full shrink-0", patient.completed ? "bg-slate-400" : statusDot[effectiveStatus])} />
                {editingName ? (
                  <input
                    ref={nameInputRef}
                    autoFocus
                    type="text"
                    defaultValue={localFullName}
                    onFocus={(e) => focusAtEnd(e.currentTarget)}
                    onBlur={handleNameBlur}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setEditingName(false); } }}
                    className="text-base sm:text-lg font-bold text-foreground leading-tight bg-transparent border-b border-primary outline-none w-full min-w-0"
                  />
                ) : (
                  <h2
                    className="text-base sm:text-lg font-bold text-foreground leading-tight truncate flex items-center gap-1.5 cursor-pointer group"
                    onClick={() => setEditingName(true)}
                    title="Натисніть для редагування"
                  >
                    {localFullName}
                    <Pencil size={13} className="shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
                  </h2>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                  {isRepeatPatient ? "Повторний" : "Новий"}
                </span>
                {!(patient.completed || patient.status === "ready") && localServices.length > 0 && (
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: serviceCategory.bgColor, color: serviceCategory.color }}
                  >
                    {serviceCategory.label}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs flex-wrap mt-2 sm:mt-2.5">
              <span className="text-muted-foreground font-normal">Дата:</span>
              <span className="font-bold text-foreground">
                {(currentVisitOutcome
                  ? "__.__.____"
                  : patient.date
                  ? (() => { const d = new Date(patient.date + "T00:00:00"); return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`; })()
                  : "—")}
              </span>
              <button
                onClick={() => setShowReschedulePicker(true)}
                title="Призначити наступний прийом"
                className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-accent transition-all"
              >
                <Pencil size={11} className="text-muted-foreground" />
              </button>
              <span className="text-muted-foreground">|</span>
              <span className="text-muted-foreground font-normal">Час:</span>
              <span className="font-bold text-foreground">{currentVisitOutcome ? "__:__" : (patient.time || "—")}</span>
              {!currentVisitOutcome && getPrimaryService(localServices) && (
                <>
                  <span className="text-muted-foreground">|</span>
                  <span className="font-bold text-foreground">{getPrimaryService(localServices)}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onDelete && (
              <button
                onClick={handleDeleteVisit}
                title="Видалити запис"
                className="w-9 h-9 flex items-center justify-center rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors active:scale-[0.93] shrink-0"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={handleCloseRequest}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-muted/60 text-muted-foreground hover:bg-muted transition-colors active:scale-[0.93] shrink-0"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Mobile: tabs | Desktop: side-by-side */}
        {isMobile ? (
          <>
            <div className="flex gap-1 p-1.5 mx-4 mt-2 rounded-xl bg-[hsl(199,89%,86%)] border border-sky-300/60">
              {([
                { key: "card" as const, label: "Карта", icon: <User size={14} /> },
                { key: "files" as const, label: "Обстеження", icon: <FileText size={14} /> },
                { key: "assistant" as const, label: "Асистент", icon: <MessageCircle size={14} />, badge: unanswered.length },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "flex-1 py-2 text-xs font-medium transition-all active:scale-[0.97] rounded-lg relative flex items-center justify-center gap-1",
                    activeTab === tab.key
                      ? "bg-white text-foreground font-bold shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
                      : "text-sky-800"
                  )}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.badge != null && tab.badge > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-status-risk animate-pulse" />
                  )}
                </button>
              ))}
            </div>

            <div ref={mobileTabScrollRef} className="flex-1 min-h-0 overflow-y-auto">
              {activeTab === "card" ? (
                <div className="p-4 space-y-3 min-h-full">
                  <ContentBlock title="Профіль пацієнта" icon={<User size={13} />}>
                    <PatientProfile
                      profile={mergedProfile}
                      lastVisitIsNoShow={isLastVisitNoShow}
                      onFocusEdit={handleFocusOpen}
                      onAllergyChange={handleAllergyChange}
                      onBirthDateChange={(value) => {
                        setFields((prev) => ({ ...prev, birthDate: value }));
                        onUpdatePatient?.({ birthDate: value });
                      }}
                      onPhoneChange={(value) => {
                        setFields((prev) => ({ ...prev, phone: value }));
                        onUpdatePatient?.({ phone: value });
                      }}
                      histories={{
                        phoneHistory: patient.phoneHistory,
                        birthDateHistory: patient.birthDateHistory,
                        allergiesHistory: patient.allergiesHistory,
                        diagnosisHistory: patient.diagnosisHistory,
                        notesHistory: patient.notesHistory,
                      }}
                    />
                  </ContentBlock>
                  <ContentBlock title={localServices.length > 0 ? "Змінити послуги" : "Послуги"}>
                    <PatientServices services={localServices} onServicesChange={handleServicesChange} showFloatingEdit={!focusField} />
                  </ContentBlock>
                </div>
              ) : activeTab === "files" ? (
                <div className="p-4 space-y-3 min-h-full">
                  <ContentBlock title="Обстеження та Файли" icon={<FileText size={13} />}>
                    <PatientFiles
                      files={localFiles}
                      onFilesChange={handleFilesChange}
                      onFocusEdit={handleFocusOpen}
                      fromForm={patient.fromForm}
                      protocolText={fields.protocol}
                      archivedProtocolText={patient.protocol || ""}
                      protocolHistory={mergedProtocolHistory}
                      procedureHistory={mergedProcedureHistory}
                      historicalVisitDates={completedPastVisitDates}
                      visitOutcomeByDate={archivedVisitOutcomeByDate}
                      currentVisitOutcome={currentVisitOutcome}
                      activeVisitDate={patient.date ? activeVisitDisplayDate : ""}
                      onProtocolPrefill={(value) => {
                        lastFocusSaveMeta.current = { field: "protocol", at: Date.now() };
                        setFields((prev) => ({ ...prev, protocol: value }));
                        onUpdatePatient?.({ protocol: value });
                      }}
                      visitId={patient.id}
                      relatedFiles={relatedCompletedFiles}
                      onDateClick={onOpenVisit ? handleOpenVisitByDate : undefined}
                    />
                  </ContentBlock>
                </div>
              ) : activeTab === "assistant" ? (
                <div className="p-4 min-h-full flex flex-col gap-3">
                  <ContentBlock title="Журнал подій" icon={<Activity size={13} />}
                    headerRight={
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setHistoryModalOpen(true)}
                          className="w-8 h-8 flex items-center justify-center rounded hover:bg-muted transition-colors"
                          title="Журнал подій"
                        >
                          <FileText size={14} className="text-muted-foreground" />
                        </button>
                      </div>
                    }
                  >
                    <LinearProgressBar
                      preparation={preparation}
                      status={effectiveStatus}
                      waitingForDietAck={waitingForDietAck}
                      dietInstructionSent={dietInstructionSent}
                      waitingForStep2Ack={waitingForStep2Ack}
                      step2AckResult={step2AckResult}
                    />
                    <div className="px-4 pb-3 space-y-1.5">
                      {eventLogs.slice(0, 3).map((log, i) => (
                        <div key={`mobile-log-${i}`} className="text-[11px] text-muted-foreground leading-snug truncate">
                          <span className="font-semibold text-foreground/80">{log.timestamp}</span>
                          <span className="mx-1">·</span>
                          <span>{log.event}</span>
                        </div>
                      ))}
                    </div>
                  </ContentBlock>
                  <div className="flex-1 min-h-0 bg-card rounded-xl overflow-hidden shadow-[0_6px_16px_rgba(0,0,0,0.08)] flex flex-col">
                    <ChatPane chat={chat} unanswered={unanswered} onQuickReply={handleQuickReply} onHasQuestion={welcomeSent && step2AckResult !== "question" ? handleHasQuestion : undefined} isTyping={isTyping} />
                    <ChatInput />
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Left column: 40% */}
            <div className="w-[40%] min-h-0 overflow-y-auto shrink-0 p-4 space-y-3">
              <ContentBlock title="Профіль пацієнта" icon={<User size={13} />}>
                <PatientProfile
                  profile={mergedProfile}
                  lastVisitIsNoShow={isLastVisitNoShow}
                  onFocusEdit={handleFocusOpen}
                  onAllergyChange={handleAllergyChange}
                  onBirthDateChange={(value) => {
                    setFields((prev) => ({ ...prev, birthDate: value }));
                    onUpdatePatient?.({ birthDate: value });
                  }}
                  onPhoneChange={(value) => {
                    setFields((prev) => ({ ...prev, phone: value }));
                    onUpdatePatient?.({ phone: value });
                  }}
                  histories={{
                    phoneHistory: patient.phoneHistory,
                    birthDateHistory: patient.birthDateHistory,
                    allergiesHistory: patient.allergiesHistory,
                    diagnosisHistory: patient.diagnosisHistory,
                    notesHistory: patient.notesHistory,
                  }}
                />
              </ContentBlock>
              <ContentBlock title={localServices.length > 0 ? "Змінити послуги" : "Послуги"}>
                <PatientServices services={localServices} onServicesChange={handleServicesChange} showFloatingEdit={!focusField} />
              </ContentBlock>
              <ContentBlock title="Обстеження та Файли" icon={<FileText size={13} />}>
                <PatientFiles
                  files={localFiles}
                  onFilesChange={handleFilesChange}
                  onFocusEdit={handleFocusOpen}
                  fromForm={patient.fromForm}
                  protocolText={fields.protocol}
                  archivedProtocolText={patient.protocol || ""}
                  protocolHistory={mergedProtocolHistory}
                  procedureHistory={mergedProcedureHistory}
                  historicalVisitDates={completedPastVisitDates}
                  visitOutcomeByDate={archivedVisitOutcomeByDate}
                  currentVisitOutcome={currentVisitOutcome}
                  activeVisitDate={patient.date ? activeVisitDisplayDate : ""}
                  onProtocolPrefill={(value) => {
                    lastFocusSaveMeta.current = { field: "protocol", at: Date.now() };
                    setFields((prev) => ({ ...prev, protocol: value }));
                    onUpdatePatient?.({ protocol: value });
                  }}
                  visitId={patient.id}
                  relatedFiles={relatedCompletedFiles}
                  onDateClick={onOpenVisit ? handleOpenVisitByDate : undefined}
                />
              </ContentBlock>
            </div>

            {/* Right column: 60% */}
            <div className="w-[60%] min-h-0 flex flex-col overflow-hidden p-4 pl-0">
              <ContentBlock title="Асистент" icon={<MessageCircle size={13} />} className="flex-1 flex flex-col overflow-hidden"
                headerRight={
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setHistoryModalOpen(true)}
                      className="px-2 py-1 flex items-center gap-1 rounded hover:bg-muted transition-colors text-xs font-medium text-muted-foreground"
                      title="Журнал подій"
                    >
                      📜 Журнал подій
                    </button>
                    {unanswered.length > 0 && (
                      <span className="flex items-center gap-1 text-xs font-bold text-status-risk bg-status-risk-bg px-2.5 py-0.5 rounded-full">
                        <AlertTriangle size={12} />
                        {unanswered.length} без відповіді
                      </span>
                    )}
                    {mergedProfile.phone && (
                      <a
                        href={`tel:${mergedProfile.phone}`}
                        className="w-7 h-7 rounded-full bg-status-ready flex items-center justify-center shadow-sm hover:bg-status-ready/90 active:scale-[0.93] transition-all shrink-0"
                        title={mergedProfile.phone}
                      >
                        <Phone size={13} strokeWidth={2.5} className="text-white" />
                      </a>
                    )}
                  </div>
                }
              >
                <LinearProgressBar
                  preparation={preparation}
                  status={effectiveStatus}
                  waitingForDietAck={waitingForDietAck}
                  dietInstructionSent={dietInstructionSent}
                  waitingForStep2Ack={waitingForStep2Ack}
                  step2AckResult={step2AckResult}
                />
                <ChatPane chat={chat} unanswered={unanswered} onQuickReply={handleQuickReply} onHasQuestion={welcomeSent && step2AckResult !== "question" ? handleHasQuestion : undefined} isTyping={isTyping} />
                <ChatInput />
              </ContentBlock>
            </div>
          </div>
        )}

        {/* ── Sticky Save Footer ── */}
        {/* ── Focus Mode Overlay ── */}
        {focusField && (
          <FocusOverlay
            field={focusField.field}
            value={focusField.value}
            history={focusField.history}
            patientName={patient.name}
            patientDate={patient.date ? isoToDisplay(patient.date) : undefined}
            patientTime={patient.time}
            patientProcedure={patient.procedure}
            allergies={currentAllergy.status === "allergen" ? currentAllergy.allergen : ""}
            onSave={handleFocusSave}
            onCancel={handleFocusCancel}
          />
        )}

        {deletePhase !== "idle" && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-foreground/30 backdrop-blur-sm animate-fade-in">
            <div className="bg-surface-raised rounded-xl shadow-elevated p-5 mx-4 max-w-sm w-full animate-slide-up">
              <div className="flex items-center gap-2 mb-2">
                <Trash2 size={16} className="text-destructive shrink-0" />
                <h3 className="text-sm font-bold text-destructive">Видалення запису пацієнта</h3>
              </div>
              {deletePhase === "confirm" ? (
                <>
                  <p className="text-xs text-muted-foreground mb-4">
                    Ви впевнені, що хочете видалити цей запис? Після видалення у вас буде 30 секунд щоб відновити його.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setDeletePhase("idle")}
                      className="flex-1 py-2.5 text-sm font-bold text-muted-foreground border border-border rounded-lg hover:bg-muted/40 transition-colors active:scale-[0.97]"
                    >
                      Скасувати
                    </button>
                    <button
                      onClick={handleConfirmDelete}
                      className="flex-1 py-2.5 text-sm font-bold text-white rounded-lg transition-colors active:scale-[0.97] bg-destructive hover:bg-destructive/90"
                    >
                      Видалити
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground mb-1">Запис буде видалено назавжди через</p>
                  <div className="text-5xl font-black text-destructive text-center py-4">
                    {deleteCountdown}<span className="text-2xl"> с</span>
                  </div>
                  <button
                    onClick={handleRestoreFromDelete}
                    className="w-full py-2.5 text-sm font-bold text-white rounded-lg transition-colors active:scale-[0.97] bg-[hsl(142,71%,45%)] hover:bg-[hsl(142,71%,40%)]"
                  >
                    Відновити запис
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <ReschedulePicker
          open={showReschedulePicker}
          onClose={() => setShowReschedulePicker(false)}
          onApply={handleApplyReschedule}
          patientName={patient.name}
          initialDate={patient.date}
          initialTime={patient.time}
          allPatients={allPatients}
        />

        {/* History Modal */}
        <HistoryModal isOpen={historyModalOpen} onClose={() => setHistoryModalOpen(false)} chat={chat} eventLogs={eventLogs} />
      </div>
    </div>
  );
}

// ── Focus Mode Overlay ──
function FocusOverlay({ field, value, history, patientName, patientDate, patientTime, patientProcedure, allergies, onSave, onCancel }: {
  field: string;
  value?: string | null;
  history?: HistoryEntry[];
  patientName: string;
  patientDate?: string;
  patientTime?: string;
  patientProcedure?: string;
  allergies: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const safeValue = value ?? "";
  const [text, setText] = useState(field === "phone" ? normalizePhoneWithPlus(safeValue) : safeValue);
  const baseValue = safeValue.trim();

  useEffect(() => {
    setText(field === "phone" ? normalizePhoneWithPlus(safeValue) : safeValue);
  }, [field, safeValue]);

  const isDailyField = field === "notes" || field === "allergies" || field === "diagnosis";
  const todayIso = getTodayIsoKyiv();
  const visibleHistory = (history || []).filter((entry) => {
    if (!entry.value.trim()) return false;
    if (entry.value.trim() === baseValue) return false;
    if (isDailyField && !baseValue && entry.date === todayIso) return false;
    return true;
  });

  const formatBirthDateInput = (input: string) => {
    const raw = input.replace(/[^\d]/g, "").slice(0, 8);
    if (raw.length <= 2) return raw;
    if (raw.length <= 4) return `${raw.slice(0, 2)}.${raw.slice(2)}`;
    return `${raw.slice(0, 2)}.${raw.slice(2, 4)}.${raw.slice(4)}`;
  };

  const fieldLabels: Record<string, string> = {
    protocol: "Висновок лікаря",
    phone: "Телефон",
    birthDate: "Дата народження",
    allergies: "Алергії",
    diagnosis: "Діагноз",
    notes: "Нотатки",
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center animate-fade-in bg-[hsl(204,85%,93%)]">
      {/* Card — 90% screen with breathing room around */}
      <div
        className="relative flex flex-col bg-white rounded-2xl overflow-hidden"
        style={{
          width: "90vw",
          maxWidth: "1200px",
          height: "90vh",
          boxShadow: "0 20px 60px 0 hsl(204 70% 45% / 0.25), 0 4px 16px 0 hsl(204 70% 45% / 0.12)",
        }}
      >
        {/* Header — patient context */}
        <div className="shrink-0 px-8 pt-7 pb-5 bg-[hsl(204,100%,96%)] border-b border-sky-100 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-bold text-foreground">{patientName}</span>
              {allergies && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                  <AllergyShield size={10} />
                  {allergies}
                </span>
              )}
            </div>
            {(patientDate || patientTime || patientProcedure) && (
              <p className="text-xs text-muted-foreground/70 mt-1">
                {[patientDate, patientTime, patientProcedure].filter(Boolean).join(" · ")}
              </p>
            )}
            <p className="text-xs font-semibold text-sky-700 mt-1">{fieldLabels[field] || field}</p>
          </div>
          {/* Згорнути — white circle, clear top-right */}
          <button
            onClick={onCancel}
            className="w-10 h-10 shrink-0 flex items-center justify-center rounded-full bg-white border-2 border-sky-200 shadow-md hover:bg-sky-50 hover:border-sky-300 active:scale-[0.9] transition-all"
            title="Згорнути"
          >
            <Minimize2 size={15} className="text-sky-600" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 px-8 py-6 flex flex-col gap-4 bg-white overflow-hidden">
          {field === "phone" ? (
            <CountryPhoneInput
              value={text}
              onChange={setText}
              autoFocus
              buttonClassName="py-3"
              inputClassName="py-3"
            />
          ) : field === "birthDate" ? (
            <input
              type="text"
              inputMode="numeric"
              value={text}
              onChange={(e) => setText(formatBirthDateInput(e.target.value))}
              onFocus={(e) => focusAtEnd(e.currentTarget)}
              placeholder="ДД.ММ.РРРР"
              maxLength={10}
              className="w-full text-sm leading-relaxed text-foreground bg-white border-2 border-[hsl(204,100%,80%)] rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-sky-300/50"
              autoFocus
            />
          ) : (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={(e) => focusAtEnd(e.currentTarget)}
              className="flex-1 w-full text-sm leading-[1.85] text-foreground bg-[hsl(204,100%,98%)] border border-sky-200 rounded-xl pl-7 pr-5 py-5 outline-none focus:ring-2 focus:ring-sky-400/40 focus:border-sky-400/60 resize-none overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-sky-400/50 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-sky-500/70"
              style={{ minHeight: "120px", scrollbarWidth: "thin", scrollbarColor: "hsl(204 70% 60% / 0.5) transparent" }}
              autoFocus
            />
          )}
        </div>

        {/* History */}
        {visibleHistory.length > 0 && (
          <div className="px-8 pb-4 border-t border-sky-100 pt-4 bg-white">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">Історія змін</p>
            <div className="space-y-1 max-h-28 overflow-y-auto">
              {visibleHistory.slice().reverse().map((entry, i) => (
                <div key={i} className="flex items-baseline gap-2 text-xs text-muted-foreground">
                  <span className="font-semibold shrink-0">{isoToDisplay(entry.date, entry.timestamp)}</span>
                  <span className="truncate">{entry.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="shrink-0 px-8 pt-5 pb-7 bg-[hsl(204,100%,96%)] border-t border-sky-100 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-6 py-2.5 text-sm font-bold text-muted-foreground bg-transparent border border-border rounded-lg hover:bg-muted/40 transition-colors active:scale-[0.97]"
          >
            Скасувати
          </button>
          <button
            onClick={() => onSave(text)}
            className="px-6 py-2.5 text-sm font-bold text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors active:scale-[0.97] shadow-sm"
          >
            Зберегти
          </button>
        </div>
      </div>
    </div>
  );
}

// ── White Content Block with shadow ──
function ContentBlock({ children, className, title, icon, headerRight }: {
  children: React.ReactNode;
  className?: string;
  title: string;
  icon?: React.ReactNode;
  headerRight?: React.ReactNode;
}) {
  return (
    <div className={cn("bg-card rounded-xl overflow-hidden shadow-[0_6px_16px_rgba(0,0,0,0.08)]", className)}>
      <div className="px-4 py-3 flex items-center justify-between">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          {icon}
          {title}
        </h3>
        {headerRight}
      </div>
      {children}
    </div>
  );
}

// ── Sidebar Tracker — compact steps with ✓ / ⏳ / ⚠ icons + call button ──
// ── Preparation Tracker — 4 steps with green checkmarks ──
function PreparationTracker({ preparation }: { preparation: ReturnType<typeof getPreparationProgress> }) {
  return (
    <div className="px-4 pb-4 space-y-3">
      <div className="space-y-2.5">
        {preparation.steps.map((step, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className={cn(
              "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
              step.done ? "bg-green-500 text-white" : "bg-gray-200 text-gray-500"
            )}>
              {step.done ? "✓" : i + 1}
            </div>
            <span className={cn("text-sm", step.done ? "font-bold text-foreground" : "text-muted-foreground")}>
              {step.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Prep Stepper — thin horizontal step indicator at top of Assistant block ──
// ── Linear Progress Timeline (Thin line, 5 segments) ──
function LinearProgressBar({ preparation, status, waitingForDietAck = false, dietInstructionSent = false, waitingForStep2Ack = false, step2AckResult = "none" }: {
  preparation: ReturnType<typeof getPreparationProgress>;
  status: PatientStatus;
  waitingForDietAck?: boolean;
  dietInstructionSent?: boolean;
  waitingForStep2Ack?: boolean;
  step2AckResult?: "none" | "confirmed" | "question";
}) {
  const firstPendingIdx = preparation.steps.findIndex(s => !s.done);
  const lastStepIdx = preparation.steps.length - 1;

  const getSegmentColor = (i: number): string => {
    // Виключно сесійна логіка: колір змінюється ЛИШЕ після реальної взаємодії
    const isDone   = (dietInstructionSent && i === 0) || (step2AckResult === "confirmed" && i === lastStepIdx);
    const isFailed = step2AckResult === "question" && i === lastStepIdx;
    // Проміжні кроки (між 0 і lastStep) жовті після того як roadmap надіслано
    const isActive = dietInstructionSent && !isDone && !isFailed && i > 0 && i < lastStepIdx;

    if (isFailed) return "bg-red-500";
    if (isDone && i === lastStepIdx) return "bg-green-500"; // Зелений — ТІЛЬКИ останній
    if (isDone || isActive) return "bg-yellow-400";         // Жовтий — активний або завершений проміжний
    return "bg-gray-200";                                   // Сірий — за замовчуванням (Точка 0)
  };

  return (
    <div className="px-4 pb-3 pt-4">
      {/* Labels above line */}
      <div className="flex justify-between mb-2 gap-1">
        {preparation.steps.map((step, i) => (
          <div key={`label-${i}`} className="flex-1 min-w-0 flex flex-col items-center overflow-hidden">
            <p className="text-[8px] font-semibold text-center leading-tight text-foreground truncate w-full max-w-full px-0.5" title={step.label}>
              {step.label}
            </p>
          </div>
        ))}
      </div>

      {/* Timeline line divided into 5 segments */}
      <div className="flex gap-0.5 h-1">
        {preparation.steps.map((step, i) => (
          <div
            key={`segment-${i}`}
            className={cn("flex-1 rounded-sm transition-colors", getSegmentColor(i))}
          />
        ))}
      </div>
    </div>
  );
}

// ── Chat Pane — Messenger Premium style ──
function renderBoldText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**")
          ? <strong key={i}>{part.slice(2, -2)}</strong>
          : <span key={i}>{part}</span>
      )}
    </>
  );
}

// ── System History Modal (Desktop & Mobile) ──
type EventLog = {
  timestamp: string;
  event: string;
  status: "pending" | "completed" | "warning" | "error";
};

function HistoryModal({ isOpen, onClose, chat, eventLogs = [] }: {
  isOpen: boolean;
  onClose: () => void;
  chat: ChatMessage[];
  eventLogs?: EventLog[];
}) {
  if (!isOpen) return null;

  const systemMessages = chat.filter((m) => !m.unanswered && m.sender === "ai" && (m.text.includes("Підготовку") || m.text.includes("Вітальне") || m.text.includes("перезапущено")));
  
  const getStatusColor = (status: string): string => {
    switch (status) {
      case "completed": return "text-green-700 bg-green-50";
      case "warning": return "text-yellow-700 bg-yellow-50";
      case "error": return "text-red-700 bg-red-50";
      default: return "text-slate-600 bg-slate-50";
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-xl border border-border/60 w-full max-w-2xl max-h-[75vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 shrink-0">
          <div>
            <h3 className="text-base font-bold text-foreground">📜 Журнал подій</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Порядок діяльності та статуси</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors"
          >
            <X size={18} className="text-muted-foreground" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6">
          {eventLogs.length === 0 && systemMessages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Немає записів у журналі</p>
          ) : (
            <div className="space-y-4">
              {/* Event Log Table */}
              {eventLogs.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-foreground mb-2 uppercase opacity-60">Подорож</h4>
                  <div className="space-y-1">
                    {eventLogs.map((log, i) => (
                      <div key={i} className={cn("flex gap-3 px-3 py-2 rounded border", getStatusColor(log.status))}>
                        <span className="font-mono text-[10px] shrink-0 whitespace-nowrap">{log.timestamp}</span>
                        <span className="text-xs flex-1">{log.event}</span>
                        <span className="text-[10px] font-semibold uppercase shrink-0">{log.status === "completed" ? "✓" : log.status === "error" ? "✗" : log.status === "warning" ? "!" : "○"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* System Messages */}
              {systemMessages.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-foreground mb-2 uppercase opacity-60">Повідомлення системи</h4>
                  <div className="space-y-1">
                    {systemMessages.map((msg, i) => (
                      <div key={i} className="flex gap-3 px-3 py-2 rounded bg-muted/30 border border-border/30">
                        <span className="font-mono text-[10px] shrink-0 whitespace-nowrap">{msg.time}</span>
                        <p className="text-xs leading-relaxed flex-1">{msg.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatPane({ chat, unanswered, onQuickReply, onHasQuestion, isTyping }: {
  chat: ChatMessage[];
  unanswered: ChatMessage[];
  onQuickReply?: (answer: "yes" | "no", context?: "greeting" | "diet" | "start_prep" | "drug_choice" | "question_resolved") => void;
  onHasQuestion?: () => void;
  isTyping?: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeMessages = chat.filter((m) => !m.unanswered && !(m.sender === "ai" && (m.text.includes("Підготовку") || m.text.includes("Вітальне") || m.text.includes("перезапущено"))));
  const hasActiveQuickReply = activeMessages.length > 0 && !!activeMessages[activeMessages.length - 1].quickReply;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeMessages.length, isTyping]);

  return (
    <div className="mx-5 my-3 rounded-[20px] px-4 py-3 space-y-2.5 overflow-y-auto flex-1 border border-sky-100 bg-[#F0F8FF]">
      {/* Pinned unanswered questions */}
      {unanswered.map((msg, i) => (
        <div
          key={`pinned-${i}`}
          className="rounded-xl px-4 py-3 text-sm leading-relaxed bg-status-risk-bg border-2 border-status-risk/30 shadow-[0_2px_8px_rgba(0,0,0,0.06)] animate-reveal-up"
        >
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle size={14} className="text-status-risk shrink-0" />
            <span className="text-xs font-bold text-status-risk">Питання без відповіді · {msg.time}</span>
          </div>
          <p className="text-foreground font-bold">{msg.text}</p>
        </div>
      ))}

      {/* Chat history — bubbles */}
      {activeMessages.map((msg, i) => {
        const isPatient = msg.sender === "patient";
        const isDoctor  = msg.sender === "doctor";
        return (
          <div key={i} className={cn("flex flex-col", isPatient ? "items-start" : "items-end")}>
            <div className={cn(
              "rounded-2xl px-4 py-2.5 text-sm leading-relaxed max-w-[86%] shadow-[0_2px_8px_rgba(0,0,0,0.07)] whitespace-pre-wrap",
              isDoctor  ? "bg-green-100 border border-green-300 rounded-br-sm text-green-900"
              : isPatient ? "bg-white border border-gray-300 rounded-bl-sm text-gray-900"
                          : "bg-yellow-50 border border-yellow-300 rounded-bl-sm text-yellow-900"
            )}>
              <p className={cn("text-[11px] font-bold mb-0.5", isDoctor ? "text-green-700" : isPatient ? "text-gray-600" : "text-yellow-700")}>
                {isDoctor ? "Лікар" : isPatient ? "Клієнт" : "Асистент"} · {msg.time}
              </p>
              <p className="text-foreground">{renderBoldText(msg.text)}</p>
            </div>

            {/* QuickReply buttons — inside chat bubble area */}
            {msg.quickReply && onQuickReply && (
              <div className="flex gap-2 mt-2 flex-wrap">
                <button
                  onClick={() => onQuickReply("yes", msg.quickReply?.context)}
                  className="text-[12px] font-bold px-3.5 py-1.5 rounded-full bg-green-600 text-white hover:bg-green-700 active:scale-[0.94] transition-all shadow-sm"
                >
                  {msg.quickReply.yes}
                </button>
                {msg.quickReply.no && (
                  <button
                    onClick={() => onQuickReply("no", msg.quickReply?.context)}
                    className={cn(
                      "text-[12px] font-bold px-3.5 py-1.5 rounded-full active:scale-[0.94] transition-all shadow-sm",
                      msg.quickReply.context === "drug_choice"
                        ? "bg-white border border-slate-300 text-foreground hover:bg-slate-50"
                        : "bg-amber-500 text-white hover:bg-amber-600"
                    )}
                  >
                    {msg.quickReply.no}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Typing indicator — "Асистент пише..." */}
      {isTyping && (
        <div className="flex flex-col items-end animate-reveal-up">
          <div className="rounded-2xl px-4 py-2.5 shadow-[0_2px_8px_rgba(0,0,0,0.07)] bg-yellow-50 border border-yellow-300 rounded-bl-sm">
            <p className="text-[11px] font-bold mb-1.5 text-yellow-700">Асистент</p>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-yellow-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 bg-yellow-500 rounded-full animate-bounce" style={{ animationDelay: "160ms" }} />
              <span className="w-2 h-2 bg-yellow-500 rounded-full animate-bounce" style={{ animationDelay: "320ms" }} />
            </div>
          </div>
        </div>
      )}

      {/* Persistent "Є запитання" button — visible after roadmap, when no quickReply showing */}
      {onHasQuestion && !hasActiveQuickReply && !isTyping && (
        <div className="flex justify-end pt-1">
          <button
            onClick={onHasQuestion}
            className="text-[12px] font-bold px-3.5 py-1.5 rounded-full bg-amber-500 text-white hover:bg-amber-600 active:scale-[0.94] transition-all shadow-sm"
          >
            Є запитання
          </button>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

// ── Chat Input — textarea with smart line expansion ──
function ChatInput() {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const newHeight = Math.min(Math.max(36, textareaRef.current.scrollHeight), 120); // Max 5 lines (~120px)
      textareaRef.current.style.height = `${newHeight}px`;
    }
  };

  const handleSend = () => {
    if (value.trim()) {
      // TODO: Send message through parent handler
      console.log("Sending:", value);
      setValue("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="px-4 py-3 border-t border-border/40 bg-card shrink-0">
      <div className="flex items-end gap-2.5 bg-[hsl(200,100%,96%)] rounded-lg p-2.5">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Відповісти..."
          rows={1}
          className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground resize-none leading-5 max-h-[120px]"
        />
        <button
          onClick={handleSend}
          disabled={!value.trim()}
          className={cn(
            "w-8 h-8 flex items-center justify-center rounded transition-all shrink-0",
            value.trim()
              ? "bg-sky-600 text-white hover:bg-sky-700 active:scale-[0.93]"
              : "bg-muted text-muted-foreground cursor-not-allowed opacity-40"
          )}
          title="Надіслати (Enter)"
        >
          <Send size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

// ── Assistant Toggle — moved from NewEntryForm ──

