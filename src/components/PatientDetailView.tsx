import { useState, useRef, useEffect, useMemo } from "react";
import imageCompression from 'browser-image-compression';
import { X, MessageCircle, AlertTriangle, User, Activity, Phone, Send, Pencil, FileText, Upload, Eye, Trash2, ClipboardList, ChevronRight, ChevronDown, Check, Calendar, RotateCcw, Loader2, FileImage, Link, Play, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { correctNameSpelling } from "@/lib/nameCorrection";
import type { Patient, PatientStatus, HistoryEntry } from "./PatientCard";
import { computePatientStatus, AllergyShield } from "./PatientCard";
import { useIsMobile } from "@/hooks/use-mobile";
import { Progress } from "@/components/ui/progress";
import { ProcedureSelector } from "./ProcedureSelector";
import { CalendarView } from "./CalendarView";
import { CountryPhoneInput } from "./CountryPhoneInput";
import { toast } from "sonner";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth";
import { uploadFileToSupabaseStorage, deleteFileFromSupabaseStorage, resolveVisitFilePublicUrl } from "@/lib/supabaseSync";
import { isPhoneValueValid, normalizePhoneValue } from "@/lib/phoneCountry";
import { allergyStatusLabel, encodeAllergyState, hasConfirmedAllergen, parseAllergyState, type AllergyStatus } from "@/lib/allergyState";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface ChatMessage {
  sender: "ai" | "patient" | "doctor";
  text: string;
  time: string;
  unanswered?: boolean;
  quickReply?: { yes: string; no: string; context?: "greeting" | "diet" };
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
  progress: "Підготовка триває",
  risk: "Потребує уваги",
  ready: "Допущено до процедури",
};

const statusDot: Record<PatientStatus, string> = {
  planning: "bg-slate-400",
  progress: "bg-yellow-500",
  risk: "bg-red-500",
  ready: "bg-green-500",
};

const statusBadgeBg: Record<PatientStatus, string> = {
  planning: "bg-slate-100 text-slate-700",
  progress: "bg-yellow-100 text-yellow-800",
  risk: "bg-red-100 text-red-700",
  ready: "bg-green-100 text-green-700",
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

type DoctorProfile = {
  surname: string;
  firstName: string;
  middleName: string;
};

function formatUkrainianDayMonth(isoDate: string): string {
  const months = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return `${d} ${months[m - 1] || ""}`;
}

function minusDaysIso(isoDate: string, days: number): string {
  const date = new Date(isoDate + "T00:00:00");
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseFullName(raw: string): DoctorProfile {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  return {
    surname: parts[0] || "",
    firstName: parts[1] || "",
    middleName: parts[2] || "",
  };
}

function getDoctorProfile(): DoctorProfile {
  const fallback = parseFullName("Коваленко Іван Петрович");

  try {
    const raw = localStorage.getItem("proctocare_doctor_profile");
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as {
      surname?: string;
      firstName?: string;
      middleName?: string;
      name?: string;
      patronymic?: string;
      fullName?: string;
    };

    if (parsed.fullName?.trim()) {
      const fromFullName = parseFullName(parsed.fullName);
      if (fromFullName.surname && fromFullName.firstName) return fromFullName;
    }

    const profile: DoctorProfile = {
      surname: (parsed.surname || "").trim(),
      firstName: (parsed.firstName || parsed.name || "").trim(),
      middleName: (parsed.middleName || parsed.patronymic || "").trim(),
    };

    if (profile.surname && profile.firstName) return profile;
    return fallback;
  } catch {
    return fallback;
  }
}

function getPatientContactName(patient: Patient): string {
  const full = `${patient.name}${patient.patronymic ? ` ${patient.patronymic}` : ""}`.trim();
  const parts = full.split(/\s+/).filter(Boolean);
  const firstName = parts[1] || parts[0] || "Пацієнте";
  const middleName = patient.patronymic || parts[2] || "";

  const isFemale = middleName.endsWith("івна") || middleName.endsWith("ївна") || middleName.endsWith("вна") || /[ая]$/i.test(firstName);
  const salutation = isFemale ? "Пані" : "Пане";
  return `${salutation} ${firstName}${middleName ? ` ${middleName}` : ""}`;
}

function toGenitiveForm(word: string): string {
  const w = word.trim();
  if (!w) return w;

  // Basic Ukrainian inflection rules for common masculine forms used in UI messages.
  if (/енко$/i.test(w)) return `${w}а`;
  if (/ич$/i.test(w)) return `${w}а`;
  if (/ій$/i.test(w)) return `${w.slice(0, -1)}я`;
  if (/й$/i.test(w)) return `${w.slice(0, -1)}я`;
  if (/[бвгґджзклмнпрстфхцчшщ]$/i.test(w)) return `${w}а`;
  return w;
}

function toVocativeForm(word: string): string {
  const w = word.trim();
  if (!w) return w;

  if (/ич$/i.test(w)) return `${w}у`;
  if (/й$/i.test(w)) return `${w.slice(0, -1)}ю`;
  if (/о$/i.test(w)) return `${w.slice(0, -1)}е`;
  if (/а$/i.test(w)) return `${w.slice(0, -1)}о`;
  if (/я$/i.test(w)) return `${w.slice(0, -1)}є`;
  if (/[бвгґджзклмнпрстфхцчшщ]$/i.test(w)) return `${w}е`;
  return w;
}

function getPatientGreetingLine(patient: Patient): string {
  const full = `${patient.name}${patient.patronymic ? ` ${patient.patronymic}` : ""}`.trim();
  const parts = full.split(/\s+/).filter(Boolean);
  const firstName = parts[1] || parts[0] || "Пацієнт";
  const middleName = patient.patronymic || parts[2] || "";
  const isFemale = middleName.endsWith("івна") || middleName.endsWith("ївна") || middleName.endsWith("вна") || /[ая]$/i.test(firstName);

  if (isFemale) {
    return `Вітаю, Пані ${toVocativeForm(firstName)}${middleName ? ` ${toVocativeForm(middleName)}` : ""}!`;
  }

  return `Вітаю, Пане ${toVocativeForm(firstName)}${middleName ? ` ${toVocativeForm(middleName)}` : ""}!`;
}

function getPatientAddressInVocative(patient: Patient): string {
  const full = `${patient.name}${patient.patronymic ? ` ${patient.patronymic}` : ""}`.trim();
  const parts = full.split(/\s+/).filter(Boolean);
  const firstName = parts[1] || parts[0] || "Пацієнте";
  const middleName = patient.patronymic || parts[2] || "";
  const isFemale = middleName.endsWith("івна") || middleName.endsWith("ївна") || middleName.endsWith("вна") || /[ая]$/i.test(firstName);
  const salutation = isFemale ? "Пані" : "Пане";
  return `${salutation} ${toVocativeForm(firstName)}${middleName ? ` ${toVocativeForm(middleName)}` : ""}`;
}

function getDoctorNameInGenitive(doctor: DoctorProfile): string {
  // Keep surname in base form, inflect first+middle names as requested in UI copy.
  const surname = doctor.surname.trim();
  const firstName = toGenitiveForm(doctor.firstName);
  const middleName = toGenitiveForm(doctor.middleName);
  return `${surname} ${firstName} ${middleName}`.replace(/\s+/g, " ").trim();
}

function buildEmulationGreetingMessage(params: {
  patient: Patient;
  doctor: DoctorProfile;
  serviceName: string;
  appointmentIsoDate: string;
  appointmentTime: string;
}): string {
  const patientGreetingLine = getPatientGreetingLine(params.patient);
  const doctorFullName = `${params.doctor.surname} ${params.doctor.firstName} ${params.doctor.middleName}`.replace(/\s+/g, " ").trim();
  const doctorFullNameGenitive = getDoctorNameInGenitive(params.doctor);
  const dietStartDate = formatUkrainianDayMonth(minusDaysIso(params.appointmentIsoDate, 3));
  const doctorShortName = `${params.doctor.firstName} ${params.doctor.middleName}`.replace(/\s+/g, " ").trim();

  return `**${patientGreetingLine}**\n\nЦе цифровий асистент лікаря **${doctorFullNameGenitive}**.\n\nВи записані на процедуру: **${params.serviceName}**, яка відбудеться **${isoToDisplay(params.appointmentIsoDate)}** о **${params.appointmentTime || "--:--"}**.\n\n**${doctorShortName}** доручив мені супроводжувати вашу підготовку. Ми разом подбаємо про те, щоб майбутня процедура пройшла максимально легко, комфортно та принесла найкращий результат для вашого здоров'я.\n\nНаш перший етап — бережна дієта, яку ми розпочнемо **${dietStartDate}**.\n\nЧи готові ви отримати перелік того, що допоможе вам правильно підготуватися?`;
}

function buildDietInstructionMessage(params: { patient: Patient; appointmentIsoDate: string }): string {
  const patientAddress = getPatientAddressInVocative(params.patient);
  const dietStart = formatUkrainianDayMonth(minusDaysIso(params.appointmentIsoDate, 3));
  const dayBefore = formatUkrainianDayMonth(minusDaysIso(params.appointmentIsoDate, 1));
  const apptDay = formatUkrainianDayMonth(params.appointmentIsoDate);

  return `Чудово! **${patientAddress}**, надсилаю докладний перелік для підготовки. Будь ласка, прочитайте його уважно.

ЗАБОРОНЕНО (ЗА 3 ДНІ ДО ПРОЦЕДУРИ):
Починаючи з **${dietStart}**, необхідно повністю виключити з раціону: БУРЯК, МАК, СЕЗАМ, ГОРІХИ ТА НАСІННЯ, а також будь-які продукти, які їх містять.

ДЕНЬ ПЕРЕД ПРОЦЕДУРОЮ (**${dayBefore}**):

Сніданок (що можна їсти):
Картопляне пюре, йогурт без добавок, яйця, відварена курка.

З 14:00 (ЩО НЕ МОЖНА РОБИТИ):

КАТЕГОРИЧНО ЗАБОРОНЕНО: вживати зупи, овочі, фрукти та будь-які дрібні продукти (сезам, насіння тощо).

Можна пити: чай, воду, компот (крім напоїв червоного кольору).

ВАЖЛИВІ ЗАУВАЖЕННЯ ЩОДО ПРЕПАРАТІВ ТА РЕЖИМУ:

Зранку в день процедури (**${apptDay}**): якщо вона проводиться з медичним сном (наркозом), НЕ МОЖНА приймати препарати від тиску (антигіпертензивні).

Після процедури з медичним сном: людині, якій робили наркоз, КАТЕГОРИЧНО ЗАБОРОНЕНО сідати за кермо.

НЕОБХІДНО ПРИДБАТИ ЗАЗДАЛЕГІДЬ:
Вам потрібно купити в аптеці препарат ФОРТРАНС (4 пакети). Детальну схему прийому препарату я надішлю вам пізніше.

**${patientAddress}**, чи все вам зрозуміло? Які саме продукти вам заборонено вживати у ці дні?`;
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

function getPreparationProgress(patient: Patient, services?: string[]): { percent: number; steps: { label: string; done: boolean }[] } {
  const status = patient.status;
  const hasPolypectomy = services?.some(s => s.includes("Поліпектомія") || s.includes("поліпектомія"));

  if (patient.fromForm && !services?.length) {
    return {
      percent: 0,
      steps: [
        { label: "Дієта 3 дні", done: false },
        { label: "Прийом препарату", done: false },
        { label: "Очищення завершено", done: false },
        { label: "Аналізи в нормі", done: false },
      ],
    };
  }

  const steps = [
    { label: "Дієта 3 дні", done: status === "ready" || status === "progress" || status === "risk" },
    { label: "Прийом препарату", done: status === "ready" || status === "progress" },
    { label: "Очищення завершено", done: status === "ready" },
    { label: "Аналізи в нормі", done: status === "ready" },
    ...(hasPolypectomy ? [{ label: "Консультація анестезіолога", done: status === "ready" }] : []),
  ];

  const doneCount = steps.filter(s => s.done).length;
  const percent = Math.round((doneCount / steps.length) * 100);
  return { percent, steps };
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
  const profile = getMockProfile(patient);
  const activeVisitIso = patient.date || getTodayIsoKyiv();
  const activeVisitDisplayDate = isoToDisplay(activeVisitIso);

  const relatedVisits = useMemo(() => {
    // Primary filter: by stable patientDbId (Supabase patients.id) — prevents phantom
    // data from same-name patients who were deleted and recreated.
    // Fallback to name-matching for local/non-Supabase mode.
    const filterFn = patient.patientDbId
      ? (p: Patient) => p.patientDbId === patient.patientDbId
      : (() => {
          const normalize = (v: Pick<Patient, "name" | "patronymic">) => {
            const compactName = (v.name || "").replace(/\s+/g, " ").trim().toLowerCase();
            const parts = compactName.split(" ").filter(Boolean);
            const surname = parts[0] || "";
            const firstName = parts[1] || "";
            const explicitPatronymic = (v.patronymic || "").replace(/\s+/g, " ").trim().toLowerCase();
            const parsedPatronymic = parts.length > 2 ? parts.slice(2).join(" ") : "";
            const patronymic = explicitPatronymic || parsedPatronymic;
            return `${surname}|${firstName}|${patronymic}`;
          };
          const key = normalize(patient);
          return (p: Patient) => normalize(p) === key;
        })();

    return allPatients
      .filter(filterFn)
      .filter((p) => !!p.date)
      .slice()
      .sort((a, b) => `${a.date || ""}${a.time || ""}`.localeCompare(`${b.date || ""}${b.time || ""}`));
  }, [allPatients, patient]);

  const hasPastVisitFromAll = useMemo(() => {
    return relatedVisits.some((v) => (v.date || "") < activeVisitIso);
  }, [relatedVisits, activeVisitIso]);

  const lastCompletedVisitFromAll = useMemo(() => {
    return relatedVisits
      .filter((v) => (v.date || "") < activeVisitIso)
      .filter((v) => !v.noShow)
      .filter((v) => !!v.completed || v.status === "ready")
      .sort((a, b) => `${b.date || ""}${b.time || ""}`.localeCompare(`${a.date || ""}${a.time || ""}`))[0];
  }, [relatedVisits, activeVisitIso]);

  const completedPastVisitDates = useMemo(() => {
    const unique = new Set<string>();
    for (const visit of relatedVisits) {
      if (!visit.date) continue;
      if (visit.date >= activeVisitIso) continue;
      if (visit.noShow) continue;
      if (!visit.completed && visit.status !== "ready") continue;
      unique.add(isoToDisplay(visit.date));
    }

    return Array.from(unique).sort((a, b) => {
      const parse = (s: string) => {
        const [d, m, y] = s.split(".");
        return new Date(+y, +m - 1, +d).getTime();
      };
      return parse(b) - parse(a);
    });
  }, [relatedVisits, activeVisitIso]);

  const archivedVisitOutcomeByDate = useMemo(() => {
    const map: Record<string, "completed" | "no-show"> = {};
    for (const visit of relatedVisits) {
      if (!visit.date) continue;
      if (visit.date >= activeVisitIso) continue;

      const displayDate = isoToDisplay(visit.date);
      if (visit.noShow) {
        map[displayDate] = "no-show";
        continue;
      }
      if (visit.completed || visit.status === "ready") {
        if (!map[displayDate]) map[displayDate] = "completed";
      }
    }
    return map;
  }, [relatedVisits, activeVisitIso]);
  
  // A completed or no-show visit in the past means the card is in "archive mode" —
  // visit-specific fields (notes, diagnosis, services, protocol) must be empty so they are
  // ready for the NEXT visit. Allergies are ALWAYS preserved — they belong to the patient.
  const isCompletedPastVisit = (patient.completed || patient.status === "ready")
    && (!patient.date || patient.date <= getTodayIsoKyiv());
  const isNoShowPast = !!patient.noShow
    && (!patient.date || patient.date <= getTodayIsoKyiv());
  const shouldClearVisitFields = isCompletedPastVisit || isNoShowPast;

  const initialNotes = shouldClearVisitFields ? "" : (patient.notes ?? patient.primaryNotes ?? profile.notes);
  // Completed/no-show past visits: active protocol field starts EMPTY so doctor types a fresh
  // conclusion for the next visit. The saved text lives in archivedProtocolText (patient.protocol)
  // and is only transferred to this field when the doctor clicks "Скопіювати".
  const initialProtocol = shouldClearVisitFields ? "" : getInitialActiveProtocol(patient, activeVisitIso);
  const initialPhone = patient.phone || profile.phone;
  const initialServices = shouldClearVisitFields
    ? []
    : (patient.procedure ? patient.procedure.split(", ") : []);
  // Diagnosis: cleared for completed/no-show past visits AND for fresh planning visits
  // (diagnosis belongs to the examination that hasn't happened yet — starts empty, doctor fills in).
  // This prevents the diagnosis from a previous completed visit from pre-populating a new card.
  const initialDiagnosis = (shouldClearVisitFields || patient.status === "planning") ? "" : profile.diagnosis;

  const [fields, setFields] = useState({
    phone: initialPhone,
    allergies: profile.allergies, // CRITICAL: allergies belong to patient, never cleared
    diagnosis: initialDiagnosis,
    notes: initialNotes,
    protocol: initialProtocol,
    birthDate: profile.birthDate,
  });
  const currentAllergy = useMemo(() => parseAllergyState(fields.allergies), [fields.allergies]);
  const [allergyModalOpen, setAllergyModalOpen] = useState(false);
  const [allergyDraftStatus, setAllergyDraftStatus] = useState<AllergyStatus>(currentAllergy.status);
  const [allergyDraftText, setAllergyDraftText] = useState(currentAllergy.allergen);

  const [localServices, setLocalServices] = useState<string[]>(initialServices);
  const [showReschedulePicker, setShowReschedulePicker] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState(patient.date || new Date().toISOString().slice(0, 10));
  const [rescheduleTime, setRescheduleTime] = useState(patient.time || "");
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

  useEffect(() => {
    setRescheduleDate(patient.date || new Date().toISOString().slice(0, 10));
    setRescheduleTime(patient.time || "");
  }, [patient.id, patient.date, patient.time]);

  useEffect(() => {
    setAllergyDraftStatus(currentAllergy.status);
    setAllergyDraftText(currentAllergy.allergen);
  }, [currentAllergy.status, currentAllergy.allergen]);

  const [emulatedMessages, setEmulatedMessages] = useState<ChatMessage[]>(() => {
    if (restoredAssistantSession?.messages?.length) {
      return restoredAssistantSession.messages;
    }
    const entry = getWelcomeEntry(patient.id, activeVisitIso);
    if (!entry) return [];
    const doctor = getDoctorProfile();
    const serviceName = patient.procedure || "процедуру";
    const text = buildEmulationGreetingMessage({
      patient,
      doctor,
      serviceName,
      appointmentIsoDate: activeVisitIso,
      appointmentTime: patient.time || "",
    });
    return [{ sender: "ai", text, time: entry.time, quickReply: { yes: "Так", no: "Ні", context: "greeting" } }];
  });
  const [waitingForDietAck, setWaitingForDietAck] = useState(restoredAssistantSession?.waitingForDietAck ?? false);
  const [dietInstructionSent, setDietInstructionSent] = useState(restoredAssistantSession?.dietInstructionSent ?? false);
  const [waitingForStep2Ack, setWaitingForStep2Ack] = useState(restoredAssistantSession?.waitingForStep2Ack ?? false);
  const [step2AckResult, setStep2AckResult] = useState<"none" | "confirmed" | "question">(restoredAssistantSession?.step2AckResult ?? "none");
  const [welcomeSent, setWelcomeSent] = useState(() => restoredAssistantSession?.welcomeSent ?? isWelcomeSent(patient.id, activeVisitIso));

  useEffect(() => {
    const restored = getAssistantSession(patient.id, activeVisitIso);
    if (restored) {
      setEmulatedMessages(restored.messages);
      setWaitingForDietAck(restored.waitingForDietAck);
      setDietInstructionSent(restored.dietInstructionSent);
      setWaitingForStep2Ack(restored.waitingForStep2Ack);
      setStep2AckResult(restored.step2AckResult);
      setWelcomeSent(restored.welcomeSent);
      return;
    }

    const entry = getWelcomeEntry(patient.id, activeVisitIso);
    if (entry) {
      const doctor = getDoctorProfile();
      const serviceName = patient.procedure || "процедуру";
      const text = buildEmulationGreetingMessage({
        patient,
        doctor,
        serviceName,
        appointmentIsoDate: activeVisitIso,
        appointmentTime: patient.time || "",
      });
      setEmulatedMessages([{ sender: "ai", text, time: entry.time, quickReply: { yes: "Так", no: "Ні", context: "greeting" } }]);
      setWelcomeSent(true);
    } else {
      setEmulatedMessages([]);
      setWelcomeSent(false);
    }
    setWaitingForDietAck(false);
    setDietInstructionSent(false);
    setWaitingForStep2Ack(false);
    setStep2AckResult("none");
  }, [patient.id, activeVisitIso]);

  useEffect(() => {
    saveAssistantSession(patient.id, activeVisitIso, {
      messages: emulatedMessages,
      waitingForDietAck,
      dietInstructionSent,
      waitingForStep2Ack,
      step2AckResult,
      welcomeSent,
    });
  }, [patient.id, activeVisitIso, emulatedMessages, waitingForDietAck, dietInstructionSent, waitingForStep2Ack, step2AckResult, welcomeSent]);

  const baseChat = getMockChat(patient);
  const chat = [...baseChat, ...emulatedMessages];
  const unanswered = chat.filter((m) => m.unanswered);
  const preparation = getPreparationProgress(patient, localServices);

  const effectiveStatus = useMemo<PatientStatus>(() => {
    if (patient.noShow) return "risk";
    if (patient.completed) return "ready";
    if (step2AckResult === "question") return "risk";

    if (welcomeSent || waitingForDietAck || dietInstructionSent || waitingForStep2Ack || step2AckResult === "confirmed") {
      return "progress";
    }

    return computePatientStatus(patient);
  }, [
    patient,
    step2AckResult,
    welcomeSent,
    waitingForDietAck,
    dietInstructionSent,
    waitingForStep2Ack,
  ]);

  useEffect(() => {
    if (!onUpdatePatient) return;
    if (patient.status === effectiveStatus) return;

    const aiSummaryByStatus: Record<PatientStatus, string> = {
      planning: "Записаний на процедуру, очікує підготовки",
      progress: "Підготовка триває, асистент веде пацієнта",
      risk: "Пацієнт має запитання, потрібна відповідь лікаря",
      ready: "Підготовка завершена, пацієнт допущений",
    };

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

  // For new visits created by reschedule (fromForm=true, empty protocolHistory), pull in
  // protocol texts from related completed visits so the "Скопіювати" button can appear.
  const relatedCompletedProtocols: Array<{ value: string; timestamp: string; date: string }> = [];
  const relatedCompletedFiles: FileItem[] = [];
  // Always collect files and protocols from related completed visits so they appear
  // in the archive section — regardless of fromForm status (enrichPatientWithVisitHistory
  // can override fromForm to false even for newly created future visits).
  for (const v of relatedVisits) {
    if (v.id === patient.id) continue;
    if (!v.completed && v.status !== "ready") continue;
    if (patient.fromForm || !patient.files?.length) {
      if (v.protocolHistory?.length) {
        relatedCompletedProtocols.push(...v.protocolHistory);
      } else if (v.protocol?.trim() && v.date) {
        relatedCompletedProtocols.push({ value: v.protocol.trim(), timestamp: isoToDisplay(v.date), date: v.date });
      }
    }
    // Collect files from related completed visits for archive display
    if (v.files?.length) {
      relatedCompletedFiles.push(...v.files);
    }
  }
  const mergedProtocolHistory = mergeUniqueHistoryEntries(
    [...(patient.protocolHistory || []), ...relatedCompletedProtocols],
    []
  );
  const mergedProcedureHistory = mergeUniqueHistoryEntries(patient.procedureHistory, []);
  const initialFiles = patient.files || [];
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
    logs.push({
      timestamp: patient.time || "--:--",
      event: `Картку відкрито · ${isoToDisplay(activeVisitIso)}`,
      status: "completed",
    });
    if (welcomeSent) logs.push({
      timestamp: new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }),
      event: "Вітальне повідомлення надіслано",
      status: "completed",
    });
    if (dietInstructionSent) logs.push({
      timestamp: new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }),
      event: "Інструкція щодо харчування надіслана",
      status: "completed",
    });
    if (waitingForStep2Ack) logs.push({
      timestamp: new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }),
      event: "Очікування підтвердження пацієнта",
      status: "pending",
    });
    if (step2AckResult === "confirmed") logs.push({
      timestamp: new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }),
      event: "Пацієнт підтвердив готовність",
      status: "completed",
    });
    if (step2AckResult === "question") logs.push({
      timestamp: new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }),
      event: "Пацієнт має запитання",
      status: "warning",
    });
    if (rescheduleNoticeOriginalDate) logs.push({
      timestamp: new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }),
      event: `Підготовку перезапущено (перенос з ${rescheduleNoticeOriginalDate})`,
      status: "warning",
    });
    if (logs.length === 1) {
      logs.push({
        timestamp: patient.time || "--:--",
        event: "Очікування наступної дії пацієнта",
        status: "pending",
      });
    }
    return logs.reverse();
  }, [welcomeSent, dietInstructionSent, waitingForStep2Ack, step2AckResult, rescheduleNoticeOriginalDate, patient.time, activeVisitIso]);

  // Auto-send welcome message when all 4 fields are filled for the first time
  useEffect(() => {
    if (!allFieldsReady || welcomeSent) return;
    const timer = setTimeout(() => {
      const doctor = getDoctorProfile();
      const serviceName = localServices.length > 0 ? localServices.join(", ") : (patient.procedure || "процедуру");
      const messageText = buildEmulationGreetingMessage({
        patient,
        doctor,
        serviceName,
        appointmentIsoDate: activeVisitIso,
        appointmentTime: patient.time || "",
      });
      const _ts = new Date();
      const _dd = String(_ts.getDate()).padStart(2, "0");
      const _mm = String(_ts.getMonth() + 1).padStart(2, "0");
      const _hhmm = _ts.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
      const messageTime = `${_dd}.${_mm} | ${_hhmm}`;
      setEmulatedMessages((prev) => [...prev, { sender: "ai", text: messageText, time: messageTime, quickReply: { yes: "Так", no: "Ні", context: "greeting" } }]);
      setWaitingForDietAck(true);
      setDietInstructionSent(false);
      setWaitingForStep2Ack(false);
      setStep2AckResult("none");
      markWelcomeSent(patient.id, activeVisitIso, messageTime, messageText);
      setWelcomeSent(true);
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFieldsReady, welcomeSent]);

  const handleQuickReply = (answer: "yes" | "no", context: "greeting" | "diet" = "greeting") => {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const hhmm = now.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
    const replyTime = `${dd}.${mm} | ${hhmm}`;
    const replyText = context === "diet"
      ? (answer === "yes" ? "Так, все зрозуміло" : "Є запитання")
      : (answer === "yes" ? "Так" : "Ні");
    // Remove quickReply chips from the greeting message, add patient reply
    setEmulatedMessages((prev) =>
      prev
        .map((m) => m.quickReply ? { ...m, quickReply: undefined } : m)
        .concat({ sender: "patient", text: replyText, time: replyTime })
    );

    if (context === "greeting" && answer === "yes") {
      const dietText = buildDietInstructionMessage({ patient, appointmentIsoDate: activeVisitIso });
      setEmulatedMessages((prev) => [...prev, {
        sender: "ai",
        text: dietText,
        time: replyTime,
        quickReply: { yes: "Так, все зрозуміло", no: "Є запитання", context: "diet" },
      }]);
      setDietInstructionSent(true);
      setWaitingForStep2Ack(true);
      setWaitingForDietAck(false);
      setStep2AckResult("none");
      return;
    }

    if (context === "greeting" && answer === "no") {
      setDietInstructionSent(false);
      setWaitingForStep2Ack(false);
      setStep2AckResult("none");
      setWaitingForDietAck(false);
      return;
    }

    if (context === "diet" && answer === "no") {
      setEmulatedMessages((prev) => [...prev, {
        sender: "ai",
        text: "Передав запит лікарю. Очікуйте відповідь у цьому чаті.",
        time: replyTime,
      }]);
      setStep2AckResult("question");
    }

    if (context === "diet" && answer === "yes") {
      setStep2AckResult("confirmed");
    }

    if (context === "diet") {
      setWaitingForStep2Ack(false);
    }

    setWaitingForDietAck(false);
  };

  // Derive lastVisit from the latest valid archived date: completed visit from schedule
  // or archived protocol/procedure date (excluding no-show/incomplete visits when known).
  const derivedLastVisit = (() => {
    const currentDate = patient.date || "9999-99-99";
    const latestCompletedIso = lastCompletedVisitFromAll?.date;
    // Only count as "closed" if the visit date is today or in the past — future visits with stale
    // completed=true in DB must not pollute lastVisit or archive logic.
    const closedCurrentVisitIso = patient.date
      && patient.date <= getTodayIsoKyiv()
      && (patient.completed || patient.status === "ready" || patient.noShow)
      ? patient.date
      : undefined;

    const visitByIso = new Map<string, Patient>();
    for (const visit of relatedVisits) {
      if (!visit.date) continue;
      const existing = visitByIso.get(visit.date);
      if (!existing) {
        visitByIso.set(visit.date, visit);
        continue;
      }

      const existingRank = (existing.noShow ? 0 : 1) + ((existing.completed || existing.status === "ready") ? 2 : 0);
      const currentRank = (visit.noShow ? 0 : 1) + ((visit.completed || visit.status === "ready") ? 2 : 0);
      if (currentRank >= existingRank) visitByIso.set(visit.date, visit);
    }

    const archivedDateCandidates = new Set<string>();
    for (const h of mergedProtocolHistory) {
      if (!h.date || h.value.startsWith(RESCHEDULED_MARKER)) continue;
      if (h.date >= currentDate) continue;
      const linkedVisit = visitByIso.get(h.date);
      if (linkedVisit) {
        if (linkedVisit.noShow) continue;
        if (!linkedVisit.completed && linkedVisit.status !== "ready") continue;
      }
      archivedDateCandidates.add(h.date);
    }
    for (const h of mergedProcedureHistory) {
      if (!h.date || h.date >= currentDate) continue;
      const linkedVisit = visitByIso.get(h.date);
      if (linkedVisit) {
        if (linkedVisit.noShow) continue;
        if (!linkedVisit.completed && linkedVisit.status !== "ready") continue;
      }
      archivedDateCandidates.add(h.date);
    }

    const latestArchivedIso = Array.from(archivedDateCandidates).sort().reverse()[0];
    const bestIso = [closedCurrentVisitIso, latestCompletedIso, latestArchivedIso]
      .filter((d): d is string => !!d)
      .sort()
      .reverse()[0];

    return bestIso ? isoToDisplay(bestIso) : "";
  })();
  const mergedProfile = { ...profile, ...fields, lastVisit: derivedLastVisit || profile.lastVisit };
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

  const handleOpenAllergyModal = () => {
    const parsed = parseAllergyState(fields.allergies);
    setAllergyDraftStatus(parsed.status);
    setAllergyDraftText(parsed.allergen);
    setAllergyModalOpen(true);
  };

  // Відкриває картку конкретного архівного візиту по відображуваній даті
  const handleOpenVisitByDate = (displayDate: string) => {
    const iso = displayToIso(displayDate);
    const target = relatedVisits.find((v) => v.date === iso);
    if (target) onOpenVisit?.(target.id);
  };

  const handleSaveAllergyModal = () => {
    const storedValue = encodeAllergyState(allergyDraftStatus, allergyDraftText);
    setFields((prev) => ({ ...prev, allergies: storedValue }));
    onUpdatePatient?.({ allergies: storedValue });
    setAllergyModalOpen(false);
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

  const handleApplyReschedule = async () => {
    if (!rescheduleDate || !rescheduleTime) return;
    if (!onUpdatePatient && !onCreateNewVisit) return;

    const previousVisitIso = patient.date || getTodayIsoKyiv();
    const previousVisitDisplay = isoToDisplay(previousVisitIso);

    const d = new Date(rescheduleDate + "T00:00:00");
    const formatted = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;

    // — If the current visit is already completed/ready, create a FRESH visit record
    //   so the old record stays in DB as archive and persists after page refresh.
    const isCompletedVisit = patient.completed || patient.status === "ready";
    if (isCompletedVisit && onCreateNewVisit) {
      // Save any typed protocol to the OLD (completed) visit before leaving it
      if (fields.protocol.trim() && onUpdatePatient) {
        onUpdatePatient({ protocol: fields.protocol.trim() });
      }
      // Close picker immediately for responsive UX; toast fires only after DB save + refresh
      setShowReschedulePicker(false);
      await onCreateNewVisit({ date: rescheduleDate, time: rescheduleTime });
      setFields((prev) => ({ ...prev, protocol: "" }));
      toast.success(`Прийом перенесено: ${formatted} · ${rescheduleTime}`);
      return;
    }

    // — Planning visit: just move the appointment date on the same record.
    // Per .cursorrules Rule 1: reschedule is NOT completion. No archiving, no
    // protocolHistory entries, no clearing of doctor_conclusion or any other field.
    if (!onUpdatePatient) return;

    // Prevent the sync useEffect (triggered by patient.date change) from firing
    // an auto-save that could wipe or mis-date protocol text.
    skipNextAutoSave.current = true;
    onUpdatePatient({
      date: rescheduleDate,
      time: rescheduleTime,
    });
    setShowReschedulePicker(false);
    toast.success(`Прийом перенесено: ${formatted} · ${rescheduleTime}`);
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
                {(patient.completed || patient.status === "ready") && (!patient.date || patient.date <= getTodayIsoKyiv())
                  ? "—"
                  : (patient.date
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
              <span className="font-bold text-foreground">{(patient.completed || patient.status === "ready") && (!patient.date || patient.date <= getTodayIsoKyiv()) ? "—" : (patient.time || "—")}</span>
              {!((patient.completed || patient.status === "ready") && (!patient.date || patient.date <= getTodayIsoKyiv())) && getPrimaryService(localServices) && (
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
                    <ProfilePane
                      profile={mergedProfile}
                      onFocusEdit={handleFocusOpen}
                      onAllergyEdit={handleOpenAllergyModal}
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
                    <ServicesPane services={localServices} onServicesChange={handleServicesChange} showFloatingEdit={!focusField} />
                  </ContentBlock>
                </div>
              ) : activeTab === "files" ? (
                <div className="p-4 space-y-3 min-h-full">
                  <ContentBlock title="Обстеження та Файли" icon={<FileText size={13} />}>
                    <FilesPane
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
                      currentVisitOutcome={
                        (patient.noShow && (!patient.date || patient.date <= getTodayIsoKyiv())) ? "no-show" :
                        ((patient.completed || patient.status === "ready") && (!patient.date || patient.date <= getTodayIsoKyiv())) ? "completed" :
                        undefined
                      }
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
                    <ChatPane chat={chat} unanswered={unanswered} onQuickReply={handleQuickReply} />
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
                <ProfilePane
                  profile={mergedProfile}
                  onFocusEdit={handleFocusOpen}
                  onAllergyEdit={handleOpenAllergyModal}
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
                <ServicesPane services={localServices} onServicesChange={handleServicesChange} showFloatingEdit={!focusField} />
              </ContentBlock>
              <ContentBlock title="Обстеження та Файли" icon={<FileText size={13} />}>
                <FilesPane
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
                  currentVisitOutcome={
                    (patient.noShow && (!patient.date || patient.date <= getTodayIsoKyiv())) ? "no-show" :
                    ((patient.completed || patient.status === "ready") && (!patient.date || patient.date <= getTodayIsoKyiv())) ? "completed" :
                    undefined
                  }
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
                <ChatPane chat={chat} unanswered={unanswered} onQuickReply={handleQuickReply} />
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

        {allergyModalOpen && (
          <AllergyStatusModal
            status={allergyDraftStatus}
            allergenText={allergyDraftText}
            onStatusChange={setAllergyDraftStatus}
            onAllergenTextChange={setAllergyDraftText}
            onCancel={() => setAllergyModalOpen(false)}
            onSave={handleSaveAllergyModal}
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

        {showReschedulePicker && (
          <div className="absolute inset-0 z-[65] flex flex-col bg-background animate-fade-in">
            <div className="flex items-center justify-between px-4 py-3 border-b bg-card shrink-0">
              <div>
                <h3 className="text-sm font-bold text-foreground">Перенести прийом</h3>
                {rescheduleDate && rescheduleTime && (
                  <p className="text-xs text-primary font-bold mt-0.5">
                    {new Date(rescheduleDate + "T00:00:00").toLocaleDateString("uk-UA", { day: "numeric", month: "long" })} · {rescheduleTime}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleApplyReschedule}
                  disabled={!rescheduleDate || !rescheduleTime}
                  className="px-4 py-2 bg-primary text-primary-foreground text-sm font-bold rounded-lg active:scale-[0.96] transition-all disabled:opacity-40 disabled:pointer-events-none"
                >
                  Зберегти
                </button>
                <button
                  onClick={() => setShowReschedulePicker(false)}
                  className="p-1.5 rounded-md hover:bg-accent active:scale-[0.95] transition-all"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <CalendarView
                onSlotClick={(selectedDate, hour) => {
                  // Use local date components — toISOString() shifts to UTC and causes
                  // an off-by-one day for timezones ahead of UTC (e.g. Kyiv UTC+3).
                  const y = selectedDate.getFullYear();
                  const m = String(selectedDate.getMonth() + 1).padStart(2, "0");
                  const d = String(selectedDate.getDate()).padStart(2, "0");
                  setRescheduleDate(`${y}-${m}-${d}`);
                  setRescheduleTime(`${String(hour).padStart(2, "0")}:00`);
                }}
                selectedSlot={rescheduleDate && rescheduleTime ? {
                  dateStr: rescheduleDate,
                  hour: parseInt(rescheduleTime, 10),
                  name: patient.name,
                } : undefined}
                realPatients={allPatients}
                initialFocusDate={patient.date || undefined}
              />
            </div>
          </div>
        )}

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

function AllergyStatusModal({
  status,
  allergenText,
  onStatusChange,
  onAllergenTextChange,
  onCancel,
  onSave,
}: {
  status: AllergyStatus;
  allergenText: string;
  onStatusChange: (status: AllergyStatus) => void;
  onAllergenTextChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const canSave = status !== "allergen" || allergenText.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-fade-in" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl bg-card border border-border/60 shadow-elevated p-4 space-y-3 animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-foreground">Статус алергії</h3>

        <button
          type="button"
          onClick={() => onStatusChange("allergen")}
          className={cn(
            "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
            status === "allergen" ? "border-red-400 bg-red-50" : "border-border bg-background hover:bg-red-50/40"
          )}
        >
          <p className="text-sm font-bold text-red-600">🔴 Вказати алерген</p>
          <p className="text-xs text-red-500/80 mt-0.5">Вкажіть конкретну речовину або препарат</p>
        </button>

        {status === "allergen" && (
          <input
            type="text"
            value={allergenText}
            onChange={(e) => onAllergenTextChange(e.target.value)}
            onFocus={(e) => focusAtEnd(e.currentTarget)}
            placeholder="Наприклад: Пеніцилін"
            className="w-full rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700 outline-none focus:ring-2 focus:ring-red-200"
            autoFocus
          />
        )}

        <button
          type="button"
          onClick={() => onStatusChange("none")}
          className={cn(
            "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
            status === "none" ? "border-green-400 bg-green-50" : "border-border bg-background hover:bg-green-50/40"
          )}
        >
          <p className="text-sm font-bold text-green-700">✅ Не виявлено</p>
          <p className="text-xs text-green-700/80 mt-0.5">Алергії немає, перевірили</p>
        </button>

        <button
          type="button"
          onClick={() => onStatusChange("unknown")}
          className={cn(
            "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
            status === "unknown" ? "border-slate-400 bg-slate-100" : "border-border bg-background hover:bg-slate-100/60"
          )}
        >
          <p className="text-sm font-bold text-slate-700">⬜ Не з'ясовано</p>
          <p className="text-xs text-slate-600 mt-0.5">Ще не питали пацієнта</p>
        </button>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-bold text-muted-foreground border border-border rounded-lg hover:bg-muted/40 transition-colors">
            Скасувати
          </button>
          <button
            onClick={onSave}
            disabled={!canSave}
            className="px-4 py-2 text-sm font-bold text-primary-foreground bg-primary rounded-lg disabled:opacity-40"
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

// ── Profile Pane with editable fields ──
function ProfilePane({ profile, onFocusEdit, onAllergyEdit, onBirthDateChange, onPhoneChange, histories }: {
  profile: ReturnType<typeof getMockProfile>;
  onFocusEdit: (field: string, value: string, history?: HistoryEntry[]) => void;
  onAllergyEdit: () => void;
  onBirthDateChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  histories: {
    phoneHistory?: Array<{ value: string; timestamp: string; date: string }>;
    birthDateHistory?: Array<{ value: string; timestamp: string; date: string }>;
    allergiesHistory?: Array<{ value: string; timestamp: string; date: string }>;
    diagnosisHistory?: Array<{ value: string; timestamp: string; date: string }>;
    notesHistory?: Array<{ value: string; timestamp: string; date: string }>;
  };
}) {
  const [localBirthDate, setLocalBirthDate] = useState(profile.birthDate || "");
  const [localPhone, setLocalPhone] = useState(normalizePhoneWithPlus(profile.phone || ""));

  useEffect(() => {
    setLocalBirthDate(profile.birthDate || "");
  }, [profile.birthDate]);

  useEffect(() => {
    setLocalPhone(normalizePhoneWithPlus(profile.phone || ""));
  }, [profile.phone]);

  const { ageStr } = calcAge(localBirthDate);
  const allergy = parseAllergyState(profile.allergies);

  return (
    <div className="px-4 pb-4 space-y-3">

      {/* Row 1: Дата народження + Вік */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-background rounded-xl border border-border/60 px-3 py-2.5">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Дата народження</p>
            <button onClick={() => onFocusEdit("birthDate", localBirthDate, histories.birthDateHistory)} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-accent transition-all shrink-0">
              <Pencil size={11} className="text-muted-foreground" />
            </button>
          </div>
          <input
            type="text"
            inputMode="numeric"
            value={localBirthDate}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d]/g, "").slice(0, 8);
              let f = raw;
              if (raw.length > 2) f = raw.slice(0, 2) + "." + raw.slice(2);
              if (raw.length > 4) f = raw.slice(0, 2) + "." + raw.slice(2, 4) + "." + raw.slice(4);
              setLocalBirthDate(f);
              onBirthDateChange(f);
            }}
            placeholder="ДД.ММ.РРРР"
            maxLength={10}
            className="w-full bg-transparent text-sm font-bold tabular-nums outline-none"
          />
        </div>
        <div className="bg-background rounded-xl border border-border/60 px-3 py-2.5">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1">Вік</p>
          <span className="text-sm font-bold text-foreground tabular-nums">{ageStr === "—" ? "—" : ageStr}</span>
        </div>
      </div>

      {/* Row 2: Телефон */}
      <div className="bg-background rounded-xl border border-border/60 px-3 py-2.5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Phone size={10} /> Телефон
          </p>
          <button onClick={() => onFocusEdit("phone", profile.phone, histories.phoneHistory)} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-accent transition-all">
            <Pencil size={11} className="text-muted-foreground" />
          </button>
        </div>
        <CountryPhoneInput
          value={localPhone}
          onChange={(nextValue) => {
            const normalized = normalizePhoneWithPlus(nextValue);
            setLocalPhone(normalized);
            onPhoneChange(getStorablePhone(normalized));
          }}
          buttonClassName="py-2"
          inputClassName="py-2"
        />
      </div>

      {/* Row 3: Алергії */}
      <div
        className={cn(
          "rounded-xl border px-3 py-2.5",
          allergy.status === "allergen"
            ? "bg-red-50 border-red-200"
            : allergy.status === "none"
              ? "bg-green-50 border-green-200"
              : "bg-slate-50 border-slate-200"
        )}
      >
        <div className="flex items-center justify-between mb-1">
          <p
            className={cn(
              "text-[10px] font-bold uppercase tracking-wide flex items-center gap-1",
              allergy.status === "allergen"
                ? "text-red-600"
                : allergy.status === "none"
                  ? "text-green-700"
                  : "text-slate-600"
            )}
          >
            {allergy.status === "allergen" && <AllergyShield size={12} />}
            Алергії
          </p>
          <button onClick={onAllergyEdit} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/60 transition-all">
            <Pencil size={11} className={cn(allergy.status === "allergen" ? "text-red-600" : allergy.status === "none" ? "text-green-700" : "text-slate-500")} />
          </button>
        </div>

        <span
          className={cn(
            "text-sm font-bold",
            allergy.status === "allergen"
              ? "text-red-600"
              : allergy.status === "none"
                ? "text-green-700"
                : "text-slate-600"
          )}
        >
          {allergy.status === "allergen" ? allergy.allergen : allergy.status === "none" ? "Не виявлено" : "Не з'ясовано"}
        </span>
      </div>

      {/* Row 4: Діагноз */}
      <div className="bg-background rounded-xl border border-border/60 px-3 py-2.5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Діагноз</p>
          <button onClick={() => onFocusEdit("diagnosis", profile.diagnosis, histories.diagnosisHistory)} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-accent transition-all">
            <Pencil size={11} className="text-muted-foreground" />
          </button>
        </div>
        <button onClick={() => onFocusEdit("diagnosis", profile.diagnosis, histories.diagnosisHistory)} className={cn("text-sm font-bold text-left w-full transition-colors", profile.diagnosis ? "text-foreground hover:text-primary" : "text-muted-foreground/40 italic")}>
          {profile.diagnosis || "Не встановлено"}
        </button>
      </div>

      {/* Row 5: Останній візит */}
      <div className="bg-background rounded-xl border border-border/60 px-3 py-2.5">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1">Останній візит</p>
        <span className={cn("text-sm font-bold", profile.lastVisit ? "text-foreground" : "text-muted-foreground/40 italic")}>
          {profile.lastVisit || "Перший прийом"}
        </span>
        
      </div>

        {/* Row 6: Нотатки */}
      <div className="bg-background rounded-xl border border-border/60 px-3 py-2.5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Нотатки</p>
          <button onClick={() => onFocusEdit("notes", profile.notes, histories.notesHistory)} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-accent transition-all">
            <Pencil size={11} className="text-muted-foreground" />
          </button>
        </div>
        <button onClick={() => onFocusEdit("notes", profile.notes, histories.notesHistory)} className={cn("text-sm text-left w-full leading-relaxed transition-colors whitespace-pre-wrap", profile.notes ? "font-bold text-foreground hover:text-primary" : "italic text-muted-foreground/40")}>
          {profile.notes || "Додайте нотатки про пацієнта"}
        </button>
      </div>
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

  const getSegmentColor = (i: number): string => {
    // Determine if step is done, current, failed, or future
    const isDone = (dietInstructionSent && i === 0) || (step2AckResult === "confirmed" && i === 1) || preparation.steps[i]?.done;
    const isFailed = step2AckResult === "question" && i === 1;
    const isActive = !isDone && !isFailed && i === firstPendingIdx;
    
    if (isDone) return "bg-green-500"; // Completed: Solid Green
    if (isFailed) return "bg-red-500"; // Failed/Alert: Solid Red
    if (isActive) return "bg-yellow-500"; // Current: Solid Yellow (no pulsing)
    return "bg-gray-200"; // Future: Light Grey
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

// ── Files Pane — upload and manage documents ──
type FileItem = {
  id: string;
  name: string;
  type: "doctor" | "patient";
  date: string;
  url?: string;
  storageKey?: string;
  mimeType?: string;
  kind?: "video-link";   // external video URL (YouTube, Drive, iCloud, etc.)
};

type PreviewState =
  | { kind: "pdf"; name: string; blob: Blob; url?: string }
  | { kind: "docx"; name: string; blob: Blob }
  | { kind: "image"; name: string; url: string }   // URL-based — no blob fetch needed
  | { kind: "unsupported"; name: string; message: string };

const FILE_DB_NAME = "proctocare_files";
const FILE_STORE_NAME = "files";

function openFileDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FILE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FILE_STORE_NAME)) {
        db.createObjectStore(FILE_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putBlobToStorage(key: string, blob: Blob): Promise<void> {
  const db = await openFileDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILE_STORE_NAME, "readwrite");
    tx.objectStore(FILE_STORE_NAME).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getBlobFromStorage(key: string): Promise<Blob | null> {
  const db = await openFileDb();
  const result = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(FILE_STORE_NAME, "readonly");
    const req = tx.objectStore(FILE_STORE_NAME).get(key);
    req.onsuccess = () => resolve((req.result as Blob) || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

async function deleteBlobFromStorage(key: string): Promise<void> {
  const db = await openFileDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILE_STORE_NAME, "readwrite");
    tx.objectStore(FILE_STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// ── Helper: pick icon by file type ──
function FileTypeIcon({ file }: { file: FileItem }) {
  if (file.kind === 'video-link') {
    return <Play size={15} className="text-violet-500 shrink-0" />;
  }
  const ext = (file.name.toLowerCase().split('.').pop() || '');
  const mime = (file.mimeType || '').toLowerCase();
  if (mime.includes('pdf') || ext === 'pdf') {
    return <FileText size={15} className="text-red-500 shrink-0" />;
  }
  if (mime.startsWith('image/') || ['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) {
    return <FileImage size={15} className="text-emerald-500 shrink-0" />;
  }
  if (mime.includes('officedocument') || mime.includes('msword') || ['doc','docx'].includes(ext)) {
    return <FileText size={15} className="text-blue-500 shrink-0" />;
  }
  return <FileText size={15} className={file.type === 'doctor' ? 'text-primary shrink-0' : 'text-status-progress shrink-0'} />;
}

// ── Shared file row ──
function FileRow({ file, onDelete, onView, readOnly }: { file: FileItem; onDelete: () => void; onView: () => void; readOnly?: boolean }) {
  const subtitle = file.kind === 'video-link'
    ? `Відео · ${file.date}`
    : `${file.type === "doctor" ? "Лікар" : "Пацієнт"} · ${file.date}`;
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background border border-border/60">
      <FileTypeIcon file={file} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-foreground truncate">{file.name}</p>
        <p className="text-[10px] text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={onView}
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-accent active:scale-[0.9] transition-all" title="Переглянути">
          <Eye size={12} className="text-muted-foreground" />
        </button>
        {!readOnly && (
          <button onClick={onDelete}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-red-50 text-destructive/70 hover:text-destructive active:scale-[0.9] transition-all" title="Видалити">
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function PdfPreviewModal({ file, onClose }: { file: { name: string; blob: Blob; url?: string }; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [scale, setScale] = useState(1.1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const renderTaskRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof getDocument> | null = null;

    setLoading(true);
    setError(null);
    setPdfDoc(null);
    setPage(1);
    setPages(0);

    (async () => {
      try {
        const bytes = new Uint8Array(await file.blob.arrayBuffer());
        loadingTask = getDocument({
          data: bytes,
          useSystemFonts: true,
          isEvalSupported: false,
          enableXfa: false,
        });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setPages(doc.numPages || 0);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.error("PDF open failed", e);
        setError("Не вдалося відкрити PDF для перегляду");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (loadingTask) {
        try {
          loadingTask.destroy();
        } catch {
        }
      }
    };
  }, [file.blob]);

  useEffect(() => {
    if (!pdfDoc) return;

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {
          }
        }

        const currentPage = await pdfDoc.getPage(page);
        if (cancelled) return;

        const viewport = currentPage.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const renderTask = currentPage.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (!cancelled) setLoading(false);
      } catch (e) {
        const errorName = typeof e === "object" && e !== null && "name" in e ? String((e as { name?: string }).name) : "";
        if (!cancelled && errorName !== "RenderingCancelledException") {
          console.error("PDF render failed", e);
          setError("Не вдалося відкрити PDF для перегляду");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
        }
      }
    };
  }, [pdfDoc, page, scale]);

  useEffect(() => {
    return () => {
      if (pdfDoc) {
        try {
          pdfDoc.destroy();
        } catch {
        }
      }
    };
  }, [pdfDoc]);

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-[1px] flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-card w-full max-w-6xl h-[90vh] rounded-xl shadow-elevated overflow-hidden border border-border/60 flex flex-col">
        <div className="h-12 px-3 border-b border-border/60 flex items-center gap-2 shrink-0">
          <p className="text-sm font-bold text-foreground truncate pr-2 flex-1">{file.name}</p>

          <button
            onClick={() => setScale((s) => Math.max(0.7, +(s - 0.1).toFixed(2)))}
            className="px-2 py-1 text-xs font-bold rounded border border-border hover:bg-accent"
            title="Зменшити"
          >
            -
          </button>
          <span className="text-xs font-semibold text-muted-foreground w-12 text-center">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => setScale((s) => Math.min(2.5, +(s + 0.1).toFixed(2)))}
            className="px-2 py-1 text-xs font-bold rounded border border-border hover:bg-accent"
            title="Збільшити"
          >
            +
          </button>

          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading || !!error}
            className="px-2 py-1 text-xs font-bold rounded border border-border hover:bg-accent disabled:opacity-40"
          >
            Назад
          </button>
          <span className="text-xs font-semibold text-muted-foreground min-w-16 text-center">{pages > 0 ? `${page}/${pages}` : "0/0"}</span>
          <button
            onClick={() => setPage((p) => Math.min(pages || 1, p + 1))}
            disabled={loading || !!error || pages === 0 || page >= pages}
            className="px-2 py-1 text-xs font-bold rounded border border-border hover:bg-accent disabled:opacity-40"
          >
            Вперед
          </button>

          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-accent transition-colors"
            title="Закрити перегляд"
          >
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-muted/30 p-4">
          {error ? (
            <div className="h-full flex items-center justify-center text-sm text-destructive font-semibold">{error}</div>
          ) : (
            <div className="relative min-h-full flex justify-center items-start">
              <canvas
                ref={canvasRef}
                className={cn("bg-white rounded shadow-md max-w-full h-auto", loading ? "opacity-0" : "opacity-100")}
              />
              {loading ? (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Завантаження PDF...</div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ImagePreviewModal({ file, onClose }: { file: { name: string; url: string }; onClose: () => void }) {
  // Close on Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    // z-[200] — above all modals (PatientDetailView z-50, confirm dialogs z-[70], other previews z-[80])
    <div
      className="fixed inset-0 z-[200] bg-black/90 flex flex-col animate-fade-in"
      onClick={onClose}
    >
      {/* Header */}
      <div
        className="shrink-0 flex items-center justify-between px-4 py-3 bg-black/50 backdrop-blur-sm"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-white truncate pr-4 flex-1">{file.name}</p>
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/30 transition-colors"
          title="Закрити"
        >
          <X size={18} className="text-white" />
        </button>
      </div>
      {/* Image — fills remaining screen; touch pinch-zoom works natively */}
      <div
        className="flex-1 overflow-auto flex items-center justify-center p-2"
        onClick={e => e.stopPropagation()}
      >
        <img
          src={file.url}
          alt={file.name}
          className="max-w-full max-h-full object-contain select-none"
          style={{ touchAction: 'pinch-zoom' }}
          draggable={false}
        />
      </div>
    </div>
  );
}

function DocxPreviewModal({ file, onClose }: { file: { name: string; blob: Blob }; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [html, setHtml] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const arrayBuffer = await file.blob.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (cancelled) return;
        setHtml(result.value);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.error("DOCX preview failed", e);
        setError("Не вдалося відкрити Word-документ для перегляду");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file.blob]);

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-[1px] flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-card w-full max-w-5xl h-[90vh] rounded-xl shadow-elevated overflow-hidden border border-border/60 flex flex-col">
        <div className="h-12 px-3 border-b border-border/60 flex items-center gap-2 shrink-0">
          <p className="text-sm font-bold text-foreground truncate pr-2 flex-1">{file.name}</p>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-accent transition-colors" title="Закрити перегляд">
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>
        <div className="flex-1 overflow-auto bg-muted/20 p-6">
          {loading ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Завантаження документа...</div>
          ) : error ? (
            <div className="h-full flex items-center justify-center text-sm text-destructive font-semibold">{error}</div>
          ) : (
            <article className="mx-auto max-w-3xl bg-white rounded-lg shadow-sm p-8 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      </div>
    </div>
  );
}

function UnsupportedPreviewModal({ name, message, onClose }: { name: string; message: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-[1px] flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-card w-full max-w-xl rounded-xl shadow-elevated overflow-hidden border border-border/60 flex flex-col">
        <div className="h-12 px-3 border-b border-border/60 flex items-center gap-2 shrink-0">
          <p className="text-sm font-bold text-foreground truncate pr-2 flex-1">{name}</p>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-accent transition-colors" title="Закрити перегляд">
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>
        <div className="p-6 text-sm text-foreground leading-relaxed">{message}</div>
      </div>
    </div>
  );
}

// ── Clinical Timeline: groups documents & files by appointment date ──
function FilesPane({ files, onFilesChange, onFocusEdit, fromForm, protocolText, archivedProtocolText, protocolHistory, procedureHistory, historicalVisitDates, visitOutcomeByDate, currentVisitOutcome, activeVisitDate, onProtocolPrefill, visitId, relatedFiles, onDateClick }: {
  files: FileItem[];
  onFilesChange: (files: FileItem[]) => void;
  onFocusEdit: (field: string, value: string) => void;
  fromForm?: boolean;
  protocolText: string;
  /** Raw saved protocol from DB for the completed visit — used for archive block and copy button. */
  archivedProtocolText?: string;
  protocolHistory?: Array<{ value: string; timestamp: string; date: string }>;
  procedureHistory?: Array<{ value: string; timestamp: string; date: string }>;
  historicalVisitDates?: string[];
  visitOutcomeByDate?: Record<string, "completed" | "no-show">;
  currentVisitOutcome?: "completed" | "no-show";
  activeVisitDate: string;
  onProtocolPrefill: (value: string) => void;
  visitId?: string;
  /** Read-only files from related past visits — shown in archive section only, never saved to current visit. */
  relatedFiles?: FileItem[];
  /** If provided, historical visit date headers become clickable links to open that visit's card */
  onDateClick?: (displayDate: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<string | null>(null);
  const [confirmCopyProtocol, setConfirmCopyProtocol] = useState<{ value: string; date: string } | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showVideoInput, setShowVideoInput] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoName, setVideoName] = useState('');
  const [expandedProtocols, setExpandedProtocols] = useState<Set<string>>(new Set());

  const activeDate = activeVisitDate || isoToDisplay(getTodayIsoKyiv());

  // Group files by their date field.
  // relatedFiles are read-only (from other visits) and only appear in the archive.
  const filesByDate = useMemo(() => {
    const map = new Map<string, FileItem[]>();
    for (const f of [...files, ...(relatedFiles || [])]) {
      const d = f.date || activeDate;
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(f);
    }
    return map;
  }, [files, relatedFiles, activeDate]);

  // Set of dates that belong to definitively closed past visits.
  // Only dates in this set can trigger archiving of files.
  const pastVisitDateSet = useMemo(() => {
    const s = new Set<string>();
    for (const d of (historicalVisitDates || [])) s.add(d);
    for (const d of Object.keys(visitOutcomeByDate || {})) s.add(d);
    // When the current visit itself is closed, also treat activeDate as a past visit
    // so its files correctly move into the archive section.
    if (currentVisitOutcome) s.add(activeDate);
    return s;
  }, [historicalVisitDates, visitOutcomeByDate, currentVisitOutcome, activeDate]);

  // Map protocolHistory ISO dates → { displayDate: DD.MM.YYYY, value }
  const protocolByDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of (protocolHistory || [])) {
      if (h.value.startsWith(RESCHEDULED_MARKER)) continue;
      const parts = h.date?.split("-");
      if (parts?.length === 3) {
        const dd = `${parts[2]}.${parts[1]}.${parts[0]}`;
        map.set(dd, h.value);
      }
    }
    // For completed visits: if there is no protocolHistory entry for the active date,
    // fall back to archivedProtocolText (raw visits.protocol from DB) so the archive
    // section shows the text immediately without needing a protocol_history column.
    const archiveFallback = archivedProtocolText?.trim() || protocolText?.trim();
    if (currentVisitOutcome && archiveFallback && !map.has(activeDate)) {
      map.set(activeDate, archiveFallback);
    }
    return map;
  }, [protocolHistory, currentVisitOutcome, protocolText, archivedProtocolText, activeDate]);

  const rescheduledToByDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of (protocolHistory || [])) {
      if (!h.value.startsWith(RESCHEDULED_MARKER)) continue;
      const parts = h.date?.split("-");
      if (parts?.length === 3) {
        const dd = `${parts[2]}.${parts[1]}.${parts[0]}`;
        const targetIso = h.value.replace(RESCHEDULED_MARKER, "");
        map.set(dd, isoToDisplay(targetIso));
      }
    }
    return map;
  }, [protocolHistory]);

  const latestArchivedProtocol = useMemo(() => {
    const isCompleted = !!currentVisitOutcome;
    const entries = (protocolHistory || [])
      .filter((h) => !h.value.startsWith(RESCHEDULED_MARKER))
      .filter((h) => {
        const parts = h.date?.split("-");
        if (parts?.length !== 3) return false;
        const dd = `${parts[2]}.${parts[1]}.${parts[0]}`;
        // ONLY include entries from definitively closed visits (completed or no-show).
        // Planning/scheduled visits — even if their date is in the future — are excluded.
        // visitOutcomeByDate contains exactly those closed past dates.
        if ((visitOutcomeByDate || {})[dd] !== undefined) return true;
        // When the current open card is itself a completed/no-show visit, include its entries too.
        if (isCompleted && dd === activeDate) return true;
        return false;
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    // For completed visits: if the protocol text exists but isn't yet in history,
    // surface it directly so the copy button appears immediately after closing the visit.
    // Prefer archivedProtocolText (raw DB value) over protocolText (live editable state).
    const archiveSource = (archivedProtocolText?.trim() || protocolText?.trim());
    if (isCompleted && archiveSource) {
      const activeIso = displayToIso(activeDate);
      const hasEntryForActive = entries.some((e) => e.date === activeIso);
      if (!hasEntryForActive) {
        // Find the actual date of this protocol text in full history (don't use activeDate
        // blindly — it could be a future reschedule date that doesn't match the source text).
        const allNonMarkers = (protocolHistory || [])
          .filter((h) => !h.value.startsWith(RESCHEDULED_MARKER))
          .sort((a, b) => b.date.localeCompare(a.date));
        const matchingEntry = allNonMarkers.find((e) => e.value.trim() === archiveSource.trim());
        const fallbackDate = matchingEntry ? isoToDisplay(matchingEntry.date) : activeDate;
        return { value: archiveSource, date: fallbackDate };
      }
    }

    const latest = entries[0];
    if (!latest) return null;
    return {
      value: latest.value,
      date: isoToDisplay(latest.date),
    };
  }, [protocolHistory, activeDate, currentVisitOutcome, protocolText, visitOutcomeByDate]);

  const procedureByDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of (procedureHistory || [])) {
      const parts = h.date?.split("-");
      if (parts?.length === 3) {
        const dd = `${parts[2]}.${parts[1]}.${parts[0]}`;
        map.set(dd, h.value);
      }
    }
    return map;
  }, [procedureHistory]);

  // Collect all historical dates (not active), sorted descending.
  // File dates are only included if they belong to a definitively closed past visit.
  const historicalDates = useMemo(() => {
    const dates = new Set<string>();
    // Only add a file's date to history if it's a known past closed visit date
    for (const d of filesByDate.keys()) if (d !== activeDate && pastVisitDateSet.has(d)) dates.add(d);
    for (const d of protocolByDate.keys()) if (d !== activeDate && pastVisitDateSet.has(d)) dates.add(d);
    for (const d of procedureByDate.keys()) if (d !== activeDate && pastVisitDateSet.has(d)) dates.add(d);
    for (const d of rescheduledToByDate.keys()) if (d !== activeDate) dates.add(d);
    for (const d of (historicalVisitDates || [])) if (d !== activeDate) dates.add(d);
    for (const d of Object.keys(visitOutcomeByDate || {})) if (d !== activeDate) dates.add(d);
    if (currentVisitOutcome) dates.add(activeDate);
    return Array.from(dates).sort((a, b) => {
      const parse = (s: string) => {
        const [d, m, y] = s.split(".");
        return new Date(+y, +m - 1, +d).getTime();
      };
      return parse(b) - parse(a);
    });
  }, [filesByDate, protocolByDate, procedureByDate, rescheduledToByDate, historicalVisitDates, visitOutcomeByDate, currentVisitOutcome, activeDate, pastVisitDateSet]);

  // All historical dates start collapsed
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(() => new Set(historicalDates));

  useEffect(() => {
    setCollapsedDates(new Set(historicalDates));
  }, [historicalDates]);

  const toggleDate = (date: string) => {
    setCollapsedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  // For completed visits fields.protocol == patient.protocol (synced above),
  // so activeProtocolText naturally reflects whatever is in the DB.
  // The active block shows the saved conclusion; the copy button allows prefilling from history.
  const activeProtocolText = protocolText;
  // Include all files NOT belonging to a definitively closed past visit,
  // regardless of whether their date matches activeDate (handles rescheduled visits).
  const activeFiles = currentVisitOutcome ? [] : files.filter(f => !pastVisitDateSet.has(f.date || activeDate));

  const getFileExtension = (name: string): string => {
    const parts = name.toLowerCase().trim().split(".");
    return parts.length > 1 ? (parts.at(-1) || "").trim() : "";
  };

  const inferMimeFromName = (name: string): string => {
    const ext = getFileExtension(name);
    if (ext === "pdf") return "application/pdf";
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    if (ext === "gif") return "image/gif";
    if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (ext === "doc") return "application/msword";
    return "application/octet-stream";
  };

  const looksLikePdfBlob = async (blob: Blob): Promise<boolean> => {
    try {
      const head = await blob.slice(0, 5).text();
      return head === "%PDF-";
    } catch {
      return false;
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    console.log('[FileUpload] files selected:', e.target.files.length);
    setIsUploading(true);

    try {
      const uploaded = await Promise.all(Array.from(e.target.files).map(async (file) => {
        console.log('[FileUpload] processing:', file.name, 'size:', file.size, 'type:', file.type);
        const storageKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name}`;

        // Compress images before upload
        let fileToUpload: File = file;
        if (file.type.startsWith('image/')) {
          console.log('[FileUpload] compressing image…', { name: file.name, size: file.size, type: file.type });
          try {
            const compressed = await imageCompression(file, {
              maxSizeMB: 1,
              maxWidthOrHeight: 1920,
              useWebWorker: true,
            });
            // Always keep the original MIME type: compressed.type can be '' in some browsers
            const explicitType = file.type || inferMimeFromName(file.name);
            fileToUpload = new File([compressed], file.name, { type: explicitType });
            console.log('[FileUpload] compressed OK:', {
              originalSize: file.size,
              compressedSize: fileToUpload.size,
              type: fileToUpload.type,
            });
            if (fileToUpload.size === 0) {
              console.error('[FileUpload] ✗ compression produced empty blob, using original');
              fileToUpload = file;
            }
          } catch (compressErr) {
            console.warn('[FileUpload] compression failed, using original:', compressErr);
            fileToUpload = file;
          }
        } else {
          // PDF / TXT / DOC — skip compressor entirely
          console.log('[FileUpload] non-image file, skipping compression:', { name: file.name, size: file.size, type: file.type });
        }

        // Validate before upload
        if (fileToUpload.size === 0) {
          throw new Error(`Файл порожній (0 байт): ${file.name}`);
        }
        console.log('[FileUpload] pre-upload check OK:', {
          name: fileToUpload.name,
          size: fileToUpload.size,
          type: fileToUpload.type || '(empty type!)',
          visitId,
        });

        // Try Supabase Storage first (cross-device access)
        let publicUrl: string | undefined;
        if (visitId) {
          const url = await uploadFileToSupabaseStorage(visitId, fileToUpload);
          if (url) {
            publicUrl = url;
            console.log('[FileUpload] ✓ Supabase upload OK:', url);
          } else {
            console.warn('[FileUpload] ⚠️ Supabase returned null — file will be local only (check [Storage] errors above)');
          }
        } else {
          console.warn('[FileUpload] ⚠️ visitId is empty — Supabase upload skipped');
        }

        // Always keep IndexedDB copy as local cache / offline fallback
        // NOTE: IndexedDB is non-fatal — Supabase Storage is the source of truth
        try {
          console.log('[FileUpload] saving to IndexedDB…');
          await putBlobToStorage(storageKey, fileToUpload);
          console.log('[FileUpload] IndexedDB saved OK');
        } catch (idbErr) {
          console.warn('[FileUpload] ⚠️ IndexedDB save failed (non-fatal, file is in Supabase):', idbErr);
        }

        return {
          id: Math.random().toString(36).substring(7),
          name: file.name,
          type: "doctor" as const,
          date: activeDate,
          storageKey,
          url: publicUrl,
          mimeType: file.type || inferMimeFromName(file.name),
        } as FileItem;
      }));

      onFilesChange([...files, ...uploaded]);
    } catch (err) {
      console.error('[FileUpload] ✗ outer catch fired — full error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Не вдалося зберегти файл: ${msg}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSaveVideoLink = () => {
    const trimUrl = videoUrl.trim();
    if (!trimUrl) { toast.error('Введіть посилання на відео'); return; }
    // Basic URL validation
    try { new URL(trimUrl); } catch {
      toast.error('Невалідне посилання. Переконайтесь, що URL починається з https://');
      return;
    }
    const label = videoName.trim() || 'Відео матеріали';
    const newItem: FileItem = {
      id: Math.random().toString(36).substring(7),
      name: label,
      type: 'doctor',
      date: activeDate,
      url: trimUrl,
      kind: 'video-link',
    };
    onFilesChange([...files, newItem]);
    setVideoUrl('');
    setVideoName('');
    setShowVideoInput(false);
    toast.success('Посилання збережено');
  };

  const handleViewFile = async (file: FileItem) => {
    // ── video-link → open directly in new tab ──
    if (file.kind === 'video-link') {
      if (file.url) {
        window.open(file.url, '_blank', 'noopener,noreferrer');
      } else {
        toast.error('Посилання відсутнє');
      }
      return;
    }
    try {
      const ext = getFileExtension(file.name);
      const mime = (file.mimeType || '').toLowerCase();
      const isPdf   = mime.includes('pdf') || ext === 'pdf';
      const isImage = mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
      const isDocx  = mime.includes('officedocument.wordprocessingml.document') || ext === 'docx';

      console.log('[handleViewFile]', { name: file.name, mimeType: file.mimeType, url: file.url, storageKey: file.storageKey, isPdf, isImage, isDocx });

      // ── Step 1: resolve the best URL available ──
      let viewUrl = file.url;
      if (!viewUrl && visitId) {
        console.log('[handleViewFile] URL missing, resolving from Supabase Storage…');
        viewUrl = (await resolveVisitFilePublicUrl(visitId, file.name)) ?? undefined;
        if (viewUrl) {
          console.log('[handleViewFile] resolved URL:', viewUrl);
          // Persist so next open is instant
          onFilesChange(files.map(f => f.id === file.id ? { ...f, url: viewUrl } : f));
        }
      }

      // ── PDF → always open in new browser tab (most reliable on iOS/Android/desktop) ──
      // Never use setPreview for PDFs — canvas renderer causes grey screen on mobile.
      if (isPdf) {
        let urlToOpen = viewUrl;
        if (!urlToOpen && file.storageKey) {
          // Fallback: local IndexedDB blob → object URL (current session only)
          const blob = await getBlobFromStorage(file.storageKey).catch(() => null);
          if (blob) {
            urlToOpen = URL.createObjectURL(blob);
            console.log('[handleViewFile] PDF → object URL from IndexedDB blob');
          } else {
            console.warn('[handleViewFile] ⚠️ blob NOT found in IndexedDB for key:', file.storageKey);
          }
        }
        if (urlToOpen) {
          console.log('[handleViewFile] PDF → window.open', urlToOpen);
          const newWindow = window.open(urlToOpen, '_blank', 'noopener,noreferrer');
          if (newWindow) newWindow.focus();
          return;
        }
        // Both Supabase URL and IndexedDB empty — file was from a previous session without cloud upload
        console.error('[handleViewFile] ✗ PDF has no URL and no local blob:', file);
        toast.error('PDF недоступний. Файл збережений лише локально у попередній сесії. Видаліть і завантажте знову.', { duration: 6000 });
        return;
      }

      // ── Image → Lightbox (URL-based, no fetch/blob download needed) ──
      if (isImage) {
        if (viewUrl) {
          console.log('[handleViewFile] Image → Lightbox', viewUrl);
          setPreview({ kind: 'image', name: file.name, url: viewUrl });
          return;
        }
        // Fallback: local blob → object URL
        const blob = await getBlobFromStorage(file.storageKey ?? '').catch(() => null);
        if (blob) {
          setPreview({ kind: 'image', name: file.name, url: URL.createObjectURL(blob) });
          return;
        }
        toast.error('Зображення недоступне. Спробуйте завантажити повторно.');
        return;
      }

      // ── DOCX → blob → mammoth renderer ──
      if (isDocx) {
        let blob: Blob | null = file.storageKey
          ? await getBlobFromStorage(file.storageKey).catch(() => null)
          : null;
        if (!blob && viewUrl) {
          try {
            const res = await fetch(viewUrl, { cache: 'no-store' });
            if (res.ok) blob = await res.blob();
          } catch { /* silent */ }
        }
        if (blob) { setPreview({ kind: 'docx', name: file.name, blob }); return; }
        setPreview({ kind: 'unsupported', name: file.name, message: 'Не вдалося завантажити DOCX для перегляду. Спробуйте ще раз.' }); return;
      }

      // ── .doc (legacy binary) ──
      if ((mime.includes('msword') || ext === 'doc')) {
        setPreview({ kind: 'unsupported', name: file.name, message: 'Формат .doc є застарілим. Збережіть як .docx, і він відкриється прямо всередині додатку.' }); return;
      }

      setPreview({ kind: 'unsupported', name: file.name, message: 'Цей формат не підтримується. Доступні: PDF, зображення (JPG/PNG/WebP), DOCX.' });
    } catch (err) {
      console.error('[handleViewFile] ✗ unexpected error:', err);
      toast.error('Не вдалося відкрити файл. Спробуйте ще раз.');
    }
  };

  return (
    <div className="pb-4 relative">
      {preview?.kind === "pdf" && <PdfPreviewModal file={preview} onClose={() => setPreview(null)} />}
      {preview?.kind === "image" && <ImagePreviewModal file={preview} onClose={() => setPreview(null)} />}
      {preview?.kind === "docx" && <DocxPreviewModal file={preview} onClose={() => setPreview(null)} />}
      {preview?.kind === "unsupported" && <UnsupportedPreviewModal name={preview.name} message={preview.message} onClose={() => setPreview(null)} />}

      {/* Delete confirmation dialog */}
      {confirmDeleteFile && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/20 backdrop-blur-sm animate-fade-in" onClick={() => setConfirmDeleteFile(null)}>
          <div className="bg-surface-raised rounded-xl shadow-elevated p-5 mx-4 max-w-sm w-full animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-foreground mb-1">Видалити файл?</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Ви впевнені, що хочете видалити файл «{files.find(f => f.id === confirmDeleteFile)?.name}»?
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => setConfirmDeleteFile(null)} className="flex-1 py-2.5 text-sm font-bold text-muted-foreground border border-border rounded-lg hover:bg-muted/40 transition-colors active:scale-[0.97]">Скасувати</button>
              <button onClick={async () => {
                const fileToDelete = files.find((x) => x.id === confirmDeleteFile);
                if (fileToDelete?.storageKey) {
                  try {
                    await deleteBlobFromStorage(fileToDelete.storageKey);
                  } catch (err) {
                    console.error("Failed to delete file from local storage", err);
                  }
                }
                if (fileToDelete?.url) {
                  void deleteFileFromSupabaseStorage(fileToDelete.url);
                }
                onFilesChange(files.filter(x => x.id !== confirmDeleteFile));
                setConfirmDeleteFile(null);
              }}
                className="flex-1 py-2.5 text-sm font-bold bg-destructive text-destructive-foreground rounded-lg transition-colors active:scale-[0.97]">Видалити</button>
            </div>
          </div>
        </div>
      )}

      {confirmCopyProtocol && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/20 backdrop-blur-sm animate-fade-in" onClick={() => setConfirmCopyProtocol(null)}>
          <div className="bg-surface-raised rounded-xl shadow-elevated p-5 mx-4 max-w-sm w-full animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-foreground mb-1">Замінити поточний висновок?</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Це замінить ваш поточний текст текстом від {confirmCopyProtocol.date}. Продовжити?
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setConfirmCopyProtocol(null)}
                className="flex-1 py-2.5 text-sm font-bold text-muted-foreground border border-border rounded-lg hover:bg-muted/40 transition-colors active:scale-[0.97]"
              >
                Скасувати
              </button>
              <button
                onClick={() => {
                  onProtocolPrefill(confirmCopyProtocol.value);
                  setConfirmCopyProtocol(null);
                  toast.success(`Висновок від ${confirmCopyProtocol.date} скопійовано`);
                }}
                className="flex-1 py-2.5 text-sm font-bold bg-status-ready text-white rounded-lg transition-colors active:scale-[0.97]"
              >
                Замінити
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="relative px-4">
        {/* ── Current Visit (active work zone — always visible, content empty when completed) ── */}
        <div className={cn("relative mb-4", currentVisitOutcome ? "pt-1" : "pl-8")}>
          {!currentVisitOutcome && (
            <div className="absolute left-0 top-[3px] w-3.5 h-3.5 rounded-full border-2 border-white shadow-sm bg-primary" />
          )}

          {/* Header — only shown for active (non-completed) visit */}
          {!currentVisitOutcome && (
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[11px] font-bold text-primary">{formatDateUkrainian(activeDate)}</span>
              {displayToIso(activeDate) < getTodayIsoKyiv() && (
                <span className="ml-auto text-[8px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full shrink-0 uppercase tracking-wide">⚠ Незавершений прийом</span>
              )}
            </div>
          )}

          {/* ВИСНОВОК ЛІКАРЯ — soft highlighted border, editable */}
          <div className="rounded-lg border-2 border-[hsl(204,100%,80%)] bg-[hsl(204,100%,97%)] p-3 space-y-2 mb-2.5 relative">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <FileText size={12} className="text-primary" />
                Висновок лікаря
              </h4>
              <div className="flex items-center gap-1">
                {/* Copy button — visible when there is archived data AND doctor hasn't typed manually yet */}
                {latestArchivedProtocol && !activeProtocolText.trim() && (
                  <button
                    onClick={() => {
                      if (activeProtocolText.trim()) {
                        // Field has content → show confirmation dialog
                        setConfirmCopyProtocol({ value: latestArchivedProtocol.value, date: latestArchivedProtocol.date });
                      } else {
                        // Field is empty → copy immediately, no confirmation
                        onProtocolPrefill(latestArchivedProtocol.value);
                        toast.success(`Висновок від ${latestArchivedProtocol.date} скопійовано`);
                      }
                    }}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 hover:bg-sky-100 rounded-md px-1.5 py-0.5 transition-colors shrink-0"
                    title={`Скопіювати висновок від ${latestArchivedProtocol.date}`}
                  >
                    <ClipboardList size={11} className="shrink-0" />
                    <span className="hidden sm:inline">Скопіювати</span>
                    <span>({latestArchivedProtocol.date})</span>
                  </button>
                )}
                <button onClick={() => onFocusEdit("protocol", activeProtocolText)}
                  className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-accent active:scale-[0.9] transition-all">
                  <Pencil size={11} className="text-muted-foreground" />
                </button>
              </div>
            </div>
            {activeProtocolText ? (
              <button
                onClick={() => onFocusEdit("protocol", activeProtocolText)}
                className="w-full text-left text-sm leading-relaxed text-foreground line-clamp-3 hover:opacity-75 transition-opacity cursor-pointer"
              >
                {activeProtocolText}
              </button>
            ) : (
              <div className="space-y-2">
                <button
                  onClick={() => onFocusEdit("protocol", "")}
                  className="text-sm leading-relaxed text-muted-foreground/40 italic text-left w-full hover:text-muted-foreground/60 transition-colors"
                >
                  Натисніть, щоб заповнити висновок...
                </button>
              </div>
            )}
          </div>

          {/* Files for today */}
          {activeFiles.length > 0 && (
            <div className="space-y-1.5 mb-2.5">
              {activeFiles.map(file => (
                <FileRow key={file.id} file={file}
                  onDelete={() => setConfirmDeleteFile(file.id)}
                  onView={() => handleViewFile(file)} />
              ))}
            </div>
          )}

          {/* Upload — current visit only */}
          <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple className="hidden"
            accept="image/*, .pdf, .doc, .docx, .xls, .xlsx, .txt" />

          {/* Two action buttons side by side */}
          <div className="flex gap-2">
            <button
              onClick={() => !isUploading && fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold text-primary bg-transparent border border-primary/30 hover:bg-primary/5 rounded-lg py-2 transition-colors active:scale-[0.97] disabled:opacity-60 disabled:pointer-events-none"
            >
              {isUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              {isUploading ? "Завантаження..." : "Завантажити файл"}
            </button>
            <button
              onClick={() => { setShowVideoInput(v => !v); setVideoUrl(''); setVideoName(''); }}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold text-violet-600 bg-transparent border border-violet-300 hover:bg-violet-50 rounded-lg py-2 transition-colors active:scale-[0.97]"
            >
              <Link size={13} />
              Додати відео
            </button>
          </div>

          {/* Inline video-link form */}
          {showVideoInput && (
            <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 space-y-2 animate-fade-in">
              <p className="text-[11px] font-semibold text-violet-700">Посилання на відео</p>
              <input
                type="text"
                placeholder="Назва (необов'язково)"
                value={videoName}
                onChange={e => setVideoName(e.target.value)}
                className="w-full text-xs rounded-md border border-border/60 bg-background px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-violet-400"
              />
              <input
                type="url"
                placeholder="https://drive.google.com/..."
                value={videoUrl}
                onChange={e => setVideoUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveVideoLink()}
                className="w-full text-xs rounded-md border border-border/60 bg-background px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-violet-400"
                autoFocus
              />
              <div className="flex gap-2 pt-0.5">
                <button
                  onClick={() => { setShowVideoInput(false); setVideoUrl(''); setVideoName(''); }}
                  className="flex-1 py-1.5 text-xs font-bold text-muted-foreground border border-border rounded-lg hover:bg-muted/40 transition-colors"
                >
                  Скасувати
                </button>
                <button
                  onClick={handleSaveVideoLink}
                  className="flex-1 py-1.5 text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors active:scale-[0.97]"
                >
                  Зберегти посилання
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Historical Visits (collapsible) ── */}
        {historicalDates.map((date) => {
          const isCollapsed = collapsedDates.has(date);
          const dateFiles = filesByDate.get(date) || [];
          const dateProtocol = protocolByDate.get(date);
          const dateProcedure = procedureByDate.get(date);
          const dateOutcome = date === activeDate ? currentVisitOutcome : visitOutcomeByDate?.[date];
          const rescheduledTo = rescheduledToByDate.get(date);
          const isFrozen = !!rescheduledTo;

          return (
            <div key={date} className="relative pl-8 mb-3">
              {/* Muted dot for past visit */}
              <div className="absolute left-0 top-[3px] w-3.5 h-3.5 rounded-full bg-muted-foreground/25 border-2 border-white" />

              {/* Collapsible header */}
              <div className="flex items-center gap-1.5 mb-1">
                <button onClick={() => toggleDate(date)}
                  className="flex-1 flex items-center gap-1.5 text-left group min-w-0">
                  <span className="text-[11px] font-semibold text-muted-foreground truncate">{formatDateUkrainian(date)}</span>
                  {isFrozen && (
                    <span className="text-[9px] font-bold text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded-full uppercase tracking-wide shrink-0">Перенесено</span>
                  )}
                  <ChevronDown size={11} className={cn(
                    "ml-auto text-muted-foreground/50 transition-transform duration-200 shrink-0",
                    !isCollapsed && "rotate-180"
                  )} />
                </button>
                {onDateClick && (
                  <button
                    onClick={() => onDateClick(date)}
                    title="Відкрити картку цього візиту"
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-accent transition-colors"
                  >
                    <ChevronRight size={12} className="text-muted-foreground/60 hover:text-primary transition-colors" />
                  </button>
                )}
              </div>

              {/* Expanded content — read-only archive */}
              {!isCollapsed && (
                <div className={cn("space-y-1.5 pt-0.5 rounded-lg p-2", isFrozen && "bg-slate-100 border border-slate-200")}>
                  {isFrozen && (
                    <div className="rounded-lg border border-slate-300 bg-slate-50 p-2.5">
                      <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wide mb-1">Статус</p>
                      <p className="text-xs font-semibold text-slate-700">Перенесено: {rescheduledTo}</p>
                    </div>
                  )}
                  {dateOutcome === "no-show" && !isFrozen && (
                    <div className="rounded-lg p-2.5 border border-status-risk/35 bg-status-risk-bg">
                      <p className="text-[10px] font-bold text-status-risk uppercase tracking-wide mb-1">Статус</p>
                      <p className="text-xs font-semibold text-status-risk">Не з'явився на прийом</p>
                    </div>
                  )}
                  {dateProcedure && (
                    <div className="rounded-lg border border-sky-200 bg-sky-50 p-2.5">
                      <p className="text-[10px] font-bold text-sky-700 uppercase tracking-wide mb-1">Послуга</p>
                      <p className="text-xs font-semibold text-sky-900">{dateProcedure}</p>
                    </div>
                  )}
                  {dateProtocol && (
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1">Висновок лікаря</p>
                      <p className={cn(
                        "text-xs leading-relaxed text-foreground/80",
                        !expandedProtocols.has(date) && "line-clamp-3"
                      )}>
                        {dateProtocol}
                      </p>
                      {(dateProtocol.split('\n').length > 3 || dateProtocol.length > 200) && (
                        <button
                          onClick={() => setExpandedProtocols(prev => {
                            const next = new Set(prev);
                            if (next.has(date)) next.delete(date); else next.add(date);
                            return next;
                          })}
                          className="mt-1.5 text-[10px] font-semibold text-sky-600 hover:text-sky-700 hover:underline transition-colors"
                        >
                          {expandedProtocols.has(date) ? "Згорнути" : "Читати далі..."}
                        </button>
                      )}
                    </div>
                  )}
                  {dateFiles.map(file => (
                    <FileRow key={file.id} file={file} readOnly
                      onDelete={() => setConfirmDeleteFile(file.id)}
                      onView={() => handleViewFile(file)} />
                  ))}
                  {!dateProtocol && dateFiles.length === 0 && !isFrozen && !dateOutcome && (
                    <p className="text-[11px] text-muted-foreground/40 italic">Немає записів</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Services Pane — uses full ProcedureSelector overlay ──

function ServicesPane({ services, onServicesChange, showFloatingEdit = true }: { services: string[]; onServicesChange: (s: string[]) => void; showFloatingEdit?: boolean }) {
  const [showSelector, setShowSelector] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <div className="px-4 pb-4 space-y-2 relative">
      {showFloatingEdit && (
        <button
          onClick={() => setShowSelector(true)}
          className="absolute -top-10 right-4 w-6 h-6 flex items-center justify-center rounded-full hover:bg-accent transition-all z-10"
        >
          <Pencil size={11} className="text-muted-foreground" />
        </button>
      )}

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/20 backdrop-blur-sm animate-fade-in" onClick={() => setConfirmDelete(null)}>
          <div className="bg-surface-raised rounded-xl shadow-elevated p-5 mx-4 max-w-sm w-full animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-foreground mb-1">Видалити послугу?</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Ви впевнені, що хочете видалити «{confirmDelete}»?
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2.5 text-sm font-bold text-muted-foreground border border-border rounded-lg hover:bg-muted/40 transition-colors active:scale-[0.97]"
              >
                Скасувати
              </button>
              <button
                onClick={() => {
                  onServicesChange(services.filter((x) => x !== confirmDelete));
                  setConfirmDelete(null);
                }}
                className="flex-1 py-2.5 text-sm font-bold bg-destructive text-destructive-foreground rounded-lg transition-colors active:scale-[0.97]"
              >
                Видалити
              </button>
            </div>
          </div>
        </div>
      )}

      {services.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-4 pb-2 pt-1">
          {services.map((s) => (
            <button
              key={s}
              onClick={() => setConfirmDelete(s)}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full transition-all active:scale-[0.96]"
              style={{ backgroundColor: "#E3F2FD", color: "#1565C0" }}
              title="Натисніть для видалення"
            >
              {s}
              <X size={11} className="shrink-0 opacity-60" />
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground py-2 px-4 text-center">Послуги не додані</p>
      )}
      {showSelector && (
        <ProcedureSelector
          selected={services}
          onConfirm={(sel) => {
            onServicesChange(sel);
            setShowSelector(false);
          }}
          onClose={() => setShowSelector(false)}
        />
      )}
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

function ChatPane({ chat, unanswered, onQuickReply }: {
  chat: ChatMessage[];
  unanswered: ChatMessage[];
  onQuickReply?: (answer: "yes" | "no", context?: "greeting" | "diet") => void;
}) {
  // Filter out all system messages from the main chat display (moved to History modal)
  const activeMessages = chat.filter((m) => !m.unanswered && !(m.sender === "ai" && (m.text.includes("Підготовку") || m.text.includes("Вітальне") || m.text.includes("перезапущено"))));
  
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
            <span className="text-xs font-bold text-status-risk">
              Питання без відповіді · {msg.time}
            </span>
          </div>
          <p className="text-foreground font-bold">{msg.text}</p>
        </div>
      ))}

      {/* Chat history — Telegram-style bubbles */}
      {activeMessages.map((msg, i) => {
        const isPatient = msg.sender === "patient";
        const isDoctor = msg.sender === "doctor";
        const isAssistant = msg.sender === "ai";
        
        return (
          <div key={i} className={cn("flex flex-col", isPatient ? "items-start" : "items-end")}>
            <div
              className={cn(
                "rounded-2xl px-4 py-2.5 text-sm leading-relaxed max-w-[86%] shadow-[0_2px_8px_rgba(0,0,0,0.07)] whitespace-pre-wrap",
                isDoctor
                  ? "bg-green-100 border border-green-300 rounded-br-sm text-green-900" // Doctor: Light Green, right
                  : isPatient
                    ? "bg-white border border-gray-300 rounded-bl-sm text-gray-900" // Patient: Pure White, left
                    : "bg-yellow-50 border border-yellow-300 rounded-bl-sm text-yellow-900" // Assistant: Light Beige/Yellow, left
              )}
            >
              <p className={cn(
                "text-[11px] font-bold mb-0.5",
                isDoctor ? "text-green-700" : isPatient ? "text-gray-600" : "text-yellow-700"
              )}>
                {isDoctor ? "Лікар" : isPatient ? "Клієнт" : "Асистент"} · {msg.time}
              </p>
              <p className="text-foreground">
                {renderBoldText(msg.text)}
              </p>
            </div>
            {msg.quickReply && onQuickReply && (
              <div className="flex gap-2 mt-1.5">
                <button
                  onClick={() => onQuickReply("yes", msg.quickReply?.context)}
                  className="text-[12px] font-bold px-3 py-1.5 rounded-full bg-sky-600 text-white hover:bg-sky-700 active:scale-[0.94] transition-all shadow-sm"
                >
                  {msg.quickReply.yes}
                </button>
                <button
                  onClick={() => onQuickReply("no", msg.quickReply?.context)}
                  className="text-[12px] font-bold px-3 py-1.5 rounded-full bg-white border border-slate-200 text-foreground hover:bg-slate-50 active:scale-[0.94] transition-all shadow-sm"
                >
                  {msg.quickReply.no}
                </button>
              </div>
            )}
          </div>
        );
      })}
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

