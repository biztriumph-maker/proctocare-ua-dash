import { useState } from "react";
import { Send, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMessage {
  sender: "ai" | "patient";
  text: string;
  time: string;
}

export interface AIAlertDetail {
  id: string;
  patientName: string;
  question: string;
  timestamp: string;
  chatHistory: ChatMessage[];
}

interface AIReplyModalProps {
  alert: AIAlertDetail;
  onClose: () => void;
  onSend: (id: string, message: string) => void;
}

const QUICK_ACTIONS = [
  "Так, можна",
  "Ні, замініть на…",
  "Зателефонуйте в клініку",
];

export function AIReplyModal({ alert, onClose, onSend }: AIReplyModalProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setTimeout(() => {
      onSend(alert.id, text.trim());
    }, 300);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="relative w-full max-w-xl bg-background rounded-t-2xl shadow-2xl animate-slide-up safe-bottom">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/25" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between px-4 pb-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-foreground leading-tight">
              {alert.patientName}
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {alert.timestamp}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-muted/60 text-muted-foreground hover:bg-muted transition-colors active:scale-[0.93]"
          >
            <X size={14} />
          </button>
        </div>

        {/* Chat context */}
        <div className="px-4 pb-3 space-y-2 max-h-48 overflow-y-auto">
          {alert.chatHistory.map((msg, i) => (
            <div
              key={i}
              className={cn(
                "rounded-xl px-3 py-2 text-[12px] leading-relaxed max-w-[85%]",
                msg.sender === "patient"
                  ? "bg-muted/60 text-foreground self-start mr-auto"
                  : "bg-primary/10 text-foreground ml-auto"
              )}
            >
              <p className="text-[10px] font-semibold text-muted-foreground mb-0.5">
                {msg.sender === "patient" ? "Пацієнт" : "ІІ-асистент"} · {msg.time}
              </p>
              <p>{msg.text}</p>
            </div>
          ))}

          {/* The unresolved question */}
          <div className="rounded-xl px-3 py-2 text-[12px] leading-relaxed max-w-[85%] bg-status-risk/10 border border-status-risk/20 mr-auto">
            <p className="text-[10px] font-semibold text-status-risk mb-0.5">
              Питання без відповіді
            </p>
            <p className="text-foreground">{alert.question}</p>
          </div>
        </div>

        {/* Quick actions */}
        <div className="px-4 pb-2 flex flex-wrap gap-1.5">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action}
              onClick={() => setText(action)}
              className="px-3 py-1.5 rounded-full text-[11px] font-medium bg-surface-raised text-foreground shadow-card hover:shadow-card-hover active:scale-[0.96] transition-all duration-200"
            >
              {action}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className="px-4 pb-4 pt-1">
          <div className="flex items-end gap-2 bg-muted/40 rounded-xl p-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ваша відповідь…"
              rows={2}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none min-h-[40px] max-h-24"
            />
            <button
              onClick={handleSend}
              disabled={!text.trim() || sending}
              className={cn(
                "w-9 h-9 flex items-center justify-center rounded-full shrink-0 transition-all duration-200 active:scale-[0.93]",
                text.trim()
                  ? "bg-primary text-primary-foreground shadow-card"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <Send size={15} className={sending ? "animate-pulse" : ""} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
