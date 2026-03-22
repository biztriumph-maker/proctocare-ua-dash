import { MessageCircle } from "lucide-react";
import { useState } from "react";

interface AIAlert {
  id: string;
  patientName: string;
  question: string;
}

interface AIAlertSectionProps {
  alerts: AIAlert[];
  onReply: (id: string) => void;
  onOpenReply: (id: string) => void;
}

export function AIAlertSection({ alerts, onReply, onOpenReply }: AIAlertSectionProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());

  const dismissAlert = (id: string) => {
    setAnimatingIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setDismissedIds((prev) => new Set(prev).add(id));
      setAnimatingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      onReply(id);
    }, 400);
  };

  const visible = alerts.filter((a) => !dismissedIds.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="rounded-lg border-2 border-status-progress/30 bg-status-progress-bg p-3 space-y-2 animate-reveal-up">
      <div className="flex items-center gap-2">
        <span className="text-sm">🤖</span>
        <h3 className="text-xs font-semibold text-foreground">
          ІІ потребує допомоги
        </h3>
        <span className="ml-auto bg-status-progress text-white text-[10px] font-bold px-2 py-0.5 rounded-full tabular-nums">
          {visible.length}
        </span>
      </div>
      <div className="space-y-1.5">
        {visible.map((alert) => (
          <div
            key={alert.id}
            className={`flex items-center justify-between gap-2 bg-surface-raised rounded-md p-2.5 shadow-card transition-all duration-300 ${
              animatingIds.has(alert.id)
                ? "opacity-0 translate-x-full max-h-0 py-0 my-0 overflow-hidden"
                : "opacity-100 translate-x-0 max-h-24"
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-foreground truncate">
                {alert.patientName}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {alert.question}
              </p>
            </div>
            <button
              onClick={() => onOpenReply(alert.id)}
              disabled={animatingIds.has(alert.id)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-status-progress text-white text-[11px] font-medium shrink-0 transition-all duration-200 hover:shadow-card-hover active:scale-[0.96] disabled:opacity-50"
            >
              <MessageCircle size={12} />
              Відповісти
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
