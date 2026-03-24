import { cn } from "@/lib/utils";
import { Clock } from "lucide-react";

export type PatientStatus = "ready" | "progress" | "risk";

export interface Patient {
  id: string;
  name: string;
  time: string;
  procedure: string;
  status: PatientStatus;
  aiSummary: string;
  paid?: boolean;
  noShow?: boolean;
}

interface PatientCardProps {
  patient: Patient;
  index: number;
  onClick?: (patient: Patient) => void;
  isNew?: boolean;
  onNoShow?: (patientId: string) => void;
}

const statusConfig: Record<PatientStatus, { border: string; dot: string; label: string; bg: string }> = {
  ready: { border: "border-l-status-ready", dot: "bg-status-ready", label: "Допущено до процедури", bg: "bg-status-ready-bg" },
  progress: { border: "border-l-status-progress", dot: "bg-status-progress", label: "Підготовка триває", bg: "bg-status-progress-bg" },
  risk: { border: "border-l-status-risk", dot: "bg-status-risk", label: "Потребує уваги", bg: "bg-status-risk-bg" },
};

export function PatientCard({ patient, index, onClick, isNew, onNoShow }: PatientCardProps) {
  const config = statusConfig[patient.status];

  return (
    <div
      className={cn(
        "w-full text-left bg-surface-raised rounded-lg border-l-4 px-3 py-2 sm:px-4 sm:py-3 sm:rounded-xl",
        "border border-[hsl(220,13%,83%)] shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1)]",
        "transition-all duration-200 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]",
        "animate-reveal-up",
        config.border,
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
              <span className={cn("text-[10px] sm:text-[11px] font-bold px-1.5 py-px rounded-full", config.bg, `text-status-${patient.status}`)}>
                {patient.noShow ? "Н/З" : config.label}
              </span>
              {!patient.paid && !patient.noShow && (
                <span className="text-[11px] font-bold text-amber-600 bg-amber-100 px-1.5 py-px rounded-full">
                  ₴
                </span>
              )}
              {patient.paid && (
                <span className="text-[11px] font-bold text-status-ready bg-status-ready-bg px-1.5 py-px rounded-full">
                  ₴
                </span>
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
      {!patient.noShow && onNoShow && (
        <div className="flex justify-end mt-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNoShow(patient.id);
            }}
            className="text-[10px] font-medium text-muted-foreground hover:text-destructive px-2 py-1 rounded-md hover:bg-destructive/10 transition-colors active:scale-[0.95]"
          >
            Не з'явився
          </button>
        </div>
      )}
    </div>
  );
}
