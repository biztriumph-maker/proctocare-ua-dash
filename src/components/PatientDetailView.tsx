import { useState, useRef, useEffect } from "react";
import { X, MessageCircle, AlertTriangle, User, Activity, Phone, Mic, Pencil, FileText, Upload, Eye, Trash2, ClipboardList, ChevronRight, Headphones, Check, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { correctNameSpelling } from "@/lib/nameCorrection";
import type { Patient, PatientStatus } from "./PatientCard";
import { computePatientStatus, AllergyShield } from "./PatientCard";
import { useIsMobile } from "@/hooks/use-mobile";
import { Progress } from "@/components/ui/progress";
import { ProcedureSelector } from "./ProcedureSelector";
import { toast } from "sonner";

interface ChatMessage {
  sender: "ai" | "patient" | "doctor";
  text: string;
  time: string;
  unanswered?: boolean;
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

function renderHistory(history?: Array<{ value: string; timestamp: string; date: string }>) {
  if (!history || history.length === 0) return null;
  return (
    <div className="mt-1 text-[10px] text-muted-foreground space-y-0.5">
      {history.slice().reverse().map((item, idx) => (
        <div key={`${item.timestamp}-${idx}`}>
          <span className="font-bold">{item.date} {item.timestamp}</span>: {item.value}
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
  
  const initialNotes = patient.notes !== undefined ? patient.notes : profile.notes;
  const initialProtocol = patient.protocol || "";
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
  const mergedProfile = { ...profile, ...fields };
  
  const [localServices, setLocalServices] = useState<string[]>(initialServices);
  
  const chat = getMockChat(patient);
  const unanswered = chat.filter((m) => m.unanswered);
  const preparation = getPreparationProgress(patient, localServices);

  const serviceCategory = getServiceCategory(localServices);

  const [localFiles, setLocalFiles] = useState<FileItem[]>(patient.files || (patient.fromForm ? [] : [...MOCK_FILES]));

  const hasUnsavedChanges = 
    fields.notes !== initialNotes || 
    fields.protocol !== initialProtocol || 
    fields.phone !== initialPhone ||
    fields.allergies !== profile.allergies ||
    fields.diagnosis !== profile.diagnosis ||
    fields.birthDate !== profile.birthDate ||
    localServices.join(", ") !== (patient.procedure || "") ||
    JSON.stringify(localFiles) !== JSON.stringify(patient.files || (patient.fromForm ? [] : [...MOCK_FILES]));

  const addHistoryEntry = (
    history: Array<{ value: string; timestamp: string; date: string }> | undefined,
    newValue: string
  ) => {
    const trimmed = newValue.trim();
    if (!trimmed) return history || [];

    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10); // "2026-03-27" — for comparison
    const displayDate = now.toLocaleDateString("uk-UA"); // "27.03.2026" — for display

    const current = history ? [...history] : [];
    const lastEntry = current[current.length - 1];

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
      setFields((prev) => {
        if (focusField.field === "allergies" || focusField.field === "diagnosis") {
          // сохраняем как последний вариант, не накапливаем старые значения
          return { ...prev, [focusField.field]: trimmedValue };
        }

        if (focusField.field === "notes") {
          // Нужен только последний вариант заметки — предыдущие записи удаляются
          return { ...prev, notes: trimmedValue };
        }

        return { ...prev, [focusField.field]: trimmedValue };
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

  const handleSaveChanges = () => {
    if (onUpdatePatient) {
      const allergiesHistory = fields.allergies.trim() && fields.allergies !== patient.allergies
        ? addHistoryEntry(patient.allergiesHistory, fields.allergies)
        : patient.allergiesHistory;
      const diagnosisHistory = fields.diagnosis.trim() && fields.diagnosis !== patient.diagnosis
        ? addHistoryEntry(patient.diagnosisHistory, fields.diagnosis)
        : patient.diagnosisHistory;
      const notesHistory = fields.notes.trim() && fields.notes !== patient.notes
        ? addHistoryEntry(patient.notesHistory, fields.notes)
        : patient.notesHistory;
      const phoneHistory = fields.phone.trim() && fields.phone !== (patient.phone || "")
        ? addHistoryEntry(patient.phoneHistory, fields.phone)
        : patient.phoneHistory;
      const birthDateHistory = fields.birthDate.trim() && fields.birthDate !== (patient.birthDate || "")
        ? addHistoryEntry(patient.birthDateHistory, fields.birthDate)
        : patient.birthDateHistory;
      const protocolHistory = fields.protocol.trim() && fields.protocol !== (patient.protocol || "")
        ? addHistoryEntry(patient.protocolHistory, fields.protocol)
        : patient.protocolHistory;
      const procedureValue = localServices.join(", ");
      const procedureHistory = procedureValue.trim() && procedureValue !== (patient.procedure || "")
        ? addHistoryEntry(patient.procedureHistory, procedureValue)
        : patient.procedureHistory;

      onUpdatePatient({
        notes: fields.notes,
        protocol: fields.protocol,
        phone: fields.phone,
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
      toast.success("Дані пацієнта успішно збережено");
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
                <span className={cn("w-3 h-3 rounded-full shrink-0", statusDot[computePatientStatus(patient)])} />
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
                  {patient.fromForm ? "Новий" : "Повторний"}
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
                    <ServicesPane services={localServices} onServicesChange={setLocalServices} />
                  </ContentBlock>
                  <ContentBlock title="Трекер підготовки" icon={<Activity size={13} />}>
                    <TrackerPane preparation={preparation} status={patient.status} />
                  </ContentBlock>
                </div>
              ) : activeTab === "files" ? (
                <div className="p-4 space-y-3">
                  <ContentBlock title="Обстеження та Файли" icon={<FileText size={13} />}>
                    <FilesPane files={localFiles} onFilesChange={setLocalFiles} onFocusEdit={handleFocusOpen} fromForm={patient.fromForm} protocolText={fields.protocol} protocolHistory={patient.protocolHistory} />
                  </ContentBlock>
                </div>
              ) : activeTab === "assistant" ? (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <ContentBlock title="Підготовка та зв'язок" icon={<Activity size={13} />}>
                    <SidebarTracker preparation={preparation} status={patient.status} phone={mergedProfile.phone} />
                  </ContentBlock>
                  <AssistantToggle />
                  <ChatPane chat={chat} unanswered={unanswered} />
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
                <ServicesPane services={localServices} onServicesChange={setLocalServices} />
              </ContentBlock>
              <ContentBlock title="Обстеження та Файли" icon={<FileText size={13} />}>
                <FilesPane files={localFiles} onFilesChange={setLocalFiles} onFocusEdit={handleFocusOpen} fromForm={patient.fromForm} protocolText={fields.protocol} protocolHistory={patient.protocolHistory} />
              </ContentBlock>
            </div>

            {/* Right column: 60% */}
            <div className="w-[60%] flex flex-col overflow-hidden p-4 pl-0">
              <ContentBlock title="Асистент" icon={<MessageCircle size={13} />} className="flex-1 flex flex-col overflow-hidden"
                headerRight={unanswered.length > 0 ? (
                  <span className="flex items-center gap-1 text-xs font-bold text-status-risk bg-status-risk-bg px-2.5 py-0.5 rounded-full">
                    <AlertTriangle size={12} />
                    {unanswered.length} без відповіді
                  </span>
                ) : undefined}
              >
                <SidebarTracker preparation={preparation} status={patient.status} phone={mergedProfile.phone} />
                <AssistantToggle />
                <ChatPane chat={chat} unanswered={unanswered} />
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
  const [text, setText] = useState(value);

  const fieldLabels: Record<string, string> = {
    protocol: "Протокол огляду",
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
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full text-sm leading-relaxed text-foreground bg-white border-2 border-[hsl(204,100%,80%)] rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                style={{ minHeight: "200px", maxHeight: "50vh" }}
                autoFocus
              />
            </div>
            {history && history.length > 0 && (
              <div className="px-5 pb-3 border-t border-border/40 pt-3">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">Історія змін</p>
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {history.slice().reverse().map((entry, i) => (
                    <div key={i} className="flex items-baseline gap-2 text-xs text-muted-foreground">
                      <span className="font-semibold shrink-0">{entry.timestamp}</span>
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
function ProfilePane({ profile, onFocusEdit, histories }: {
  profile: ReturnType<typeof getMockProfile>;
  onFocusEdit: (field: string, value: string, history?: HistoryEntry[]) => void;
  histories: {
    phoneHistory?: Array<{ value: string; timestamp: string; date: string }>;
    birthDateHistory?: Array<{ value: string; timestamp: string; date: string }>;
    allergiesHistory?: Array<{ value: string; timestamp: string; date: string }>;
    diagnosisHistory?: Array<{ value: string; timestamp: string; date: string }>;
    notesHistory?: Array<{ value: string; timestamp: string; date: string }>;
  };
}) {
  const [editingBirthDate, setEditingBirthDate] = useState(false);
  const [localBirthDate, setLocalBirthDate] = useState(profile.birthDate || "");
  const { ageStr } = calcAge(localBirthDate);

  return (
    <div className="px-4 pb-4 space-y-3">

      {/* Row 1: Дата народження + Вік */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-background rounded-xl border border-border/60 px-3 py-2.5">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1">Дата народження</p>
          {editingBirthDate ? (
            <input
              type="text" inputMode="numeric"
              value={localBirthDate}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^\d]/g, "").slice(0, 8);
                let f = raw;
                if (raw.length > 2) f = raw.slice(0, 2) + "." + raw.slice(2);
                if (raw.length > 4) f = raw.slice(0, 2) + "." + raw.slice(2, 4) + "." + raw.slice(4);
                setLocalBirthDate(f);
              }}
              placeholder="ДД.ММ.РРРР" maxLength={10} autoFocus
              onBlur={() => {
                setEditingBirthDate(false);
                setFields((prev) => ({ ...prev, birthDate: localBirthDate }));
                onFocusEdit("birthDate", localBirthDate);
              }}
              className="w-full bg-transparent text-sm font-bold tabular-nums outline-none border-b border-primary"
            />
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-foreground tabular-nums">{localBirthDate || "—"}</span>
              <button onClick={() => setEditingBirthDate(true)} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-accent transition-all shrink-0">
                <Pencil size={11} className="text-muted-foreground" />
              </button>
            </div>
          )}
        </div>
        {renderHistory(histories.birthDateHistory)}
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
          <button onClick={() => onFocusEdit("phone", profile.phone)} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-accent transition-all">
            <Pencil size={11} className="text-muted-foreground" />
          </button>
        </div>
        <button onClick={() => onFocusEdit("phone", profile.phone)} className={cn("text-sm font-bold text-left w-full transition-colors", profile.phone ? "text-foreground hover:text-primary" : "text-muted-foreground/40 italic")}>
          {profile.phone || "Натисніть для введення"}
        </button>
        {renderHistory(histories.phoneHistory)}
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
          <button onClick={() => onFocusEdit("notes", profile.notes)} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-accent transition-all">
            <Pencil size={11} className="text-muted-foreground" />
          </button>
        </div>
        <button onClick={() => onFocusEdit("notes", profile.notes)} className={cn("text-sm text-left w-full leading-relaxed transition-colors whitespace-pre-wrap", profile.notes ? "font-bold text-foreground hover:text-primary" : "italic text-muted-foreground/40")}>
          {profile.notes || "Додайте нотатки про пацієнта"}
        </button>
        {renderHistory(histories.notesHistory)}
      </div>
    </div>
  );
}

// ── Sidebar Tracker — compact steps with ✓ / ⏳ / ⚠ icons + call button ──
function SidebarTracker({ preparation, status, phone }: {
  preparation: ReturnType<typeof getPreparationProgress>;
  status: PatientStatus;
  phone: string;
}) {
  const firstPendingIdx = preparation.steps.findIndex(s => !s.done);
  const isRisk = status === "risk";

  type StepState = "done" | "inprogress" | "issue" | "pending";
  const getState = (step: { done: boolean }, i: number): StepState => {
    if (step.done) return "done";
    if (i === firstPendingIdx) return isRisk ? "issue" : "inprogress";
    return "pending";
  };

  return (
    <div className="px-4 pb-3 space-y-3">
      {/* Call button */}
      {phone && (
        <a
          href={`tel:${phone}`}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-status-ready text-white text-sm font-bold shadow-sm active:scale-[0.97] transition-all hover:bg-status-ready/90"
        >
          <Phone size={15} strokeWidth={2.5} />
          Зателефонувати
        </a>
      )}

      {/* Steps */}
      <div className="space-y-1">
        {preparation.steps.map((step, i) => {
          const state = getState(step, i);
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
                state === "issue"      && "bg-red-500 text-white",
                state === "pending"    && "bg-muted text-muted-foreground"
              )}>
                {state === "done"       && <Check size={11} strokeWidth={3} />}
                {state === "inprogress" && <Clock size={10} strokeWidth={2.5} />}
                {state === "issue"      && <AlertTriangle size={10} strokeWidth={2.5} />}
                {state === "pending"    && <span className="text-[9px] font-bold">{i + 1}</span>}
              </div>

              {/* Label */}
              <span className={cn(
                "text-xs leading-tight",
                state === "done"       && "text-foreground font-semibold",
                state === "inprogress" && "text-yellow-700 font-semibold",
                state === "issue"      && "text-red-600 font-bold",
                state === "pending"    && "text-muted-foreground"
              )}>
                {step.label}
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

// ── Files Pane — upload and manage documents ──
type FileItem = { id: string, name: string, type: "doctor" | "patient", date: string, url?: string };

const MOCK_FILES: FileItem[] = [
  { id: "mock1", name: "Аналіз крові 20.03.pdf", type: "patient", date: "20.03.2026" },
  { id: "mock2", name: "МРТ черевної порожнини.jpg", type: "patient", date: "18.03.2026" },
  { id: "mock3", name: "Протокол колоноскопії.pdf", type: "doctor", date: "24.03.2026" },
];

function FilesPane({ files, onFilesChange, onFocusEdit, fromForm, protocolText, protocolHistory }: { files: FileItem[], onFilesChange: (files: FileItem[]) => void, onFocusEdit: (field: string, value: string) => void; fromForm?: boolean; protocolText: string, protocolHistory?: Array<{ value: string; timestamp: string; date: string }> }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files).map(file => {
        const today = new Date();
        const dateStr = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
        return {
          id: Math.random().toString(36).substring(7),
          name: file.name,
          type: "doctor" as const,
          date: dateStr,
          url: URL.createObjectURL(file)
        };
      });
      onFilesChange([...files, ...newFiles]);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleViewFile = (file: FileItem) => {
    if (!file.url) {
      alert(`Це тестовий файл "${file.name}". Справжні файли, які ви завантажите, зможете переглянути.`);
    }
  };

  return (
    <div className="px-4 pb-4 space-y-4 relative">
      {/* Delete file confirmation dialog */}
      {confirmDeleteFile && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/20 backdrop-blur-sm animate-fade-in" onClick={() => setConfirmDeleteFile(null)}>
          <div className="bg-surface-raised rounded-xl shadow-elevated p-5 mx-4 max-w-sm w-full animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-foreground mb-1">Видалити файл?</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Ви впевнені, що хочете видалити файл «{files.find(f => f.id === confirmDeleteFile)?.name}»?
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setConfirmDeleteFile(null)}
                className="flex-1 py-2.5 text-sm font-bold text-muted-foreground border border-border rounded-lg hover:bg-muted/40 transition-colors active:scale-[0.97]"
              >
                Скасувати
              </button>
              <button
                onClick={() => {
                  onFilesChange(files.filter((x) => x.id !== confirmDeleteFile));
                  setConfirmDeleteFile(null);
                }}
                className="flex-1 py-2.5 text-sm font-bold bg-destructive text-destructive-foreground rounded-lg transition-colors active:scale-[0.97]"
              >
                Видалити
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Protocol block — always shown, empty for new patients */}
      <div className="rounded-lg border-2 border-[hsl(204,100%,80%)] bg-[hsl(204,100%,97%)] p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <FileText size={12} className="text-primary" />
            Протокол огляду
          </h4>
          <button
            onClick={() => onFocusEdit("protocol", protocolText)}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-accent active:scale-[0.9] transition-all"
          >
            <Pencil size={12} className="text-muted-foreground" />
          </button>
        </div>
        {protocolText ? (
          <>
            <p className="text-sm leading-relaxed text-foreground">{protocolText}</p>
            {renderHistory(protocolHistory)}
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-muted-foreground/40 italic">Протокол ще не заповнено</p>
            {renderHistory(protocolHistory)}
          </>
        )}
      </div>

      {/* Files block — always shown */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
          Файли та аналізи
        </h4>
        {files.map((file) => (
          <div key={file.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-background border border-border/60">
            <FileText size={16} className={file.type === "doctor" ? "text-primary shrink-0" : "text-status-progress shrink-0"} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-foreground truncate">{file.name}</p>
              <p className="text-[10px] text-muted-foreground">
                {file.type === "doctor" ? "Лікар" : "Пацієнт"} · {file.date}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {file.url ? (
                <a 
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-accent active:scale-[0.9] transition-all" 
                  title="Переглянути"
                >
                  <Eye size={12} className="text-muted-foreground" />
                </a>
              ) : (
                <button 
                  onClick={() => handleViewFile(file)}
                  className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-accent active:scale-[0.9] transition-all" 
                  title="Переглянути"
                >
                  <Eye size={12} className="text-muted-foreground" />
                </button>
              )}
              <button 
                onClick={() => setConfirmDeleteFile(file.id)}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-red-50 text-destructive/70 hover:text-destructive active:scale-[0.9] transition-all" 
                title="Видалити"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}

        {/* Hidden file input */}
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
          multiple
          className="hidden" 
          accept="image/*, .pdf, .doc, .docx, .xls, .xlsx, .txt" 
        />

        <button 
          onClick={handleUploadClick}
          className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-primary bg-transparent border border-primary/30 hover:bg-primary/5 rounded-lg py-2.5 transition-colors active:scale-[0.97]"
        >
          <Upload size={14} />
          Завантажити файл
        </button>
      </div>
    </div>
  );
}

// ── Services Pane — uses full ProcedureSelector overlay ──

function ServicesPane({ services, onServicesChange }: { services: string[]; onServicesChange: (s: string[]) => void }) {
  const [showSelector, setShowSelector] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <div className="px-4 pb-4 space-y-2 relative">
      <button
        onClick={() => setShowSelector(true)}
        className="absolute -top-10 right-4 w-6 h-6 flex items-center justify-center rounded-full hover:bg-accent transition-all z-10"
      >
        <Pencil size={11} className="text-muted-foreground" />
      </button>

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
function ChatPane({ chat, unanswered }: { chat: ChatMessage[]; unanswered: ChatMessage[] }) {
  return (
    <div className="mx-5 my-3 rounded-[20px] px-4 py-3 space-y-2.5 overflow-y-auto flex-1 bg-[hsl(220,14%,90%)]">
      {/* Pinned unanswered questions */}
      {unanswered.map((msg, i) => (
        <div
          key={`pinned-${i}`}
          className="rounded-xl px-4 py-3 text-sm leading-relaxed bg-status-risk-bg border-2 border-status-risk/30 shadow-[0_2px_8px_rgba(0,0,0,0.06)] animate-reveal-up"
        >
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle size={14} className="text-status-risk shrink-0" />
            <span className="text-xs font-bold text-status-risk">
              Питання без відповіді · 24.03 | {msg.time}
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
          <div
            key={i}
            className={cn("flex", isPatient ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "rounded-xl px-4 py-2.5 text-sm leading-relaxed max-w-[85%] shadow-[0_2px_6px_rgba(0,0,0,0.06)]",
                isPatient
                  ? "bg-white border border-border/50 rounded-br-sm"
                  : isDoctor
                    ? "bg-primary/15 rounded-bl-sm"
                    : "bg-[hsl(204,100%,94%)] rounded-bl-sm"
              )}
            >
              <p className="text-[11px] font-bold text-muted-foreground mb-0.5">
                {isPatient ? "Пацієнт" : isDoctor ? "Лікар" : "Асистент"} · 24.03 | {msg.time}
              </p>
              <p className="text-foreground">{msg.text}</p>
            </div>
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
function AssistantToggle() {
  const [enabled, setEnabled] = useState(false);

  return (
    <div className="mx-4 mt-3 flex items-center justify-between p-3 rounded-lg bg-primary/5 border border-primary/15">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Headphones size={16} className="text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-foreground">Підключити асистента</p>
          <p className="text-[10px] text-muted-foreground">Асистент надішле інструкції у Viber</p>
        </div>
      </div>
      <button
        onClick={() => setEnabled(!enabled)}
        className={cn(
          "relative w-10 h-[22px] rounded-full transition-all duration-200 shrink-0",
          enabled ? "bg-primary" : "bg-border"
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200",
            enabled ? "left-[22px]" : "left-[3px]"
          )}
        />
      </button>
    </div>
  );
}
