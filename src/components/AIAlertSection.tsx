import { MessageCircle, ChevronDown } from "lucide-react";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";

interface AIAlert {
  id: string;
  patientName: string;
  question: string;
  appointmentDate: Date;
  appointmentTime: string;
}

interface AIAlertSectionProps {
  alerts: AIAlert[];
  onReply: (id: string) => void;
  onOpenReply: (id: string) => void;
}

function getDateBadge(date: Date): { label: string; className: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) {
    return { label: "СЬОГОДНІ", className: "text-white bg-status-risk font-bold" };
  }
  if (diffDays === 1) {
    return { label: "ЗАВТРА", className: "text-white bg-status-progress font-bold" };
  }
  const formatted = date.toLocaleDateString("uk-UA", { day: "numeric", month: "short" }).toUpperCase().replace(".", "");
  return { label: formatted, className: "text-muted-foreground bg-muted font-bold" };
}

function getDaysUntil(date: Date): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function AIAlertSection({ alerts, onReply, onOpenReply }: AIAlertSectionProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());
  const [showDeferred, setShowDeferred] = useState(false);

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

  const visible = useMemo(() => {
    return alerts
      .filter((a) => !dismissedIds.has(a.id))
      .sort((a, b) => {
        const dateA = new Date(a.appointmentDate).getTime() + parseInt(a.appointmentTime) * 60000;
        const dateB = new Date(b.appointmentDate).getTime() + parseInt(b.appointmentTime) * 60000;
        return dateA - dateB;
      });
  }, [alerts, dismissedIds]);

  const { urgent, deferred } = useMemo(() => {
    const urg: typeof visible = [];
    const def: typeof visible = [];
    visible.forEach((a) => {
      if (getDaysUntil(a.appointmentDate) > 3) {
        def.push(a);
      } else {
        urg.push(a);
      }
    });
    return { urgent: urg, deferred: def };
  }, [visible]);

  if (visible.length === 0) return null;

  const renderCard = (alert: AIAlert) => {
    const badge = getDateBadge(alert.appointmentDate);
    return (
      <div
        key={alert.id}
        className={cn(
          "flex items-center justify-between gap-3 bg-surface-raised rounded-lg p-3 shadow-card transition-all duration-300",
          animatingIds.has(alert.id)
            ? "opacity-0 translate-x-full max-h-0 py-0 my-0 overflow-hidden"
            : "opacity-100 translate-x-0 max-h-24"
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-semibold text-foreground truncate">
              {alert.patientName}
            </p>
            <span className={cn("text-[10px] px-2 py-0.5 rounded-full shrink-0", badge.className)}>
              {badge.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {alert.question}
          </p>
        </div>
        <button
          onClick={() => onOpenReply(alert.id)}
          disabled={animatingIds.has(alert.id)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-status-progress text-white text-xs font-semibold shrink-0 transition-all duration-200 hover:shadow-card-hover active:scale-[0.96] disabled:opacity-50"
        >
          <MessageCircle size={14} />
          Відповісти
        </button>
      </div>
    );
  };

  return (
    <div className="rounded-xl border-2 border-status-progress/30 bg-status-progress-bg p-4 space-y-2.5 animate-reveal-up">
      <div className="flex items-center gap-2">
        <span className="text-base">🤖</span>
        <h3 className="text-sm font-semibold text-foreground">
          ІІ потребує допомоги
        </h3>
        <span className="ml-auto bg-status-progress text-white text-xs font-bold px-2.5 py-0.5 rounded-full tabular-nums">
          {visible.length}
        </span>
      </div>
      <div className="space-y-2">
        {urgent.map(renderCard)}
      </div>

      {deferred.length > 0 && (
        <div>
          <button
            onClick={() => setShowDeferred(!showDeferred)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors active:scale-[0.97] py-1"
          >
            <ChevronDown
              size={14}
              className={cn("transition-transform duration-200", showDeferred && "rotate-180")}
            />
            Показати ще ({deferred.length})
          </button>
          {showDeferred && (
            <div className="space-y-2 animate-reveal-up">
              {deferred.map(renderCard)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
