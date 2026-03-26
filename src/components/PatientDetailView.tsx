import { useState } from "react";
import { X, MessageCircle, AlertTriangle, User, Activity, Phone, Mic, Pencil, FileText, Upload, Plus, Eye, Trash2, ClipboardList, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Patient, PatientStatus } from "./PatientCard";
import { useIsMobile } from "@/hooks/use-mobile";
import { Progress } from "@/components/ui/progress";
import { ProcedureSelector } from "./ProcedureSelector";

interface ChatMessage {
  sender: "ai" | "patient" | "doctor";
  text: string;
  time: string;
  unanswered?: boolean;
}

interface PatientDetailViewProps {
  patient: Patient;
  onClose: () => void;
}

const statusLabel: Record<PatientStatus, string> = {
  ready: "Допущено до процедури",
  progress: "Підготовка триває",
  risk: "Потребує уваги",
};

const statusDot: Record<PatientStatus, string> = {
  ready: "bg-status-ready",
  progress: "bg-status-progress",
  risk: "bg-status-risk",
};

const statusBadgeBg: Record<PatientStatus, string> = {
  ready: "bg-status-ready-bg text-status-ready",
  progress: "bg-status-progress-bg text-status-progress",
  risk: "bg-status-risk-bg text-status-risk",
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

function getMockProfile(patient: Patient) {
  const birthDateStr = patient.birthDate || "";
  const { ageStr } = calcAge(birthDateStr);
  return {
    birthDate: birthDateStr,
    age: ageStr,
    phone: "+380 67 123 45 67",
    allergies: "Пеніцилін",
    diagnosis: "Поліп сигмовидної кишки (K63.5)",
    lastVisit: "12.01.2026",
    notes: "Хронічний гастрит. Приймає омепразол 20мг.",
  };
}

function getMockChat(patient: Patient): ChatMessage[] {
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

function getPreparationProgress(status: PatientStatus): { percent: number; steps: { label: string; done: boolean }[] } {
  const steps = [
    { label: "Дієта 3 дні", done: status === "ready" || status === "progress" || status === "risk" },
    { label: "Прийом препарату", done: status === "ready" || status === "progress" },
    { label: "Очищення завершено", done: status === "ready" },
    { label: "Аналізи в нормі", done: status === "ready" },
  ];
  const doneCount = steps.filter(s => s.done).length;
  const percent = Math.round((doneCount / 4) * 100);
  return { percent, steps };
}

export function PatientDetailView({ patient, onClose }: PatientDetailViewProps) {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<"card" | "assistant" | "files">("card");
  const [focusField, setFocusField] = useState<{ field: string; value: string } | null>(null);
  const profile = getMockProfile(patient);
  const chat = getMockChat(patient);
  const unanswered = chat.filter((m) => m.unanswered);
  const preparation = getPreparationProgress(patient.status);

  const handleFocusOpen = (field: string, value: string) => {
    setFocusField({ field, value });
  };

  const handleFocusSave = () => {
    // In real app, save the value
    setFocusField(null);
  };

  const handleFocusCancel = () => {
    setFocusField(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />

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
            <div className="flex items-center gap-2.5 mb-1">
              <span className={cn("w-3 h-3 rounded-full shrink-0", statusDot[patient.status])} />
              <h2 className="text-base sm:text-lg font-bold text-foreground leading-tight truncate">
                {patient.name}
              </h2>
            </div>
            <div className="flex items-center gap-2.5 mb-1">
              <span className={cn("text-xs font-bold px-2.5 py-0.5 rounded-full", statusBadgeBg[patient.status])}>
                {statusLabel[patient.status]}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs flex-wrap">
              <span className="text-muted-foreground font-normal">Дата:</span>
              <span className="font-bold text-foreground">24.03.2026</span>
              <span className="text-muted-foreground">|</span>
              <span className="text-muted-foreground font-normal">Час:</span>
              <span className="font-bold text-foreground">{patient.time}</span>
              <span className="text-muted-foreground">|</span>
              <span className="font-bold text-foreground">{patient.procedure}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={`tel:${profile.phone}`}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-status-ready text-white shadow-sm active:scale-[0.93] transition-all"
            >
              <Phone size={16} />
            </a>
            <button
              onClick={onClose}
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
                    <ProfilePane profile={profile} onFocusEdit={handleFocusOpen} />
                  </ContentBlock>
                  <ContentBlock title="Послуги" icon={<ClipboardList size={13} />}>
                    <ServicesPane />
                  </ContentBlock>
                  <ContentBlock title="Трекер підготовки" icon={<Activity size={13} />}>
                    <TrackerPane preparation={preparation} status={patient.status} />
                  </ContentBlock>
                </div>
              ) : activeTab === "files" ? (
                <div className="p-4 space-y-3">
                  <ContentBlock title="Обстеження та Файли" icon={<FileText size={13} />}>
                    <FilesPane onFocusEdit={handleFocusOpen} />
                  </ContentBlock>
                </div>
              ) : (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <ChatPane chat={chat} unanswered={unanswered} />
                  <ChatInput />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Left column: 40% */}
            <div className="w-[40%] overflow-y-auto shrink-0 p-4 space-y-3">
              <ContentBlock title="Профіль пацієнта" icon={<User size={13} />}>
                <ProfilePane profile={profile} onFocusEdit={handleFocusOpen} />
              </ContentBlock>
              <ContentBlock title="Послуги" icon={<ClipboardList size={13} />}>
                <ServicesPane />
              </ContentBlock>
              <ContentBlock title="Трекер підготовки" icon={<Activity size={13} />}>
                <TrackerPaneCompact preparation={preparation} status={patient.status} />
              </ContentBlock>
              <ContentBlock title="Обстеження та Файли" icon={<FileText size={13} />}>
                <FilesPane onFocusEdit={handleFocusOpen} />
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
                <ChatPane chat={chat} unanswered={unanswered} />
                <ChatInput />
              </ContentBlock>
            </div>
          </div>
        )}

        {/* ── Focus Mode Overlay ── */}
        {focusField && (
          <FocusOverlay
            field={focusField.field}
            value={focusField.value}
            patientName={patient.name}
            allergies={profile.allergies}
            onSave={handleFocusSave}
            onCancel={handleFocusCancel}
          />
        )}
      </div>
    </div>
  );
}

// ── Focus Mode Overlay ──
function FocusOverlay({ field, value, patientName, allergies, onSave, onCancel }: {
  field: string;
  value: string;
  patientName: string;
  allergies: string;
  onSave: () => void;
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
              <p className="text-xs font-bold text-status-risk bg-status-risk-bg px-2 py-0.5 rounded-md inline-block mt-0.5">
                ⚠ Алергія: {allergies}
              </p>
            </div>
          </div>
        </div>

        {/* Centered editing area — 70-80% of workspace */}
        <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
          <div className="w-full max-w-3xl bg-card rounded-2xl shadow-2xl border border-border/40 overflow-hidden" style={{ maxHeight: "75vh" }}>
            <div className="px-5 py-3 border-b border-border/40 bg-[hsl(204,100%,97%)]">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Pencil size={14} className="text-primary" />
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
            <div className="px-5 py-3 border-t border-border/40 flex items-center justify-end gap-3">
              <button
                onClick={onCancel}
                className="px-5 py-2 text-sm font-bold text-muted-foreground bg-transparent border border-border rounded-lg hover:bg-muted/40 transition-colors active:scale-[0.97]"
              >
                Скасувати
              </button>
              <button
                onClick={onSave}
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
  icon: React.ReactNode;
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
function ProfilePane({ profile, onFocusEdit }: { profile: ReturnType<typeof getMockProfile>; onFocusEdit: (field: string, value: string) => void }) {
  const editValues = {
    phone: profile.phone,
    allergies: profile.allergies,
    diagnosis: profile.diagnosis,
    notes: profile.notes,
  };

  const rows = [
    { label: "Дата народження", value: profile.birthDate || "—" },
    { label: "Вік", value: profile.age },
    { label: "Телефон", value: editValues.phone, editable: true, field: "phone" },
    { label: "Алергії", value: editValues.allergies, highlight: true, editable: true, field: "allergies" },
    { label: "Діагноз", value: editValues.diagnosis, editable: true, field: "diagnosis" },
    { label: "Останній візит", value: profile.lastVisit },
    { label: "Нотатки", value: editValues.notes, editable: true, field: "notes" },
  ];

  return (
    <div className="px-4 pb-4 space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="flex items-center gap-1.5 mb-0.5">
            <p className="text-[11px] font-normal text-muted-foreground uppercase tracking-wide">
              {row.label}
            </p>
            {row.editable && (
              <button
                onClick={() => onFocusEdit(row.field!, editValues[row.field as keyof typeof editValues])}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-accent active:scale-[0.9] transition-all"
              >
                <Pencil size={14} className="text-muted-foreground" />
              </button>
            )}
          </div>
          {row.highlight ? (
            <p className="text-sm leading-snug font-bold text-status-risk bg-status-risk-bg px-2 py-1 rounded-md inline-block">
              ⚠ {row.value}
            </p>
          ) : (
            <button
              onClick={() => row.editable && onFocusEdit(row.field!, editValues[row.field as keyof typeof editValues])}
              className={cn("text-sm leading-snug font-bold text-foreground text-left", row.editable && "cursor-pointer hover:text-primary transition-colors")}
            >
              {row.value}
            </button>
          )}
        </div>
      ))}
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
          <span className={cn(
            "text-sm font-bold tabular-nums",
            status === "ready" ? "text-status-ready" : status === "progress" ? "text-status-progress" : "text-status-risk"
          )}>
            {preparation.percent}%
          </span>
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
          <span className={cn(
            "text-xs font-bold tabular-nums",
            status === "ready" ? "text-status-ready" : status === "progress" ? "text-status-progress" : "text-status-risk"
          )}>
            {preparation.percent}%
          </span>
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

// ── Files Pane — upload and manage documents ──
const MOCK_FILES = [
  { name: "Аналіз крові 20.03.pdf", type: "patient" as const, date: "20.03.2026" },
  { name: "МРТ черевної порожнини.jpg", type: "patient" as const, date: "18.03.2026" },
  { name: "Протокол колоноскопії.pdf", type: "doctor" as const, date: "24.03.2026" },
];

function FilesPane({ onFocusEdit }: { onFocusEdit: (field: string, value: string) => void }) {
  const [protocolText] = useState("Огляд проведено. Слизова без патологій. Рекомендовано контрольний огляд через 6 місяців.");

  return (
    <div className="px-4 pb-4 space-y-4">
      {/* Protocol block — highlighted with blue border */}
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
        <p className="text-sm leading-relaxed text-foreground">{protocolText}</p>
      </div>

      {/* Files block */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
          Файли та аналізи
        </h4>
        {MOCK_FILES.map((file, i) => (
          <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-background border border-border/60">
            <FileText size={16} className={file.type === "doctor" ? "text-primary shrink-0" : "text-status-progress shrink-0"} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-foreground truncate">{file.name}</p>
              <p className="text-[10px] text-muted-foreground">
                {file.type === "doctor" ? "Лікар" : "Пацієнт"} · {file.date}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-accent active:scale-[0.9] transition-all" title="Переглянути">
                <Eye size={12} className="text-muted-foreground" />
              </button>
              <button className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-accent active:scale-[0.9] transition-all" title="Редагувати">
                <Pencil size={12} className="text-muted-foreground" />
              </button>
            </div>
          </div>
        ))}
        <button className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-primary bg-transparent border border-primary/30 hover:bg-primary/5 rounded-lg py-2.5 transition-colors active:scale-[0.97]">
          <Upload size={14} />
          Завантажити файл
        </button>
      </div>
    </div>
  );
}

// ── Services Pane — list without prices, editable ──
const MOCK_SERVICES = [
  "Колоноскопія з медичним сном",
  "Взяття біопсії одноразовими щипцями",
];

function ServicesPane() {
  const [services, setServices] = useState<string[]>(MOCK_SERVICES);
  const [showAdd, setShowAdd] = useState(false);

  const ALL_SERVICES = [
    "Колоноскопія",
    "Колоноскопія з медичним сном",
    "Гастроскопія",
    "Ректоскопія з використанням ендоскопу",
    "Взяття біопсії одноразовими щипцями",
    "Поліпектомія при колоноскопії 1 клас 1А",
    "Медичний сон до 20хв.",
  ];

  const available = ALL_SERVICES.filter((s) => !services.includes(s));

  return (
    <div className="px-4 pb-4 space-y-2">
      {services.length > 0 ? (
        <div className="space-y-1.5">
          {services.map((s) => (
            <div key={s} className="flex items-center gap-2 p-2.5 rounded-lg bg-background border border-border/60">
              <span className="text-xs font-bold text-foreground flex-1">{s}</span>
              <button
                onClick={() => setServices((prev) => prev.filter((x) => x !== s))}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-destructive/10 active:scale-[0.9] transition-all"
                title="Видалити"
              >
                <Trash2 size={12} className="text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground py-2 text-center">Послуги не додані</p>
      )}
      <button
        onClick={() => setShowAdd(!showAdd)}
        className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-primary bg-transparent border border-primary/30 hover:bg-primary/5 rounded-lg py-2.5 transition-colors active:scale-[0.97]"
      >
        <Plus size={14} />
        Додати послугу
      </button>
      {showAdd && (
        <div className="space-y-1 animate-reveal-up">
          {available.map((item) => (
            <button
              key={item}
              onClick={() => {
                setServices((prev) => [...prev, item]);
                setShowAdd(false);
              }}
              className="w-full flex items-center p-2.5 rounded-lg text-left bg-background border border-border/60 hover:bg-accent/40 transition-colors active:scale-[0.98]"
            >
              <span className="text-xs font-bold text-foreground">{item}</span>
            </button>
          ))}
        </div>
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
