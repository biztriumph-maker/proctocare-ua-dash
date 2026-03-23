import { useState } from "react";
import { X, MessageCircle, AlertTriangle, User, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Patient, PatientStatus } from "./PatientCard";
import { useIsMobile } from "@/hooks/use-mobile";

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

// Mock profile data
function getMockProfile(patient: Patient) {
  return {
    age: 47,
    allergies: "Пеніцилін",
    diagnosis: "Поліп сигмовидної кишки (K63.5)",
    lastVisit: "12.01.2026",
    notes: "Хронічний гастрит. Приймає омепразол 20мг.",
  };
}

// Mock chat data
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

export function PatientDetailView({ patient, onClose }: PatientDetailViewProps) {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<"profile" | "chat">("chat");
  const profile = getMockProfile(patient);
  const chat = getMockChat(patient);
  const unanswered = chat.filter((m) => m.unanswered);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-3xl bg-background rounded-t-2xl sm:rounded-2xl shadow-2xl animate-slide-up safe-bottom max-h-[92vh] overflow-hidden flex flex-col">
        {/* Handle (mobile) */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/25" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between px-4 sm:px-6 pb-3 pt-2 sm:pt-4 border-b border-border/60">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", statusDot[patient.status])} />
              <h2 className="text-base font-bold text-foreground leading-tight truncate">
                {patient.name}
              </h2>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", statusBadgeBg[patient.status])}>
                {statusLabel[patient.status]}
              </span>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock size={10} />
                {patient.time} · {patient.procedure}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-muted/60 text-muted-foreground hover:bg-muted transition-colors active:scale-[0.93] shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Mobile: tabs | Desktop: side-by-side */}
        {isMobile ? (
          <>
            {/* Tab bar */}
            <div className="flex border-b border-border/60">
              <button
                onClick={() => setActiveTab("profile")}
                className={cn(
                  "flex-1 py-2.5 text-xs font-semibold transition-all active:scale-[0.97]",
                  activeTab === "profile"
                    ? "text-foreground border-b-2 border-primary"
                    : "text-muted-foreground"
                )}
              >
                <User size={14} className="inline mr-1 -mt-0.5" />
                Профіль
              </button>
              <button
                onClick={() => setActiveTab("chat")}
                className={cn(
                  "flex-1 py-2.5 text-xs font-semibold transition-all active:scale-[0.97] relative",
                  activeTab === "chat"
                    ? "text-foreground border-b-2 border-primary"
                    : "text-muted-foreground"
                )}
              >
                <MessageCircle size={14} className="inline mr-1 -mt-0.5" />
                Чат
                {unanswered.length > 0 && (
                  <span className="absolute top-1.5 right-[calc(50%-24px)] w-2 h-2 rounded-full bg-status-risk animate-pulse" />
                )}
              </button>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto">
              {activeTab === "profile" ? (
                <ProfilePane profile={profile} />
              ) : (
                <ChatPane chat={chat} unanswered={unanswered} />
              )}
            </div>
          </>
        ) : (
          /* Desktop: side-by-side */
          <div className="flex flex-1 overflow-hidden">
            <div className="w-[280px] border-r border-border/60 overflow-y-auto">
              <div className="px-4 py-3 border-b border-border/40">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                  <User size={12} className="inline mr-1 -mt-0.5" />
                  Профіль
                </h3>
              </div>
              <ProfilePane profile={profile} />
            </div>
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                  <MessageCircle size={12} className="inline mr-1 -mt-0.5" />
                  Чат підготовки
                </h3>
                {unanswered.length > 0 && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-status-risk bg-status-risk-bg px-2 py-0.5 rounded-full">
                    <AlertTriangle size={10} />
                    {unanswered.length} без відповіді
                  </span>
                )}
              </div>
              <ChatPane chat={chat} unanswered={unanswered} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Profile Pane ──
function ProfilePane({ profile }: { profile: ReturnType<typeof getMockProfile> }) {
  const rows = [
    { label: "Вік", value: `${profile.age} років` },
    { label: "Алергії", value: profile.allergies, highlight: true },
    { label: "Діагноз", value: profile.diagnosis },
    { label: "Останній візит", value: profile.lastVisit },
    { label: "Нотатки", value: profile.notes },
  ];

  return (
    <div className="p-4 space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-0.5">
            {row.label}
          </p>
          <p className={cn(
            "text-[13px] leading-snug",
            row.highlight ? "text-status-risk font-semibold" : "text-foreground"
          )}>
            {row.value}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Chat Pane ──
function ChatPane({ chat, unanswered }: { chat: ChatMessage[]; unanswered: ChatMessage[] }) {
  return (
    <div className="p-4 space-y-2 overflow-y-auto flex-1">
      {/* Pinned unanswered questions */}
      {unanswered.map((msg, i) => (
        <div
          key={`pinned-${i}`}
          className="rounded-xl px-3 py-2.5 text-[12px] leading-relaxed bg-status-risk-bg border-2 border-status-risk/30 animate-reveal-up"
        >
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle size={12} className="text-status-risk shrink-0" />
            <span className="text-[10px] font-bold text-status-risk">
              Питання без відповіді · {msg.time}
            </span>
          </div>
          <p className="text-foreground font-medium">{msg.text}</p>
        </div>
      ))}

      {/* Chat history */}
      {chat.filter((m) => !m.unanswered).map((msg, i) => (
        <div
          key={i}
          className={cn(
            "rounded-xl px-3 py-2 text-[12px] leading-relaxed max-w-[85%]",
            msg.sender === "patient"
              ? "bg-muted/60 text-foreground mr-auto"
              : msg.sender === "doctor"
                ? "bg-primary/15 text-foreground ml-auto"
                : "bg-primary/8 text-foreground ml-auto"
          )}
        >
          <p className="text-[10px] font-semibold text-muted-foreground mb-0.5">
            {msg.sender === "patient" ? "Пацієнт" : msg.sender === "doctor" ? "Лікар" : "ІІ-асистент"} · {msg.time}
          </p>
          <p>{msg.text}</p>
        </div>
      ))}
    </div>
  );
}
