import { useState, useRef, useEffect } from "react";
import { AlertTriangle, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PatientStatus } from "./PatientCard";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface ChatMessage {
  sender: "ai" | "patient" | "doctor";
  text: string;
  time: string;
  unanswered?: boolean;
  _dbId?: string;
  quickReply?: {
    yes: string;
    no?: string;
    context?: "greeting" | "diet" | "start_prep" | "drug_choice" | "question_resolved" | "diet_confirm";
  };
}

export type EventLog = {
  timestamp: string;
  event: string;
  status: "pending" | "completed" | "warning" | "error";
};

type Preparation = { percent: number; steps: { label: string; done: boolean }[] };

// ── Bold text renderer ────────────────────────────────────────────────────────

// Phone-like pattern: digits, spaces, dashes, plus — no letters.
const PHONE_RE = /^[\d\s\-+().]{7,20}$/;

export function renderBoldText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          const inner = part.slice(2, -2);
          return PHONE_RE.test(inner.trim())
            ? <strong key={i} style={{ whiteSpace: "nowrap" }}>{inner}</strong>
            : <strong key={i}>{inner}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// ── System History Modal ──────────────────────────────────────────────────────

export function HistoryModal({ isOpen, onClose, chat, eventLogs = [] }: {
  isOpen: boolean;
  onClose: () => void;
  chat: ChatMessage[];
  eventLogs?: EventLog[];
}) {
  if (!isOpen) return null;

  const systemMessages = chat.filter(
    (m) => !m.unanswered && m.sender === "ai" &&
      (m.text.includes("Підготовку") || m.text.includes("Вітальне") || m.text.includes("перезапущено"))
  );

  const getStatusColor = (status: string): string => {
    switch (status) {
      case "completed": return "text-green-700 bg-green-50";
      case "warning":   return "text-yellow-700 bg-yellow-50";
      case "error":     return "text-red-700 bg-red-50";
      default:          return "text-slate-600 bg-slate-50";
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-xl shadow-xl border border-border/60 w-full max-w-2xl max-h-[75vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
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
              {eventLogs.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-foreground mb-2 uppercase opacity-60">Подорож</h4>
                  <div className="space-y-1">
                    {eventLogs.map((log, i) => (
                      <div key={i} className={cn("flex gap-3 px-3 py-2 rounded border", getStatusColor(log.status))}>
                        <span className="font-mono text-[10px] shrink-0 whitespace-nowrap">{log.timestamp}</span>
                        <span className="text-xs flex-1">{log.event}</span>
                        <span className="text-[10px] font-semibold uppercase shrink-0">
                          {log.status === "completed" ? "✓" : log.status === "error" ? "✗" : log.status === "warning" ? "!" : "○"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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

// ── Linear Progress Timeline ──────────────────────────────────────────────────

export function LinearProgressBar({
  preparation,
  dietInstructionSent = false,
  step2AckResult = "none",
}: {
  preparation: Preparation;
  status: PatientStatus;
  waitingForDietAck?: boolean;
  dietInstructionSent?: boolean;
  waitingForStep2Ack?: boolean;
  step2AckResult?: "none" | "confirmed" | "question";
}) {
  const lastStepIdx = preparation.steps.length - 1;

  const getSegmentColor = (i: number): string => {
    const isDone   = preparation.steps[i]?.done ?? false;
    const isFailed = step2AckResult === "question" && i === lastStepIdx;

    if (isFailed)              return "bg-red-500";
    if (isDone && i === lastStepIdx) return "bg-green-500";
    if (isDone)                return "bg-yellow-400";
    return "bg-gray-200";
  };

  return (
    <div className="px-4 pb-3 pt-4">
      <div className="flex justify-between mb-2 gap-1">
        {preparation.steps.map((step, i) => (
          <div key={`label-${i}`} className="flex-1 min-w-0 flex flex-col items-center overflow-hidden">
            <p
              className="text-[8px] font-semibold text-center leading-tight text-foreground truncate w-full max-w-full px-0.5"
              title={step.label}
            >
              {step.label}
            </p>
          </div>
        ))}
      </div>
      <div className="flex gap-0.5 h-1">
        {preparation.steps.map((_step, i) => (
          <div key={`segment-${i}`} className={cn("flex-1 rounded-sm transition-colors", getSegmentColor(i))} />
        ))}
      </div>
    </div>
  );
}

// ── Chat Pane ─────────────────────────────────────────────────────────────────

export function ChatPane({
  chat,
  unanswered,
  onQuickReply,
  onHasQuestion,
  isTyping,
}: {
  chat: ChatMessage[];
  unanswered: ChatMessage[];
  onQuickReply?: (answer: "yes" | "no", context?: "greeting" | "diet" | "start_prep" | "drug_choice" | "question_resolved" | "diet_confirm") => void;
  onHasQuestion?: () => void;
  isTyping?: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeMessages = chat.filter(
    (m) => !(m.sender === "ai" && (m.text.includes("Підготовку") || m.text.includes("Вітальне") || m.text.includes("перезапущено")))
  );
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
        const isLastMessage = i === activeMessages.length - 1;
        return (
          <div key={msg._dbId ?? i} className={cn("flex flex-col", isPatient || isDoctor ? "items-end" : "items-start")}>
            <div className={cn(
              "rounded-2xl px-4 py-2.5 text-sm leading-relaxed max-w-[86%] shadow-[0_2px_8px_rgba(0,0,0,0.07)] whitespace-pre-wrap",
              isDoctor  ? "bg-green-100 border border-green-300 rounded-br-sm text-green-900"
              : isPatient ? "bg-white border border-gray-300 rounded-br-sm text-gray-900"
                          : "bg-yellow-50 border border-yellow-300 rounded-bl-sm text-yellow-900"
            )}>
              <p className={cn("text-[11px] font-bold mb-0.5", isDoctor ? "text-green-700" : isPatient ? "text-gray-600" : "text-yellow-700")}>
                {isDoctor ? "Лікар" : isPatient ? "Клієнт" : "Асистент"} · {msg.time}
              </p>
              <p className="text-foreground">{renderBoldText(msg.text)}</p>
            </div>

            {/* QuickReply buttons — only shown on the last message in the conversation */}
            {msg.quickReply && onQuickReply && isLastMessage && (
              <div className="flex flex-col md:flex-row gap-2 mt-2 w-full md:w-auto">
                <button
                  onClick={() => onQuickReply("yes", msg.quickReply?.context)}
                  className="w-full md:w-auto text-[12px] font-bold px-4 py-1.5 rounded-full bg-green-600 text-white hover:bg-green-700 active:scale-[0.94] transition-all shadow-sm text-center"
                >
                  {msg.quickReply.yes}
                </button>
                {msg.quickReply.no && (
                  <button
                    onClick={() => onQuickReply("no", msg.quickReply?.context)}
                    className={cn(
                      "w-full md:w-auto text-center text-[12px] font-bold px-4 py-1.5 rounded-full active:scale-[0.94] transition-all shadow-sm",
                      msg.quickReply.context === "drug_choice"
                        ? "bg-white border border-slate-300 text-foreground hover:bg-slate-50"
                        : "bg-amber-400 text-white hover:bg-amber-500"
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

      {/* Typing indicator */}
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

// ── Chat Input ────────────────────────────────────────────────────────────────

export function ChatInput({ onSend }: { onSend?: (text: string) => void }) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const newHeight = Math.min(Math.max(36, textareaRef.current.scrollHeight), 120);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  };

  const handleSend = () => {
    if (value.trim()) {
      onSend?.(value.trim());
      setValue("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
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
