import { cn } from "@/lib/utils";
import { Clock, Check, X } from "lucide-react";

export type PatientStatus = "ready" | "progress" | "risk";

export interface Patient {
  id: string;
  name: string;
  time: string;
  procedure: string;
  status: PatientStatus;
  aiSummary: string;
  birthDate?: string;
  paid?: boolean;
  noShow?: boolean;
  completed?: boolean;
}

interface PatientCardProps {
  patient: Patient;
  index: number;
  onClick?: (patient: Patient) => void;
  isNew?: boolean;
  onNoShow?: (patientId: string) => void;
  onComplete?: (patientId: string) => void;
}

const statusConfig: Record<PatientStatus, { border: string; dot: string; label: string; bg: string }> = {
  ready: { border: "border-l-status-ready", dot: "bg-status-ready", label: "Допущено до процедури", bg: "bg-status-ready-bg" },
  progress: { border: "border-l-status-progress", dot: "bg-status-progress", label: "Підготовка триває", bg: "bg-status-progress-bg" },
  risk: { border: "border-l-status-risk", dot: "bg-status-risk", label: "Потребує уваги", bg: "bg-status-risk-bg" },
};

export function PatientCard({ patient, index, onClick, isNew, onNoShow, onComplete }: PatientCardProps) {
  const config = statusConfig[patient.status];

  return (
    <div className="space-y-2">
      {/* Card */}
      <div
        className={cn(
          "w-full text-left bg-surface-raised rounded-lg border-l-4 px-3 py-2 sm:px-4 sm:py-3 sm:rounded-xl",
          "shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1)]",
          "transition-all duration-200 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]",
          "animate-reveal-up",
          patient.completed
            ? "border-l-status-ready border-2 border-status-ready/40"
            : patient.noShow
              ? "border-l-status-risk border-2 border-status-risk/30 bg-status-risk-bg/30"
              : cn("border border-[hsl(220,14%,82%)]", config.border),
          isNew && "animate-new-slot-pulse",
          patient.noShow && "opacity-50"
        )}
        style={{ animationDelay: isNew ? "0ms" : `${index * 60}ms` }}
      >
        <button
          onClick={() => onClick?.(patient)}
          className="w-full text-left active:scale-[0.98] transition-transform"
        >
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 space-y-0.5 sm:space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Clock size={12} className="text-muted-foreground shrink-0" />
                <span className="text-[11px] font-semibold text-foreground tabular-nums">
                  {patient.time}
                </span>
                <span className={cn(
                  "text-[10px] sm:text-[11px] font-bold px-1.5 py-px rounded-full",
                  patient.completed
                    ? "bg-status-ready-bg text-status-ready"
                    : patient.noShow
                      ? "bg-status-risk-bg text-status-risk"
                      : cn(config.bg, `text-status-${patient.status}`)
                )}>
                  {patient.completed ? "Виконано" : patient.noShow ? "Не з'явився" : config.label}
                </span>
                {patient.completed && (
                  <Check size={14} className="text-status-ready" strokeWidth={3} />
                )}
              </div>
              <h4 className={cn("text-[13px] sm:text-sm font-semibold truncate leading-tight", patient.noShow ? "text-muted-foreground line-through" : "text-foreground")}>
                {patient.name}
              </h4>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] text-muted-foreground">{patient.procedure}</span>
                {!patient.noShow && (
                  <span className="text-[11px] text-primary font-medium truncate">· {patient.aiSummary}</span>
                )}
              </div>
            </div>
          </div>
        </button>
      </div>

      {/* Action buttons — OUTSIDE the card, full width, grey outline */}
      {!patient.noShow && !patient.completed && (onNoShow || onComplete) && (
        <div className="flex items-center gap-2 mt-2">
          {onComplete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onComplete(patient.id);
              }}
              className="flex-1 flex items-center justify-center gap-1 text-[11px] font-bold text-muted-foreground bg-transparent hover:text-status-ready hover:border-status-ready/60 hover:bg-status-ready-bg px-3 py-1.5 rounded-lg transition-colors active:scale-[0.95] active:text-status-ready border border-border"
            >
              <Check size={12} strokeWidth={3} />
              Прийом завершено
            </button>
          )}
          {onNoShow && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onNoShow(patient.id);
              }}
              className="flex-1 flex items-center justify-center gap-1 text-[11px] font-bold text-muted-foreground bg-transparent hover:text-status-risk hover:border-status-risk/60 hover:bg-status-risk-bg px-3 py-1.5 rounded-lg transition-colors active:scale-[0.95] active:text-status-risk border border-border"
            >
              <X size={12} strokeWidth={3} />
              Не з'явився
            </button>
          )}
        </div>
      )}
    </div>
  );
}
