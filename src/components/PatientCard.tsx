import { cn } from "@/lib/utils";
import { Clock, Check, X, Loader2 } from "lucide-react";
import { useState } from "react";
import { hasConfirmedAllergen } from "@/lib/allergyState";
import { supabase } from "@/lib/supabaseClient";

/** Red Shield allergy icon — white "!" on red shield background */
export function AllergyShield({ size = 14, className, style }: { size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} style={style}>
      <path d="M10 1L1 5V11C1 16.5 4.8 21.7 10 23C15.2 21.7 19 16.5 19 11V5L10 1Z" fill="#EF4444" />
      <rect x="8.5" y="6.5" width="3" height="8" rx="1.5" fill="white" />
      <rect x="8.5" y="16.5" width="3" height="3" rx="1.5" fill="white" />
    </svg>
  );
}

export type PatientStatus = "planning" | "progress" | "risk" | "ready" | "yellow";

export interface HistoryEntry {
  value: string;
  timestamp: string;
  date: string;
}

export interface Patient {
  id: string;
  patientDbId?: string; // stable Supabase patients.id — used for reliable related-visit filtering
  name: string;
  patronymic?: string;
  time: string;
  procedure: string;
  status: PatientStatus;
  aiSummary: string;
  birthDate?: string;
  phone?: string;
  allergies?: string;
  diagnosis?: string;
  lastVisit?: string;
  primaryNotes?: string;
  notes?: string;
  protocol?: string;
  files?: Array<{ id: string, name: string, type: "doctor" | "patient", date: string, url?: string }>;
  allergiesHistory?: HistoryEntry[];
  diagnosisHistory?: HistoryEntry[];
  notesHistory?: HistoryEntry[];
  phoneHistory?: HistoryEntry[];
  birthDateHistory?: HistoryEntry[];
  protocolHistory?: HistoryEntry[];
  procedureHistory?: HistoryEntry[];
  date?: string;
  fromForm?: boolean;
  paid?: boolean;
  noShow?: boolean;
  completed?: boolean;
  drugChoice?: 'fortrans' | 'izyklin';
  telegramLinked?: boolean;
  webToken?: string | null;
  webTokenRevoked?: boolean;
  webTokenExpiresAt?: string | null;
}

interface PatientCardProps {
  patient: Patient;
  index: number;
  onClick?: (patient: Patient) => void;
  isNew?: boolean;
  onNoShow?: (patientId: string) => void;
  onComplete?: (patientId: string) => void;
  onAfterComplete?: () => void;
}

const statusConfig: Record<PatientStatus, { border: string; dot: string; label: string; bg: string; bgHex: string; textHex: string }> = {
  planning: { border: "border-l-slate-500", dot: "bg-slate-500", label: "Планування", bg: "bg-slate-300", bgHex: "#CBD5E1", textHex: "#475569" },
  progress: { border: "border-l-yellow-500", dot: "bg-yellow-500", label: "Підготовка", bg: "bg-yellow-100", bgHex: "#FEF3C7", textHex: "#D97706" },
  yellow:   { border: "border-l-yellow-500", dot: "bg-yellow-500", label: "Підготовка", bg: "bg-yellow-100", bgHex: "#FEF3C7", textHex: "#D97706" },
  risk:     { border: "border-l-red-500", dot: "bg-red-500", label: "Ризик", bg: "bg-red-100", bgHex: "#FEE2E2", textHex: "#DC2626" },
  ready:    { border: "border-l-green-500", dot: "bg-green-500", label: "Допущено", bg: "bg-green-100", bgHex: "#DCFCE7", textHex: "#16A34A" },
};

/**
 * Computes the display status based on date proximity and preparation state.
 * Priority order: Alert (4) > Ready (3) > Planning (1) > Progress (2)
 */
export function computePatientStatus(patient: Patient): PatientStatus {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Rule 4 (highest priority): Alert — missing in action or reported issue
  if (patient.noShow || patient.status === "risk") return "risk";

  // Rule 3: Ready — patient confirmed all steps
  if (patient.completed || patient.status === "ready") return "ready";

  // Rule 2.5: Yellow — assistant-led preparation actively started
  if (patient.status === "yellow") return "yellow";

  // Date-based rules
  if (patient.date) {
    const appointmentDate = new Date(patient.date + "T00:00:00");
    const threeDaysBefore = new Date(appointmentDate);
    threeDaysBefore.setDate(threeDaysBefore.getDate() - 3);

    // Rule 1: Planning — more than 3 days before appointment
    if (today < threeDaysBefore) return "planning";
  }

  // Rule 2: Progress — within 3 days and preparation actively started
  // If patient hasn't interacted yet (planning), keep gray per logic.md Block 1
  if (patient.status === "planning") return "planning";
  return "progress";
}

export function PatientCard({ patient, index, onClick, isNew, onNoShow, onComplete, onAfterComplete }: PatientCardProps) {
  const config = statusConfig[patient.status] ?? statusConfig.planning;
  const [confirmAction, setConfirmAction] = useState<"complete-empty" | "noshow" | null>(null);
  const [checkingProtocol, setCheckingProtocol] = useState(false);

  const doComplete = () => {
    onComplete?.(patient.id);
    onAfterComplete?.();
    setConfirmAction(null);
  };

  // Fresh DB check — ignores local cache of patient.protocol
  const handleCompleteClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setCheckingProtocol(true);
    try {
      const { data } = await supabase
        .from("visits")
        .select("protocol")
        .eq("id", patient.id)
        .single();
      const filled = !!(data?.protocol?.trim());
      if (filled) {
        // Protocol exists → complete immediately, no modal
        onComplete?.(patient.id);
        onAfterComplete?.();
      } else {
        setConfirmAction("complete-empty");
      }
    } catch {
      // Fallback to local value if DB unreachable
      if (patient.protocol?.trim()) {
        onComplete?.(patient.id);
        onAfterComplete?.();
      } else {
        setConfirmAction("complete-empty");
      }
    } finally {
      setCheckingProtocol(false);
    }
  };

  return (
    <div className="flex flex-col w-full">
      {/* Confirmation modal */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm animate-fade-in" onClick={() => setConfirmAction(null)}>
          <div className="bg-surface-raised rounded-xl shadow-elevated p-5 w-[calc(100%-2rem)] max-w-sm animate-slide-up" onClick={(e) => e.stopPropagation()}>

            {/* ── COMPLETE: protocol empty ── */}
            {confirmAction === "complete-empty" && (
              <>
                <div className="flex items-start justify-between mb-1">
                  <h3 className="text-sm font-bold text-status-risk">
                    Увага! Протокол не заповнено
                  </h3>
                  <button
                    onClick={() => setConfirmAction(null)}
                    className="ml-2 shrink-0 p-0.5 rounded hover:bg-muted/50 text-muted-foreground transition-colors"
                    aria-label="Закрити"
                  >
                    <X size={16} />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mb-1">{patient.name} · {patient.time}</p>
                <p className="text-sm font-medium text-foreground/80 leading-snug mb-4">
                  Ви не залишили медичного висновку за результатами прийому. Це критично для історії хвороби!
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => { onClick?.(patient); setConfirmAction(null); }}
                    className="w-full py-2.5 text-sm font-bold bg-status-ready text-white rounded-lg hover:opacity-90 transition-opacity active:scale-[0.97]"
                  >
                    Заповнити висновок
                  </button>
                  <button
                    onClick={doComplete}
                    className="w-full py-2.5 text-sm font-semibold text-muted-foreground border border-border rounded-lg hover:bg-muted/40 transition-colors active:scale-[0.97]"
                  >
                    Завершити без запису
                  </button>
                </div>
              </>
            )}

            {/* ── NOSHOW ── */}
            {confirmAction === "noshow" && (
              <>
                <div className="flex items-start justify-between mb-0.5">
                  <h3 className="text-sm font-bold text-foreground">Пацієнт не з'явився?</h3>
                  <button
                    onClick={() => setConfirmAction(null)}
                    className="ml-2 shrink-0 p-0.5 rounded hover:bg-muted/50 text-muted-foreground transition-colors"
                    aria-label="Закрити"
                  >
                    <X size={16} />
                  </button>
                </div>
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
                    onClick={() => { onNoShow?.(patient.id); setConfirmAction(null); }}
                    className="flex-1 py-2.5 text-sm font-bold bg-status-risk text-white rounded-lg hover:opacity-90 transition-opacity active:scale-[0.97]"
                  >
                    Неявка підтверджена
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {/* Card */}
      <div
        className={cn(
          "w-full text-left bg-surface-raised rounded-2xl border-l-4 px-3 py-2 sm:px-4 sm:py-2",
          "shadow-[0_6px_44px_0px_rgba(0,0,0,0.06)]",
          "transition-[box-shadow,transform] duration-300 hover:shadow-[0_12px_60px_0px_rgba(0,0,0,0.10)] hover:-translate-y-0.5",
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
            <div className="min-w-0 flex-1 space-y-1">
              {/* Time + status badge — left-aligned markers */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <Clock size={12} className="text-muted-foreground shrink-0" />
                <span className="text-[13px] font-bold text-foreground tabular-nums">
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
              {/* Name + procedure — centered */}
              <div className="flex flex-col items-center text-center py-1 sm:py-0.5">
                <h4 className={cn(
                  "flex items-center gap-1.5 text-base font-semibold leading-tight",
                  patient.noShow ? "text-muted-foreground line-through" : "text-foreground"
                )}>
                  <span className={cn("shrink-0 w-2 h-2 rounded-full", statusConfig[computePatientStatus(patient)].dot)} />
                  {hasConfirmedAllergen(patient.allergies) && (
                    <AllergyShield
                      size={13}
                      className="shrink-0"
                      style={{ filter: "drop-shadow(0 0 4px rgba(239,68,68,0.55))" }}
                    />
                  )}
                  <span>{patient.name}{patient.patronymic ? ` ${patient.patronymic}` : ""}</span>
                </h4>
                <span className="text-xs text-slate-400 mt-1">{patient.procedure}</span>
              </div>
            </div>
          </div>
        </button>
      </div>

      <div className={cn(
        "flex items-center gap-1.5 mt-2 mb-1",
        patient.completed && "invisible pointer-events-none"
      )}>
          {onComplete && (
            <button
              onClick={handleCompleteClick}
              disabled={checkingProtocol}
              className="flex-1 flex items-center justify-center gap-1 h-10 text-[11px] font-semibold whitespace-nowrap text-muted-foreground bg-slate-50 hover:text-status-ready hover:border-status-ready/40 hover:bg-status-ready-bg px-3 rounded-xl transition-colors active:scale-[0.97] active:text-status-ready border border-border disabled:opacity-60 disabled:pointer-events-none"
            >
              {checkingProtocol ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} strokeWidth={3} />}
              Прийом завершено
            </button>
          )}
          {onNoShow && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmAction("noshow");
              }}
              className="flex-1 flex items-center justify-center gap-1 h-10 text-[11px] font-semibold whitespace-nowrap text-muted-foreground bg-slate-50 hover:text-status-risk hover:border-status-risk/40 hover:bg-status-risk-bg px-3 rounded-xl transition-colors active:scale-[0.97] active:text-status-risk border border-border"
            >
              <X size={13} strokeWidth={3} />
              Не з'явився
            </button>
          )}
        </div>
    </div>
  );
}
