import { useState } from "react";
import { X, MessageCircle, AlertTriangle, User, Activity, Phone, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Patient, PatientStatus } from "./PatientCard";
import { useIsMobile } from "@/hooks/use-mobile";
import { Progress } from "@/components/ui/progress";

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

function getMockProfile(patient: Patient) {
  return {
    age: 47,
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
  const [activeTab, setActiveTab] = useState<"card" | "assistant">("card");
  const profile = getMockProfile(patient);
  const chat = getMockChat(patient);
  const unanswered = chat.filter((m) => m.unanswered);
  const preparation = getPreparationProgress(patient.status);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />

      {/* Modal — light grey bg */}
      <div className="relative w-full max-w-4xl bg-[hsl(210,40%,96%)] rounded-t-2xl sm:rounded-2xl shadow-2xl animate-slide-up safe-bottom max-h-[92vh] overflow-hidden flex flex-col">
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
            {/* Separate date/time line */}
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
            {/* Tab bar */}
            <div className="flex gap-1 p-1.5 mx-4 mt-2 rounded-xl bg-[hsl(199,89%,86%)] border border-sky-300/60">
              {([
                { key: "card" as const, label: "Карта", icon: <User size={14} /> },
                { key: "assistant" as const, label: "ШІ Асистент", icon: <MessageCircle size={14} />, badge: unanswered.length },
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
                  {tab.badge && tab.badge > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-status-risk animate-pulse" />
                  )}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">
              {activeTab === "card" ? (
                <div className="p-4 space-y-3">
                  <ContentBlock title="Профіль пацієнта" icon={<User size={13} />}>
                    <ProfilePane profile={profile} />
                  </ContentBlock>
                  <ContentBlock title="Трекер підготовки" icon={<Activity size={13} />}>
                    <TrackerPane preparation={preparation} status={patient.status} />
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
            <div className="w-[300px] xl:w-[340px] overflow-y-auto shrink-0 p-4 space-y-3">
              <ContentBlock title="Профіль пацієнта" icon={<User size={13} />}>
                <ProfilePane profile={profile} />
              </ContentBlock>
              <ContentBlock title="Трекер підготовки" icon={<Activity size={13} />}>
                <TrackerPaneCompact preparation={preparation} status={patient.status} />
              </ContentBlock>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden p-4 pl-0">
              <ContentBlock title="Штучний інтелект" icon={<MessageCircle size={13} />} className="flex-1 flex flex-col overflow-hidden"
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

// ── Profile Pane ──
function ProfilePane({ profile }: { profile: ReturnType<typeof getMockProfile> }) {
  const rows = [
    { label: "Вік", value: `${profile.age} років` },
    { label: "Телефон", value: profile.phone },
    { label: "Алергії", value: profile.allergies, highlight: true },
    { label: "Діагноз", value: profile.diagnosis },
    { label: "Останній візит", value: profile.lastVisit },
    { label: "Нотатки", value: profile.notes },
  ];

  return (
    <div className="px-4 pb-4 space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <p className="text-[11px] font-normal text-muted-foreground uppercase tracking-wide mb-0.5">
            {row.label}
          </p>
          {row.highlight ? (
            <p className="text-sm leading-snug font-bold text-status-risk bg-status-risk-bg px-2 py-1 rounded-md inline-block">
              ⚠ {row.value}
            </p>
          ) : (
            <p className="text-sm leading-snug font-bold text-foreground">{row.value}</p>
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

// ── Chat Pane ──
function ChatPane({ chat, unanswered }: { chat: ChatMessage[]; unanswered: ChatMessage[] }) {
  return (
    <div className="px-4 py-3 space-y-2.5 overflow-y-auto flex-1">
      {/* Pinned unanswered questions */}
      {unanswered.map((msg, i) => (
        <div
          key={`pinned-${i}`}
          className="rounded-xl px-4 py-3 text-sm leading-relaxed bg-status-risk-bg border-2 border-status-risk/30 animate-reveal-up"
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

      {/* Chat history */}
      {chat.filter((m) => !m.unanswered).map((msg, i) => (
        <div
          key={i}
          className={cn(
            "rounded-xl px-4 py-2.5 text-sm leading-relaxed max-w-[85%]",
            msg.sender === "patient"
              ? "bg-card text-foreground mr-auto border border-border/40"
              : msg.sender === "doctor"
                ? "bg-primary/15 text-foreground ml-auto"
                : "bg-[hsl(200,80%,96%)] text-foreground ml-auto"
          )}
        >
          <p className="text-xs font-bold text-muted-foreground mb-0.5">
            {msg.sender === "patient" ? "Пацієнт" : msg.sender === "doctor" ? "Лікар" : "ШІ-асистент"} · {msg.time}
          </p>
          <p>{msg.text}</p>
        </div>
      ))}
    </div>
  );
}

// ── Chat Input ──
function ChatInput() {
  const [value, setValue] = useState("");

  return (
    <div className="px-4 py-3 border-t border-border/40 bg-card shrink-0">
      <div className="flex items-center gap-2 bg-[hsl(204,100%,95%)] rounded-xl px-3 py-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Відповісти..."
          className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground"
        />
        <button className="w-10 h-10 flex items-center justify-center rounded-full bg-status-progress text-white hover:opacity-90 active:scale-[0.93] transition-all">
          <Mic size={22} />
        </button>
      </div>
    </div>
  );
}
