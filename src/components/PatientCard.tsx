import { cn } from "@/lib/utils";
import { Clock, Check, X } from "lucide-react";
import { useState } from "react";

export type PatientStatus = "ready" | "progress" | "risk";

export interface Patient {
  id: string;
  name: string;
  patronymic?: string;
  time: string;
  procedure: string;
  status: PatientStatus;
  aiSummary: string;
  birthDate?: string;
  phone?: string;
  primaryNotes?: string;
  notes?: string;
  protocol?: string;
  files?: Array<{ id: string, name: string, type: "doctor" | "patient", date: string, url?: string }>;
  date?: string;
  fromForm?: boolean;
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
  const [confirmAction, setConfirmAction] = useState<"complete" | "noshow" | null>(null);

  return (
    <div className="space-y-2">
      {/* Confirmation modal */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm animate-fade-in" onClick={() => setConfirmAction(null)}>
          <div className="bg-surface-raised rounded-xl shadow-elevated p-5 w-[calc(100%-2rem)] max-w-sm animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-foreground mb-1">
              Підтвердити дію: {confirmAction === "complete" ? "Прийом завершено" : "Не з'явився"}?
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              {patient.name} · {patient.time} · {patient.procedure}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setConfirmAction(null)}
                className="flex-1 py-2.5 text-sm font-bold text-muted-foreground border border-border rounded-lg hover:bg-muted/40 transition-colors active:scale-[0.97]"
              >
                Скасувати
              </button>
              <button
                onClick={() => {
                  if (confirmAction === "complete") onComplete?.(patient.id);
                  else onNoShow?.(patient.id);
                  setConfirmAction(null);
                }}
                className={cn(
                  "flex-1 py-2.5 text-sm font-bold rounded-lg transition-colors active:scale-[0.97]",
                  confirmAction === "complete"
                    ? "bg-status-ready text-white"
                    : "bg-status-risk text-white"
                )}
              >
                Підтвердити
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Card */}
      <div
        className={cn(
          "w-full text-left bg-surface-raised rounded-lg border-l-4 px-3 py-2 sm:px-4 sm:py-3 sm:rounded-xl",
          "shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1)]",
          "transition-all duration-200 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]",
          "animate-reveal-up",
          patient.completed
            ? "border-l-status-ready border-2 border-status-ready/50 bg-[hsl(142,60%,93%)]"
            : patient.noShow
              ? "border-l-status-risk border-2 border-status-risk/40 bg-[hsl(0,72%,93%)]"
              : cn("border border-[hsl(220,14%,82%)]", config.border),
          isNew && "animate-new-slot-pulse"
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
                {patient.name}{patient.patronymic ? ` ${patient.patronymic}` : ""}
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

      <div className={cn(
        "flex items-center gap-2 mt-2",
        (patient.noShow || patient.completed) && "invisible pointer-events-none"
      )}>
          {onComplete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmAction("complete");
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
                setConfirmAction("noshow");
              }}
              className="flex-1 flex items-center justify-center gap-1 text-[11px] font-bold text-muted-foreground bg-transparent hover:text-status-risk hover:border-status-risk/60 hover:bg-status-risk-bg px-3 py-1.5 rounded-lg transition-colors active:scale-[0.95] active:text-status-risk border border-border"
            >
              <X size={12} strokeWidth={3} />
              Не з'явився
            </button>
          )}
        </div>
    </div>
  );
}
