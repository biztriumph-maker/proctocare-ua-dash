import { useState, useRef, useEffect, useMemo } from "react";
import { X, MessageCircle, AlertTriangle, User, Activity, Phone, Mic, Pencil, FileText, Upload, Eye, Trash2, ClipboardList, ChevronRight, ChevronDown, Check, Clock, Calendar, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { correctNameSpelling } from "@/lib/nameCorrection";
import type { Patient, PatientStatus, HistoryEntry } from "./PatientCard";
import { computePatientStatus, AllergyShield } from "./PatientCard";
import { useIsMobile } from "@/hooks/use-mobile";
import { Progress } from "@/components/ui/progress";
import { ProcedureSelector } from "./ProcedureSelector";
import { CalendarView } from "./CalendarView";
import { toast } from "sonner";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf";
import mammoth from "mammoth";

GlobalWorkerOptions.workerSrc = "";

interface ChatMessage {
  sender: "ai" | "patient" | "doctor";
  text: string;
  time: string;
  unanswered?: boolean;
  quickReply?: { yes: string; no: string; context?: "greeting" | "diet" };
}

interface PatientDetailViewProps {
  patient: Patient;
  onClose: () => void;
  onUpdatePatient?: (updates: Partial<Patient>) => void;
  onDelete?: (patientId: string) => void;
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
  const digits = value.replace(/\D/g, "");
  if (!digits) return "+380";

  let localPart = digits;
  if (localPart.startsWith("380")) localPart = localPart.slice(3);
  else if (localPart.startsWith("0")) localPart = localPart.slice(1);

  localPart = localPart.slice(0, 9);
  return `+380${localPart}`;
}

function getStorablePhone(value: string): string {
  const normalized = normalizePhoneWithPlus(value);
  return normalized === "+380" ? "" : normalized;
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

function formatDateUkrainian(ddmmyyyy: string): string {
  const months = ["січня","лютого","березня","квітня","травня","червня","липня","серпня","вересня","жовтня","листопада","грудня"];
  const [d, m, y] = ddmmyyyy.split(".");
  if (!d || !m || !y) return ddmmyyyy;
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1] ?? ""} ${y}`;
}

function isPetushkovMockPatient(patient: Patient): boolean {
  return patient.name.toLowerCase().includes("петушков");
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
  // Viber Ukraine: +380 followed by exactly 9 digits
  return /^\+380\d{9}$/.test(phone.replace(/\s/g, ""));
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
  return {
    birthDate: birthDateStr,
    age: ageStr,
    phone: patient.phone || (patient.fromForm ? "" : "+380 67 123 45 67"),
    allergies: patient.allergies || (patient.fromForm ? "" : "Пеніцилін"),
    diagnosis: patient.diagnosis || (patient.fromForm ? "" : "Поліп сигмовидної кишки (K63.5)"),
    lastVisit: patient.lastVisit || (patient.fromForm ? "" : "12.01.2026"),
    notes: patient.notes || patient.primaryNotes || (patient.fromForm ? "" : "Хронічний гастрит. Приймає омепразол 20мг."),
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

export function PatientDetailView({ patient, onClose, onUpdatePatient, onDelete }: PatientDetailViewProps) {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<"card" | "assistant" | "files">("card");
  const [focusField, setFocusField] = useState<{ field: string; value: string; history?: HistoryEntry[] } | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [localFullName, setLocalFullName] = useState(() => {
    const raw = `${patient.name}${patient.patronymic ? ` ${patient.patronymic}` : ""}`;
    return correctNameSpelling(raw);
  });
  const nameInputRef = useRef<HTMLInputElement>(null);
  const profile = getMockProfile(patient);
  const activeVisitIso = patient.date || getTodayIsoKyiv();
  const activeVisitDisplayDate = isoToDisplay(activeVisitIso);
  
  const initialNotes = patient.notes !== undefined ? patient.notes : profile.notes;
  const initialProtocol = getInitialActiveProtocol(patient, activeVisitIso);
  const initialPhone = patient.phone || profile.phone;
  const initialServices = patient.procedure ? patient.procedure.split(", ") : [];

  const [fields, setFields] = useState({
    phone: initialPhone,
    allergies: profile.allergies,
    diagnosis: profile.diagnosis,
    notes: initialNotes,
    protocol: initialProtocol,
    birthDate: profile.birthDate,
  });

  const [localServices, setLocalServices] = useState<string[]>(initialServices);
  const [showReschedulePicker, setShowReschedulePicker] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState(patient.date || new Date().toISOString().slice(0, 10));
  const [rescheduleTime, setRescheduleTime] = useState(patient.time || "");
  const restoredAssistantSession = getAssistantSession(patient.id, activeVisitIso);

  useEffect(() => {
    setRescheduleDate(patient.date || new Date().toISOString().slice(0, 10));
    setRescheduleTime(patient.time || "");
  }, [patient.id, patient.date, patient.time]);

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

  const serviceCategory = getServiceCategory(localServices);

  const _now = new Date();
  const todayStr = `${String(_now.getDate()).padStart(2, "0")}.${String(_now.getMonth() + 1).padStart(2, "0")}.${_now.getFullYear()}`;
  const seededProtocolHistory = getSeededMockProtocolHistory(patient);
  const seededProcedureHistory = getSeededMockProcedureHistory(patient);
  const seededFiles = getSeededMockFiles(patient);
  const mergedProtocolHistory = patient.fromForm
    ? mergeUniqueHistoryEntries(patient.protocolHistory, seededProtocolHistory)
    : mergeUniqueHistoryEntries([...MOCK_PROTOCOL_HISTORY, ...(patient.protocolHistory || [])], seededProtocolHistory);
  const mergedProcedureHistory = mergeUniqueHistoryEntries(patient.procedureHistory, seededProcedureHistory);
  const initialFiles = mergeUniqueFileItems(patient.files || (patient.fromForm ? [] : getMockFiles(todayStr)), seededFiles);
  const [localFiles, setLocalFiles] = useState<FileItem[]>(initialFiles);

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

  // Derive lastVisit only from explicit historical visit records (seeded/completed visits),
  // NOT from procedureHistory (which is an operational change log written by auto-save).
  const derivedLastVisit = (() => {
    const currentDate = patient.date || "9999-99-99";
    const allDates = [
      ...seededProcedureHistory.map(e => e.date),
      ...seededProtocolHistory.map(e => e.date),
    ].filter(d => d < currentDate).sort().reverse();
    if (!allDates.length) return "";
    const [y, m, d2] = allDates[0].split("-");
    return `${d2}.${m}.${y}`;
  })();
  const mergedProfile = { ...profile, ...fields, lastVisit: derivedLastVisit || profile.lastVisit };

  const hasUnsavedChanges = 
    fields.notes !== initialNotes || 
    fields.protocol !== initialProtocol || 
    fields.phone !== initialPhone ||
    fields.allergies !== profile.allergies ||
    fields.diagnosis !== profile.diagnosis ||
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

  const handleFocusOpen = (field: string, value: string, history?: HistoryEntry[]) => {
    setFocusField({ field, value, history });
  };

  const handleNameBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();
    if (!raw) { setEditingName(false); return; }
    const corrected = correctNameSpelling(raw);
    setLocalFullName(corrected);
    setEditingName(false);
    if (corrected !== raw) {
      const parts = corrected.trim().split(/\s+/);
      const newName = parts.slice(0, 2).join(" ");
      const newPatronymic = parts.slice(2).join(" ");
      if (onUpdatePatient) onUpdatePatient({ name: newName, patronymic: newPatronymic || undefined });
    }
  };

  const handleFocusSave = (value: string) => {
    if (focusField) {
      const trimmedValue = value.trim();
      const preparedValue = focusField.field === "phone" ? getStorablePhone(trimmedValue) : trimmedValue;
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
    }
    setFocusField(null);
  };

  const handleFocusCancel = () => {
    setFocusField(null);
  };

  const handleCloseRequest = () => {
    handleSaveChanges();
    onClose();
  };

  const handleApplyReschedule = () => {
    if (!onUpdatePatient || !rescheduleDate || !rescheduleTime) return;

    const previousVisitIso = patient.date || getTodayIsoKyiv();
    const previousVisitDisplay = isoToDisplay(previousVisitIso);
    const hasProtocolInCurrentBlock = !!fields.protocol.trim();
    const hasFilesInCurrentBlock = localFiles.some((file) => (file.date || activeVisitDisplayDate) === previousVisitDisplay);
    const hasDataToFreeze = hasProtocolInCurrentBlock || hasFilesInCurrentBlock;

    if (!hasDataToFreeze) {
      // Silent reschedule: nothing was documented yet for the current block.
      onUpdatePatient({ date: rescheduleDate, time: rescheduleTime });
      setShowReschedulePicker(false);

      const d = new Date(rescheduleDate + "T00:00:00");
      const formatted = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
      toast.success(`Прийом перенесено: ${formatted} · ${rescheduleTime}`);
      return;
    }

    // Freeze old active block into archive and create a fresh active block for the new date.
    const frozenProtocolHistory = hasProtocolInCurrentBlock
      ? [...(patient.protocolHistory || []), { value: fields.protocol.trim(), timestamp: previousVisitDisplay, date: previousVisitIso }]
      : patient.protocolHistory;
    const freezeReasonEntry = {
      value: `${RESCHEDULED_MARKER}${rescheduleDate}`,
      timestamp: previousVisitDisplay,
      date: previousVisitIso,
    };

    onUpdatePatient({
      date: rescheduleDate,
      time: rescheduleTime,
      protocol: "",
      protocolHistory: [...(frozenProtocolHistory || []), freezeReasonEntry],
      status: "planning",
    });

    setFields((prev) => ({ ...prev, protocol: "" }));
    setShowReschedulePicker(false);

    const d = new Date(rescheduleDate + "T00:00:00");
    const formatted = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
    toast.success(`Прийом перенесено: ${formatted} · ${rescheduleTime}`);
  };

  const autoSaveMounted = useRef(false);
  useEffect(() => {
    if (!autoSaveMounted.current) {
      autoSaveMounted.current = true;
      return;
    }
    if (!onUpdatePatient) return;
    const timer = setTimeout(() => handleSaveChanges(true), 1200);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, localFiles, localServices]);

  const handleSaveChanges = (silent = false) => {
    if (onUpdatePatient) {
      const hasTodayHistoryEntry = (history?: Array<{ value: string; timestamp: string; date: string }>) => {
        if (!history || history.length === 0) return false;
        return history[history.length - 1]?.date === getTodayIsoKyiv();
      };

      const allergiesHistory = (fields.allergies !== (patient.allergies || "")) || (!fields.allergies.trim() && hasTodayHistoryEntry(patient.allergiesHistory))
        ? addHistoryEntry(patient.allergiesHistory, fields.allergies)
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

      onUpdatePatient({
        notes: fields.notes,
        protocol: fields.protocol,
        phone: getStorablePhone(fields.phone),
        allergies: fields.allergies,
        diagnosis: fields.diagnosis,
        birthDate: fields.birthDate,
        procedure: procedureValue,
        files: localFiles,
        allergiesHistory,
        diagnosisHistory,
        notesHistory,
        phoneHistory,
        birthDateHistory,
        protocolHistory,
        procedureHistory,
      });
      if (!silent) toast.success("Дані пацієнта успішно збережено");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-fade-in" onClick={handleCloseRequest} />


      <div className={cn(
        "relative w-full bg-[hsl(210,40%,96%)] rounded-t-2xl sm:rounded-2xl shadow-2xl animate-slide-up safe-bottom max-h-[92vh] overflow-hidden flex flex-col",
        "max-w-[90vw]"
      )}>
        {/* Handle (mobile) */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/25" />
        </div>

        {/* Sticky Header */}
        <div className="flex items-start justify-between px-5 sm:px-6 pb-3 pt-2 sm:pt-5 border-b border-border/60 bg-card rounded-t-2xl">
          <div className="min-w-0 flex-1">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <span className={cn("w-3 h-3 rounded-full shrink-0", statusDot[effectiveStatus])} />
                {editingName ? (
                  <input
                    ref={nameInputRef}
                    autoFocus
                    type="text"
                    defaultValue={localFullName}
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
                  {!patient.fromForm || mergedProcedureHistory.length > 0 || mergedProtocolHistory.length > 0 ? "Повторний" : "Новий"}
                </span>
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: serviceCategory.bgColor, color: serviceCategory.color }}
                >
                  {serviceCategory.label}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs flex-wrap mt-2 sm:mt-2.5">
              <span className="text-muted-foreground font-normal">Дата:</span>
              <span className="font-bold text-foreground">
                {patient.date
                  ? (() => { const d = new Date(patient.date + "T00:00:00"); return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`; })()
                  : "—"}
              </span>
              <button
                onClick={() => setShowReschedulePicker(true)}
                title="Перенести прийом"
                className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-accent transition-all"
              >
                <Pencil size={11} className="text-muted-foreground" />
              </button>
              <span className="text-muted-foreground">|</span>
              <span className="text-muted-foreground font-normal">Час:</span>
              <span className="font-bold text-foreground">{patient.time}</span>
              <span className="text-muted-foreground">|</span>
              <span className="font-bold text-foreground">{patient.procedure}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
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

            <div className="flex-1 overflow-y-auto">
              {activeTab === "card" ? (
                <div className="p-4 space-y-3">
                  <ContentBlock title="Профіль пацієнта" icon={<User size={13} />}>
                    <ProfilePane
                      profile={mergedProfile}
                      onFocusEdit={handleFocusOpen}
                      onBirthDateChange={(value) => setFields((prev) => ({ ...prev, birthDate: value }))}
                      onPhoneChange={(value) => setFields((prev) => ({ ...prev, phone: value }))}
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
                    <ServicesPane services={localServices} onServicesChange={setLocalServices} showFloatingEdit={!focusField} />
                  </ContentBlock>
                  <ContentBlock title="Трекер підготовки" icon={<Activity size={13} />}>
                    <TrackerPane preparation={preparation} status={effectiveStatus} />
                  </ContentBlock>
                </div>
              ) : activeTab === "files" ? (
                <div className="p-4 space-y-3">
                  <ContentBlock title="Обстеження та Файли" icon={<FileText size={13} />}>
                    <FilesPane
                      files={localFiles}
                      onFilesChange={setLocalFiles}
                      onFocusEdit={handleFocusOpen}
                      fromForm={patient.fromForm}
                      protocolText={fields.protocol}
                      protocolHistory={mergedProtocolHistory}
                      procedureHistory={mergedProcedureHistory}
                      activeVisitDate={activeVisitDisplayDate}
                      onProtocolPrefill={(value) => setFields((prev) => ({ ...prev, protocol: value }))}
                    />
                  </ContentBlock>
                </div>
              ) : activeTab === "assistant" ? (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <ContentBlock title="Підготовка та зв'язок" icon={<Activity size={13} />}
                    headerRight={mergedProfile.phone ? (
                      <a
                        href={`tel:${mergedProfile.phone}`}
                        className="w-7 h-7 rounded-full bg-status-ready flex items-center justify-center shadow-sm active:scale-[0.93] transition-all shrink-0"
                        title={mergedProfile.phone}
                      >
                        <Phone size={13} strokeWidth={2.5} className="text-white" />
                      </a>
                    ) : undefined}
                  >
                    {rescheduleNoticeOriginalDate && (
                      <div className="px-4 pt-2">
                        <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-sky-700 bg-sky-50 border border-sky-200 rounded-md px-2 py-1">
                          <RotateCcw size={12} className="shrink-0" />
                          <span>Підготовку перезапущено (перенос із {rescheduleNoticeOriginalDate})</span>
                        </div>
                      </div>
                    )}
                    <div className="mx-4 mt-2">
                      {step2AckResult === "confirmed" ? (
                        <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-green-700 bg-green-50 border border-green-200 rounded-md px-2 py-1">
                          <Check size={12} className="shrink-0" />
                          <span>Інструкцію щодо харчування підтверджено пацієнтом</span>
                        </div>
                      ) : step2AckResult === "question" ? (
                        <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1">
                          <AlertTriangle size={12} className="shrink-0" />
                          <span>Пацієнт має запитання щодо дієти. Лікаря повідомлено</span>
                        </div>
                      ) : waitingForStep2Ack && dietInstructionSent ? (
                        <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-md px-2 py-1">
                          <Clock size={12} className="shrink-0" />
                          <span>Інструкцію щодо харчування надіслано. Очікую відповідь пацієнта</span>
                        </div>
                      ) : welcomeSent ? (
                        <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-green-700 bg-green-50 border border-green-200 rounded-md px-2 py-1">
                          <Check size={12} className="shrink-0" />
                          <span>Вітальне повідомлення надіслано</span>
                        </div>
                      ) : allFieldsReady ? (
                        <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-sky-700 bg-sky-50 border border-sky-200 rounded-md px-2 py-1 animate-pulse">
                          <Clock size={12} className="shrink-0" />
                          <span>Всі дані готові. Надсилаю вітальне повідомлення...</span>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                          <Clock size={12} className="shrink-0" />
                          <span>Чекаю на заповнення: {missingFields.join(", ")}</span>
                        </div>
                      )}
                    </div>
                    <PrepStepper
                      preparation={preparation}
                      status={effectiveStatus}
                      waitingForDietAck={waitingForDietAck}
                      dietInstructionSent={dietInstructionSent}
                      waitingForStep2Ack={waitingForStep2Ack}
                      step2AckResult={step2AckResult}
                    />
                    <SidebarTracker
                      preparation={preparation}
                      status={effectiveStatus}
                      waitingForDietAck={waitingForDietAck}
                      dietInstructionSent={dietInstructionSent}
                      waitingForStep2Ack={waitingForStep2Ack}
                      step2AckResult={step2AckResult}
                    />
                  </ContentBlock>
                  <ChatPane chat={chat} unanswered={unanswered} onQuickReply={handleQuickReply} />
                  <ChatInput />
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Left column: 40% */}
            <div className="w-[40%] overflow-y-auto shrink-0 p-4 space-y-3">
              <ContentBlock title="Профіль пацієнта" icon={<User size={13} />}>
                <ProfilePane
                  profile={mergedProfile}
                  onFocusEdit={handleFocusOpen}
                  onBirthDateChange={(value) => setFields((prev) => ({ ...prev, birthDate: value }))}
                  onPhoneChange={(value) => setFields((prev) => ({ ...prev, phone: value }))}
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
                <ServicesPane services={localServices} onServicesChange={setLocalServices} showFloatingEdit={!focusField} />
              </ContentBlock>
              <ContentBlock title="Обстеження та Файли" icon={<FileText size={13} />}>
                <FilesPane
                  files={localFiles}
                  onFilesChange={setLocalFiles}
                  onFocusEdit={handleFocusOpen}
                  fromForm={patient.fromForm}
                  protocolText={fields.protocol}
                  protocolHistory={mergedProtocolHistory}
                  procedureHistory={mergedProcedureHistory}
                  activeVisitDate={activeVisitDisplayDate}
                  onProtocolPrefill={(value) => setFields((prev) => ({ ...prev, protocol: value }))}
                />
              </ContentBlock>
            </div>

            {/* Right column: 60% */}
            <div className="w-[60%] flex flex-col overflow-hidden p-4 pl-0">
              <ContentBlock title="Асистент" icon={<MessageCircle size={13} />} className="flex-1 flex flex-col overflow-hidden"
                headerRight={
                  <div className="flex items-center gap-2">
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
                {rescheduleNoticeOriginalDate && (
                  <div className="px-4 pt-2">
                    <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-sky-700 bg-sky-50 border border-sky-200 rounded-md px-2 py-1">
                      <RotateCcw size={12} className="shrink-0" />
                      <span>Підготовку перезапущено (перенос із {rescheduleNoticeOriginalDate})</span>
                    </div>
                  </div>
                )}
                <div className="mx-4 mt-2">
                  {step2AckResult === "confirmed" ? (
                    <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-green-700 bg-green-50 border border-green-200 rounded-md px-2 py-1">
                      <Check size={12} className="shrink-0" />
                      <span>Інструкцію щодо харчування підтверджено пацієнтом</span>
                    </div>
                  ) : step2AckResult === "question" ? (
                    <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1">
                      <AlertTriangle size={12} className="shrink-0" />
                      <span>Пацієнт має запитання щодо дієти. Лікаря повідомлено</span>
                    </div>
                  ) : waitingForStep2Ack && dietInstructionSent ? (
                    <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-md px-2 py-1">
                      <Clock size={12} className="shrink-0" />
                      <span>Інструкцію щодо харчування надіслано. Очікую відповідь пацієнта</span>
                    </div>
                  ) : welcomeSent ? (
                    <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-green-700 bg-green-50 border border-green-200 rounded-md px-2 py-1">
                      <Check size={12} className="shrink-0" />
                      <span>Вітальне повідомлення надіслано</span>
                    </div>
                  ) : allFieldsReady ? (
                    <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-sky-700 bg-sky-50 border border-sky-200 rounded-md px-2 py-1 animate-pulse">
                      <Clock size={12} className="shrink-0" />
                      <span>Всі дані готові. Надсилаю вітальне повідомлення...</span>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                      <Clock size={12} className="shrink-0" />
                      <span>Чекаю на заповнення: {missingFields.join(", ")}</span>
                    </div>
                  )}
                </div>
                <PrepStepper
                  preparation={preparation}
                  status={effectiveStatus}
                  waitingForDietAck={waitingForDietAck}
                  dietInstructionSent={dietInstructionSent}
                  waitingForStep2Ack={waitingForStep2Ack}
                  step2AckResult={step2AckResult}
                />
                <SidebarTracker
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
            allergies={fields.allergies}
            onSave={handleFocusSave}
            onCancel={handleFocusCancel}
          />
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
                  setRescheduleDate(selectedDate.toISOString().slice(0, 10));
                  setRescheduleTime(`${String(hour).padStart(2, "0")}:00`);
                }}
                selectedSlot={rescheduleDate && rescheduleTime ? {
                  dateStr: rescheduleDate,
                  hour: parseInt(rescheduleTime, 10),
                  name: patient.name,
                } : undefined}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Focus Mode Overlay ──
function FocusOverlay({ field, value, history, patientName, allergies, onSave, onCancel }: {
  field: string;
  value: string;
  history?: HistoryEntry[];
  patientName: string;
  allergies: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(field === "phone" ? normalizePhoneWithPlus(value) : value);
  const baseValue = value.trim();
  const isDailyField = field === "notes" || field === "allergies" || field === "diagnosis";
  const todayIso = getTodayIsoKyiv();
  const visibleHistory = (history || []).filter((entry) => {
    if (!entry.value.trim()) return false;
    if (entry.value.trim() === baseValue) return false;
    if (isDailyField && !baseValue && entry.date === todayIso) return false;
    return true;
  });

  const fieldLabels: Record<string, string> = {
    protocol: "Висновок лікаря",
    phone: "Телефон",
    allergies: "Алергії",
    diagnosis: "Діагноз",
    notes: "Нотатки",
  };

  return (
    <div className="absolute inset-0 z-60 flex flex-col animate-fade-in">
      {/* Blurred backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

      {/* Content */}
      <div className="relative flex flex-col h-full">
        {/* Pinned patient safety header */}
        <div className="shrink-0 px-5 py-3 bg-card border-b border-border/60 shadow-sm">
          <div className="flex items-center gap-3">
            <User size={16} className="text-muted-foreground shrink-0" />
            <div>
              <p className="text-sm font-bold text-foreground">{patientName}</p>
              {allergies && (
                <p className="text-xs font-bold text-status-risk bg-status-risk-bg px-2 py-0.5 rounded-md inline-flex items-center gap-1 mt-0.5">
                  <AllergyShield size={11} />
                  Алергія: {allergies}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Centered editing area — 70-80% of workspace */}
        <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
          <div className="w-full max-w-3xl bg-card rounded-2xl shadow-2xl border border-border/40 overflow-hidden" style={{ maxHeight: "75vh" }}>
            <div className="px-5 py-3 border-b border-border/40 bg-[hsl(204,100%,97%)]">
              <h3 className="text-sm font-bold text-foreground">
                {fieldLabels[field] || field}
              </h3>
            </div>
            <div className="p-5">
              {field === "phone" ? (
                <input
                  type="tel"
                  value={text}
                  onChange={(e) => setText(normalizePhoneWithPlus(e.target.value))}
                  className="w-full text-sm leading-relaxed text-foreground bg-white border-2 border-[hsl(204,100%,80%)] rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary/30"
                  autoFocus
                />
              ) : (
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="w-full text-sm leading-relaxed text-foreground bg-white border-2 border-[hsl(204,100%,80%)] rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                  style={{ minHeight: "200px", maxHeight: "50vh" }}
                  autoFocus
                />
              )}
            </div>
            {visibleHistory.length > 0 && (
              <div className="px-5 pb-3 border-t border-border/40 pt-3">
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
            <div className="px-5 py-3 border-t border-border/40 flex items-center justify-end gap-3">
              <button
                onClick={onCancel}
                className="px-5 py-2 text-sm font-bold text-muted-foreground bg-transparent border border-border rounded-lg hover:bg-muted/40 transition-colors active:scale-[0.97]"
              >
                Скасувати
              </button>
              <button
                onClick={() => onSave(text)}
                className="px-5 py-2 text-sm font-bold text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors active:scale-[0.97] shadow-sm"
              >
                Зберегти
              </button>
            </div>
          </div>
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
function ProfilePane({ profile, onFocusEdit, onBirthDateChange, onPhoneChange, histories }: {
  profile: ReturnType<typeof getMockProfile>;
  onFocusEdit: (field: string, value: string, history?: HistoryEntry[]) => void;
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
        <input
          type="tel"
          value={localPhone}
          onChange={(e) => {
            const normalized = normalizePhoneWithPlus(e.target.value);
            setLocalPhone(normalized);
            onPhoneChange(getStorablePhone(normalized));
          }}
          placeholder="+380671234567"
          className="w-full bg-transparent text-sm font-bold outline-none"
        />
      </div>

      {/* Row 3: Алергії */}
      {profile.allergies ? (
        <div className="bg-red-50 rounded-xl border border-red-200 px-3 py-2.5">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-bold text-red-600 uppercase tracking-wide flex items-center gap-1">
              <AllergyShield size={12} />
              Алергії
            </p>
            <button onClick={() => onFocusEdit("allergies", profile.allergies, histories.allergiesHistory)} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-red-100 transition-all">
              <Pencil size={11} className="text-red-600" />
            </button>
          </div>
          <span className="text-sm font-bold text-red-600">{profile.allergies}</span>
        </div>
      ) : (
        <div className="bg-background rounded-xl border border-border/60 px-3 py-2.5">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Алергії</p>
            <button onClick={() => onFocusEdit("allergies", profile.allergies, histories.allergiesHistory)} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-accent transition-all">
              <Pencil size={11} className="text-muted-foreground" />
            </button>
          </div>
          <button onClick={() => onFocusEdit("allergies", profile.allergies, histories.allergiesHistory)} className="text-sm italic text-muted-foreground/40 text-left w-full hover:text-muted-foreground transition-colors">Не зазначено</button>
        </div>
      )}

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
function SidebarTracker({ preparation, status, waitingForDietAck = false, dietInstructionSent = false, waitingForStep2Ack = false, step2AckResult = "none" }: {
  preparation: ReturnType<typeof getPreparationProgress>;
  status: PatientStatus;
  waitingForDietAck?: boolean;
  dietInstructionSent?: boolean;
  waitingForStep2Ack?: boolean;
  step2AckResult?: "none" | "confirmed" | "question";
}) {
  const firstPendingIdx = preparation.steps.findIndex(s => !s.done);
  const isRisk = status === "risk";

  type StepState = "done" | "inprogress" | "issue" | "pending" | "waiting";
  const getState = (step: { done: boolean }, i: number): StepState => {
    if (dietInstructionSent && i === 0) return "done";
    if (step2AckResult === "confirmed" && i === 1) return "done";
    if (step2AckResult === "question" && i === 1) return "issue";
    if (waitingForStep2Ack && i === 1) return "inprogress";
    if (waitingForDietAck && i === 0) return "waiting";
    if (step.done) return "done";
    if (i === firstPendingIdx) return isRisk ? "issue" : "inprogress";
    return "pending";
  };

  return (
    <div className="px-4 pb-3 space-y-3">
      {/* Steps */}
      <div className="space-y-1">
        {preparation.steps.map((step, i) => {
          const state = getState(step, i);
          const displayLabel = waitingForStep2Ack && i === 1
            ? "Прийом препарату (очікує старту)"
            : step.label;
          return (
            <div
              key={i}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg transition-colors",
                state === "issue" && "bg-red-50 border border-red-200"
              )}
            >
              {/* Icon */}
              <div className={cn(
                "w-5 h-5 rounded-full flex items-center justify-center shrink-0",
                state === "done"       && "bg-status-ready text-white",
                state === "inprogress" && "bg-yellow-400 text-white",
                state === "waiting"    && "bg-orange-400 text-white animate-pulse",
                state === "issue"      && "bg-red-500 text-white",
                state === "pending"    && "bg-muted text-muted-foreground"
              )}>
                {state === "done"       && <Check size={11} strokeWidth={3} />}
                {state === "inprogress" && <Clock size={10} strokeWidth={2.5} />}
                {state === "waiting"    && <span className="w-2 h-2 rounded-full bg-white/95" />}
                {state === "issue"      && <AlertTriangle size={10} strokeWidth={2.5} />}
                {state === "pending"    && <span className="text-[9px] font-bold">{i + 1}</span>}
              </div>

              {/* Label */}
              <span className={cn(
                "text-xs leading-tight",
                state === "done"       && "text-foreground font-semibold",
                state === "inprogress" && "text-yellow-700 font-semibold",
                state === "waiting"    && "text-orange-700 font-semibold",
                state === "issue"      && "text-red-600 font-bold",
                state === "pending"    && "text-muted-foreground"
              )}>
                {displayLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tracker Pane (mobile full) ──
function TrackerPane({ preparation, status }: { preparation: ReturnType<typeof getPreparationProgress>; status: PatientStatus }) {
  return (
    <div className="px-4 pb-4 space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold text-foreground">Прогрес підготовки</span>
        </div>
        <Progress
          value={preparation.percent}
          className={cn(
            "h-2.5 rounded-full",
            status === "ready" ? "[&>div]:bg-status-ready" : status === "progress" ? "[&>div]:bg-status-progress" : "[&>div]:bg-status-risk"
          )}
        />
      </div>
      <div className="space-y-2.5">
        {preparation.steps.map((step, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className={cn(
              "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
              step.done ? "bg-status-ready text-white" : "bg-muted text-muted-foreground"
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

// ── Tracker Compact (desktop inline) ──
function TrackerPaneCompact({ preparation, status }: { preparation: ReturnType<typeof getPreparationProgress>; status: PatientStatus }) {
  return (
    <div className="px-4 pb-4 space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-bold text-foreground">Прогрес</span>
        </div>
        <Progress
          value={preparation.percent}
          className={cn(
            "h-2 rounded-full",
            status === "ready" ? "[&>div]:bg-status-ready" : status === "progress" ? "[&>div]:bg-status-progress" : "[&>div]:bg-status-risk"
          )}
        />
      </div>
      <div className="space-y-1.5">
        {preparation.steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={cn(
              "w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0",
              step.done ? "bg-status-ready text-white" : "bg-muted text-muted-foreground"
            )}>
              {step.done ? "✓" : i + 1}
            </div>
            <span className={cn("text-xs", step.done ? "font-bold text-foreground" : "text-muted-foreground")}>
              {step.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
function PrepStepper({ preparation, status, waitingForDietAck = false, dietInstructionSent = false, waitingForStep2Ack = false, step2AckResult = "none" }: {
  preparation: ReturnType<typeof getPreparationProgress>;
  status: PatientStatus;
  waitingForDietAck?: boolean;
  dietInstructionSent?: boolean;
  waitingForStep2Ack?: boolean;
  step2AckResult?: "none" | "confirmed" | "question";
}) {
  const firstPendingIdx = preparation.steps.findIndex(s => !s.done);
  const isRisk = status === "risk";

  return (
    <div className="px-4 pt-3 pb-2">
      <div className="flex items-end gap-1">
        {preparation.steps.map((step, i) => {
          const isDone = (dietInstructionSent && i === 0) || (step2AckResult === "confirmed" && i === 1) || step.done;
          const isWaiting = waitingForDietAck && i === 0;
          const isStep2Prepared = waitingForStep2Ack && i === 1;
          const isStep2Issue = step2AckResult === "question" && i === 1;
          const isActive = !isDone && !isStep2Prepared && !isStep2Issue && i === firstPendingIdx;
          const isIssue = isStep2Issue || (isActive && isRisk);
          const displayLabel = waitingForStep2Ack && i === 1
            ? "Прийом препарату (очікує старту)"
            : step.label;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={displayLabel}>
              <div className={cn(
                "w-full h-1 rounded-full transition-colors",
                isDone ? "bg-status-ready" : isWaiting ? "bg-orange-400 animate-pulse" : isIssue ? "bg-red-500" : (isStep2Prepared || isActive) ? "bg-yellow-400" : "bg-muted"
              )} />
              <span className={cn(
                "text-[9px] font-bold leading-none",
                isDone ? "text-status-ready" : isWaiting ? "text-orange-700" : isIssue ? "text-red-500" : (isStep2Prepared || isActive) ? "text-yellow-600" : "text-muted-foreground/40"
              )}>
                {i + 1}
              </span>
            </div>
          );
        })}
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
};

type PreviewState =
  | { kind: "pdf"; name: string; blob: Blob }
  | { kind: "docx"; name: string; blob: Blob }
  | { kind: "image"; name: string; blob: Blob }
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

function getMockFiles(todayStr: string): FileItem[] {
  return [
    { id: "mock_today_img", name: "test_today.jpg", type: "patient", date: todayStr },
    { id: "mock_archive_pdf", name: "archive_report_2025.pdf", type: "doctor", date: "20.05.2025" },
  ];
}

function getSeededMockFiles(patient: Patient): FileItem[] {
  if (!isPetushkovMockPatient(patient)) return [];
  return [
    { id: "mock-old-report-15052025", name: "old_report.pdf", type: "doctor", date: "15.05.2025" },
    { id: "mock-scan-15052025", name: "scan_2025.jpg", type: "patient", date: "15.05.2025" },
  ];
}

function getSeededMockProtocolHistory(patient: Patient): Array<{ value: string; timestamp: string; date: string }> {
  if (!isPetushkovMockPatient(patient)) return [];
  return [
    {
      value: "Архівний діагностичний запис для емулятора. Проведено гастроскопію, рекомендовано планове спостереження.",
      timestamp: "15.05.2025",
      date: "2025-05-15",
    },
  ];
}

function getSeededMockProcedureHistory(patient: Patient): Array<{ value: string; timestamp: string; date: string }> {
  if (!isPetushkovMockPatient(patient)) return [];
  return [
    {
      value: "Гастроскопія",
      timestamp: "15.05.2025",
      date: "2025-05-15",
    },
  ];
}

function mergeUniqueFileItems(primary: FileItem[], seeded: FileItem[]): FileItem[] {
  const map = new Map<string, FileItem>();
  for (const file of [...seeded, ...primary]) {
    map.set(file.id, file);
  }
  return Array.from(map.values());
}

const MOCK_PROTOCOL_HISTORY: Array<{ value: string; timestamp: string; date: string }> = [
  { value: "Гастроскопія: патологій не виявлено. Слизова шлунка та дванадцятипалої кишки в нормі.", timestamp: "20.05.2025", date: "2025-05-20" },
];

// ── Shared file row ──
function FileRow({ file, onDelete, onView, readOnly }: { file: FileItem; onDelete: () => void; onView: () => void; readOnly?: boolean }) {
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background border border-border/60">
      <FileText size={15} className={file.type === "doctor" ? "text-primary shrink-0" : "text-status-progress shrink-0"} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-foreground truncate">{file.name}</p>
        <p className="text-[10px] text-muted-foreground">{file.type === "doctor" ? "Лікар" : "Пацієнт"} · {file.date}</p>
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

function PdfPreviewModal({ file, onClose }: { file: { name: string; blob: Blob }; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const renderTaskRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof getDocument> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    setLoading(true);
    setError(null);
    setPdfDoc(null);
    setPage(1);
    setPages(0);

    (async () => {
      try {
        const bytes = new Uint8Array(await file.blob.arrayBuffer());
        timeoutId = setTimeout(() => {
          if (!cancelled) {
            setError("PDF не відповідає під час завантаження. Спробую інший режим відкриття в наступному кроці.");
            setLoading(false);
          }
        }, 12000);

        loadingTask = getDocument({
          data: bytes,
          disableWorker: true,
          useSystemFonts: true,
          isEvalSupported: false,
          enableXfa: false,
        });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        if (timeoutId) clearTimeout(timeoutId);
        setPdfDoc(doc);
        setPages(doc.numPages || 0);
      } catch (e) {
        if (cancelled) return;
        if (timeoutId) clearTimeout(timeoutId);
        console.error("PDF preview failed", e);
        setError("Не вдалося відкрити PDF для перегляду");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (loadingTask) loadingTask.destroy();
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

        const pdfPage = await pdfDoc.getPage(page);
        if (cancelled) return;

        const viewport = pdfPage.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const renderTask = pdfPage.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (cancelled) return;
        setLoading(false);
      } catch (e) {
        const errorName = typeof e === "object" && e !== null && "name" in e ? String((e as { name?: string }).name) : "";
        if (!cancelled && errorName !== "RenderingCancelledException") {
          console.error("PDF render failed", e);
          setError("Не вдалося відмалювати сторінку PDF");
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
          {loading ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Завантаження PDF...</div>
          ) : error ? (
            <div className="h-full flex items-center justify-center text-sm text-destructive font-semibold">{error}</div>
          ) : (
            <div className="flex justify-center">
              <canvas ref={canvasRef} className="bg-white rounded shadow-md max-w-full h-auto" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ImagePreviewModal({ file, onClose }: { file: { name: string; blob: Blob }; onClose: () => void }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file.blob]);

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-[1px] flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-card w-full max-w-6xl h-[90vh] rounded-xl shadow-elevated overflow-hidden border border-border/60 flex flex-col">
        <div className="h-12 px-3 border-b border-border/60 flex items-center gap-2 shrink-0">
          <p className="text-sm font-bold text-foreground truncate pr-2 flex-1">{file.name}</p>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-accent transition-colors" title="Закрити перегляд">
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>
        <div className="flex-1 overflow-auto bg-muted/30 p-4 flex items-center justify-center">
          {url ? <img src={url} alt={file.name} className="max-w-full max-h-full object-contain rounded shadow-md bg-white" /> : null}
        </div>
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
function FilesPane({ files, onFilesChange, onFocusEdit, fromForm, protocolText, protocolHistory, procedureHistory, activeVisitDate, onProtocolPrefill }: {
  files: FileItem[];
  onFilesChange: (files: FileItem[]) => void;
  onFocusEdit: (field: string, value: string) => void;
  fromForm?: boolean;
  protocolText: string;
  protocolHistory?: Array<{ value: string; timestamp: string; date: string }>;
  procedureHistory?: Array<{ value: string; timestamp: string; date: string }>;
  activeVisitDate: string;
  onProtocolPrefill: (value: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<string | null>(null);
  const [confirmCopyProtocol, setConfirmCopyProtocol] = useState<{ value: string; date: string } | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const activeDate = activeVisitDate || isoToDisplay(getTodayIsoKyiv());

  // Group files by their date field
  const filesByDate = useMemo(() => {
    const map = new Map<string, FileItem[]>();
    for (const f of files) {
      const d = f.date || activeDate;
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(f);
    }
    return map;
  }, [files, activeDate]);

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
    return map;
  }, [protocolHistory]);

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
    const entries = (protocolHistory || [])
      .filter((h) => !h.value.startsWith(RESCHEDULED_MARKER))
      .filter((h) => {
        const parts = h.date?.split("-");
        if (parts?.length !== 3) return false;
        const dd = `${parts[2]}.${parts[1]}.${parts[0]}`;
        return dd !== activeDate;
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    const latest = entries[0];
    if (!latest) return null;
    return {
      value: latest.value,
      date: isoToDisplay(latest.date),
    };
  }, [protocolHistory, activeDate]);

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

  // Collect all historical dates (not active), sorted descending
  const historicalDates = useMemo(() => {
    const dates = new Set<string>();
    for (const d of filesByDate.keys()) if (d !== activeDate) dates.add(d);
    for (const d of protocolByDate.keys()) if (d !== activeDate) dates.add(d);
    for (const d of procedureByDate.keys()) if (d !== activeDate) dates.add(d);
    for (const d of rescheduledToByDate.keys()) if (d !== activeDate) dates.add(d);
    return Array.from(dates).sort((a, b) => {
      const parse = (s: string) => {
        const [d, m, y] = s.split(".");
        return new Date(+y, +m - 1, +d).getTime();
      };
      return parse(b) - parse(a);
    });
  }, [filesByDate, protocolByDate, procedureByDate, rescheduledToByDate, activeDate]);

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

  const activeFiles = filesByDate.get(activeDate) || [];
  const hasTimeline = historicalDates.length > 0;

  const getFileExtension = (name: string): string => {
    const parts = name.toLowerCase().split(".");
    return parts.length > 1 ? parts.at(-1) || "" : "";
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;

    try {
      const uploaded = await Promise.all(Array.from(e.target.files).map(async (file) => {
        const storageKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name}`;
        await putBlobToStorage(storageKey, file);
        return {
          id: Math.random().toString(36).substring(7),
          name: file.name,
          type: "doctor" as const,
          date: activeDate,
          storageKey,
          mimeType: file.type,
        } as FileItem;
      }));

      onFilesChange([...files, ...uploaded]);
    } catch (err) {
      console.error("Failed to save uploaded files", err);
      toast.error("Не вдалося зберегти файл. Спробуйте ще раз.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleViewFile = async (file: FileItem) => {
    let blob: Blob | null = null;

    if (file.storageKey) {
      blob = await getBlobFromStorage(file.storageKey);
    }

    if (!blob && file.url) {
      try {
        const res = await fetch(file.url);
        blob = await res.blob();
      } catch (err) {
        console.error("Failed to load legacy file URL", err);
      }
    }

    if (!blob) {
      alert(`Це тестовий файл "${file.name}". Справжні файли, які ви завантажите, зможете переглянути.`);
      return;
    }

    const ext = getFileExtension(file.name);
    const mime = (file.mimeType || blob.type || "").toLowerCase();
    const isPdf = mime.includes("pdf") || ext === "pdf";
    if (isPdf) {
      setPreview({ kind: "pdf", name: file.name, blob });
      return;
    }

    const isImage = mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext);
    if (isImage) {
      setPreview({ kind: "image", name: file.name, blob });
      return;
    }

    const isDocx = mime.includes("officedocument.wordprocessingml.document") || ext === "docx";
    if (isDocx) {
      setPreview({ kind: "docx", name: file.name, blob });
      return;
    }

    const isLegacyWord = mime.includes("msword") || ext === "doc";
    if (isLegacyWord) {
      setPreview({
        kind: "unsupported",
        name: file.name,
        message: "Формат .doc є застарілим бінарним форматом Word. У поточному веб-інтерфейсі його неможливо стабільно відкрити всередині продукту без серверної конвертації. Якщо це .docx, він відкриється прямо тут. Якщо це саме .doc, його потрібно зберегти як .docx для внутрішнього перегляду.",
      });
      return;
    }

    const viewUrl = URL.createObjectURL(blob);
    const opened = window.open(viewUrl, "_blank", "noopener,noreferrer");
    if (!opened) {
      const fallback = document.createElement("a");
      fallback.href = viewUrl;
      fallback.target = "_blank";
      fallback.rel = "noopener noreferrer";
      fallback.click();
    }

    setTimeout(() => URL.revokeObjectURL(viewUrl), 30_000);
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
                    console.error("Failed to delete file from storage", err);
                  }
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
            <h3 className="text-sm font-bold text-foreground mb-1">Підтвердження копіювання</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Ви впевнені, що хочете скопіювати дані з візиту за {confirmCopyProtocol.date}? Поточний текст у полі буде видалено.
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
                }}
                className="flex-1 py-2.5 text-sm font-bold bg-status-ready text-white rounded-lg transition-colors active:scale-[0.97]"
              >
                Копіювати
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="relative px-4">
        {/* Vertical thread connecting dots */}
        {hasTimeline && (
          <div className="absolute left-[27px] top-5 bottom-3 w-px bg-border/50" />
        )}

        {/* ── Current Visit (always expanded, always on top) ── */}
        <div className="relative pl-8 mb-4">
          <div className="absolute left-0 top-[3px] w-3.5 h-3.5 rounded-full bg-primary border-2 border-white shadow-sm" />

          {/* Header */}
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[11px] font-bold text-primary">{formatDateUkrainian(activeDate)}</span>
            <span className="ml-auto text-[8px] font-bold text-primary bg-primary/10 px-1 py-0.5 rounded-full shrink-0 uppercase tracking-wide">Активний</span>
          </div>

          {/* ВИСНОВОК ЛІКАРЯ — soft highlighted border, editable */}
          <div className="rounded-lg border-2 border-[hsl(204,100%,80%)] bg-[hsl(204,100%,97%)] p-3 pb-10 space-y-2 mb-2.5 relative">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <FileText size={12} className="text-primary" />
                Висновок лікаря
              </h4>
              <button onClick={() => onFocusEdit("protocol", protocolText)}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-accent active:scale-[0.9] transition-all">
                <Pencil size={11} className="text-muted-foreground" />
              </button>
            </div>
            {protocolText ? (
              <p className="text-sm leading-relaxed text-foreground">{protocolText}</p>
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

            {latestArchivedProtocol && (
              <button
                onClick={() => setConfirmCopyProtocol({ value: latestArchivedProtocol.value, date: latestArchivedProtocol.date })}
                className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 hover:bg-sky-100 rounded-md px-2 py-1 transition-colors"
                title={`Скопіювати висновок від ${latestArchivedProtocol.date}`}
              >
                <ClipboardList size={12} className="shrink-0" />
                <span>Скопіювати ({latestArchivedProtocol.date})</span>
              </button>
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
          <button onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-primary bg-transparent border border-primary/30 hover:bg-primary/5 rounded-lg py-2 transition-colors active:scale-[0.97]">
            <Upload size={13} />
            Завантажити файл
          </button>
        </div>

        {/* ── Historical Visits (collapsible) ── */}
        {historicalDates.map((date) => {
          const isCollapsed = collapsedDates.has(date);
          const dateFiles = filesByDate.get(date) || [];
          const dateProtocol = protocolByDate.get(date);
          const dateProcedure = procedureByDate.get(date);
          const rescheduledTo = rescheduledToByDate.get(date);
          const isFrozen = !!rescheduledTo;

          return (
            <div key={date} className="relative pl-8 mb-3">
              {/* Muted dot for past visit */}
              <div className="absolute left-0 top-[3px] w-3.5 h-3.5 rounded-full bg-muted-foreground/25 border-2 border-white" />

              {/* Collapsible header */}
              <button onClick={() => toggleDate(date)}
                className="w-full flex items-center gap-1.5 text-left mb-1 group">
                <span className="text-[11px] font-semibold text-muted-foreground">{formatDateUkrainian(date)}</span>
                {isFrozen && (
                  <span className="text-[9px] font-bold text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Перенесено</span>
                )}
                <ChevronDown size={11} className={cn(
                  "ml-auto text-muted-foreground/50 transition-transform duration-200 shrink-0",
                  !isCollapsed && "rotate-180"
                )} />
              </button>

              {/* Expanded content — read-only archive */}
              {!isCollapsed && (
                <div className={cn("space-y-1.5 pt-0.5 rounded-lg p-2", isFrozen && "bg-slate-100 border border-slate-200")}>
                  {isFrozen && (
                    <div className="rounded-lg border border-slate-300 bg-slate-50 p-2.5">
                      <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wide mb-1">Статус</p>
                      <p className="text-xs font-semibold text-slate-700">Перенесено: {rescheduledTo}</p>
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
                      <p className="text-xs leading-relaxed text-foreground/80">{dateProtocol}</p>
                    </div>
                  )}
                  {dateFiles.map(file => (
                    <FileRow key={file.id} file={file} readOnly
                      onDelete={() => setConfirmDeleteFile(file.id)}
                      onView={() => handleViewFile(file)} />
                  ))}
                  {!dateProtocol && dateFiles.length === 0 && !isFrozen && (
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

function ChatPane({ chat, unanswered, onQuickReply }: {
  chat: ChatMessage[];
  unanswered: ChatMessage[];
  onQuickReply?: (answer: "yes" | "no", context?: "greeting" | "diet") => void;
}) {
  return (
    <div className="mx-5 my-3 rounded-[20px] px-4 py-3 space-y-2.5 overflow-y-auto flex-1 border border-sky-100 bg-[linear-gradient(180deg,#f7fcff_0%,#ecf8ff_100%)]">
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

      {/* Chat history — messenger bubbles */}
      {chat.filter((m) => !m.unanswered).map((msg, i) => {
        const isPatient = msg.sender === "patient";
        const isDoctor = msg.sender === "doctor";
        return (
          <div key={i} className={cn("flex flex-col", isPatient ? "items-end" : "items-start")}>
            <div
              className={cn(
                "rounded-2xl px-4 py-2.5 text-sm leading-relaxed max-w-[86%] shadow-[0_2px_8px_rgba(0,0,0,0.07)] whitespace-pre-wrap",
                isPatient
                  ? "bg-[hsl(257,85%,95%)] border border-violet-200 rounded-br-sm"
                  : isDoctor
                    ? "bg-emerald-50 border border-emerald-200 rounded-bl-sm"
                    : "bg-white border border-sky-100 rounded-bl-sm"
              )}
            >
              <p className={cn(
                "text-[11px] font-bold mb-0.5",
                isPatient ? "text-violet-700" : isDoctor ? "text-emerald-700" : "text-sky-700"
              )}>
                {isPatient ? "Клієнт" : isDoctor ? "Лікар" : "Асистент"} · {msg.time}
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

// ── Chat Input — single mic button, no arrow ──
function ChatInput() {
  const [value, setValue] = useState("");

  return (
    <div className="px-4 py-3 border-t border-border/40 bg-card shrink-0">
      <div className="flex items-center gap-2 bg-[hsl(200,100%,96%)] rounded-full px-4 py-1.5">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Відповісти..."
          className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground"
        />
        <button className="w-12 h-12 flex items-center justify-center rounded-full bg-[hsl(30,95%,62%)] text-white hover:opacity-90 active:scale-[0.93] transition-all shadow-md">
          <Mic size={28} />
        </button>
      </div>
    </div>
  );
}

// ── Assistant Toggle — moved from NewEntryForm ──

