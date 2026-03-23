import { cn } from "@/lib/utils";
import { Clock, ChevronRight } from "lucide-react";

export type PatientStatus = "ready" | "progress" | "risk";

export interface Patient {
  id: string;
  name: string;
  time: string;
  procedure: string;
  status: PatientStatus;
  aiSummary: string;
}

interface PatientCardProps {
  patient: Patient;
  index: number;
  onClick?: (patient: Patient) => void;
  isNew?: boolean;
}

const statusConfig: Record<PatientStatus, { border: string; dot: string; label: string; bg: string }> = {
  ready: { border: "border-l-status-ready", dot: "bg-status-ready", label: "Допущено до процедури", bg: "bg-status-ready-bg" },
  progress: { border: "border-l-status-progress", dot: "bg-status-progress", label: "Підготовка триває", bg: "bg-status-progress-bg" },
  risk: { border: "border-l-status-risk", dot: "bg-status-risk", label: "Потребує уваги", bg: "bg-status-risk-bg" },
};

export function PatientCard({ patient, index, onClick, isNew }: PatientCardProps) {
  const config = statusConfig[patient.status];

  return (
    <button
      onClick={() => onClick?.(patient)}
      className={cn(
        "w-full text-left bg-surface-raised rounded-xl border-l-4 px-4 py-3",
        "border border-border/50 shadow-[0_1px_4px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]",
        "transition-all duration-200 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] active:scale-[0.98]",
        "animate-reveal-up",
        config.border,
        isNew && "animate-new-slot-pulse"
      )}
      style={{ animationDelay: isNew ? "0ms" : `${index * 60}ms` }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <Clock size={13} className="text-muted-foreground shrink-0" />
            <span className="text-xs font-semibold text-foreground tabular-nums">
              {patient.time}
            </span>
            <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full", config.bg, `text-status-${patient.status}`)}>
              {config.label}
            </span>
          </div>
          <h4 className="text-sm font-semibold text-foreground truncate leading-tight">
            {patient.name}
          </h4>
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-muted-foreground">{patient.procedure}</span>
            <span className="text-xs text-primary font-medium truncate">· {patient.aiSummary}</span>
          </div>
        </div>
        <ChevronRight size={18} className="text-muted-foreground/50 shrink-0" />
      </div>
    </button>
  );
}
