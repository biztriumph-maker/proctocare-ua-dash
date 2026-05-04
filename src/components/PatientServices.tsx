import { useState, useEffect } from "react";
import { Pencil, X } from "lucide-react";
import { ProcedureSelector } from "./ProcedureSelector";
import { CalendarView } from "./CalendarView";
import type { Patient } from "./PatientCard";

// ── PatientServices — services selection pane ──

interface PatientServicesProps {
  services: string[];
  onServicesChange: (services: string[]) => void;
  showFloatingEdit?: boolean;
}

export function PatientServices({ services, onServicesChange, showFloatingEdit = true }: PatientServicesProps) {
  const [showSelector, setShowSelector] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <div className="px-4 pb-4 space-y-2 relative">
      {showFloatingEdit && (
        <button
          onClick={() => setShowSelector(true)}
          className="absolute -top-10 right-4 w-6 h-6 flex items-center justify-center rounded-full hover:bg-accent transition-all z-10"
        >
          <Pencil size={11} className="text-muted-foreground" />
        </button>
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/20 backdrop-blur-sm animate-fade-in"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="bg-surface-raised rounded-xl shadow-elevated p-5 mx-4 max-w-sm w-full animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-foreground mb-1">Видалити послугу?</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Ви впевнені, що хочете видалити «{confirmDelete}»?
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2.5 text-sm font-bold text-muted-foreground border border-border rounded-lg hover:bg-muted/40 transition-colors active:scale-[0.97]"
              >
                Скасувати
              </button>
              <button
                onClick={() => {
                  onServicesChange(services.filter((x) => x !== confirmDelete));
                  setConfirmDelete(null);
                }}
                className="flex-1 py-2.5 text-sm font-bold bg-destructive text-destructive-foreground rounded-lg transition-colors active:scale-[0.97]"
              >
                Видалити
              </button>
            </div>
          </div>
        </div>
      )}

      {services.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-4 pb-2 pt-1">
          {services.map((s) => (
            <button
              key={s}
              onClick={() => setConfirmDelete(s)}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full transition-all active:scale-[0.96]"
              style={{ backgroundColor: "#E3F2FD", color: "#1565C0" }}
              title="Натисніть для видалення"
            >
              {s}
              <X size={11} className="shrink-0 opacity-60" />
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground py-2 px-4 text-center">Послуги не додані</p>
      )}

      {showSelector && (
        <ProcedureSelector
          selected={services}
          onConfirm={(sel) => {
            onServicesChange(sel);
            setShowSelector(false);
          }}
          onClose={() => setShowSelector(false)}
        />
      )}
    </div>
  );
}

// ── ReschedulePicker — full-screen calendar overlay for selecting a new appointment slot ──

interface ReschedulePickerProps {
  open: boolean;
  onClose: () => void;
  /** Called when the doctor confirms a new date+time. Parent handles all save/DB logic. */
  onApply: (date: string, time: string) => Promise<void> | void;
  patientName: string;
  initialDate?: string;
  initialTime?: string;
  allPatients?: Patient[];
}

export function ReschedulePicker({
  open,
  onClose,
  onApply,
  patientName,
  initialDate,
  initialTime,
  allPatients,
}: ReschedulePickerProps) {
  const todayLocal = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; })();
  const [date, setDate] = useState(initialDate || todayLocal);
  const [time, setTime] = useState(initialTime || "");

  // Reset to current patient date/time every time the picker is opened.
  useEffect(() => {
    if (open) {
      setDate(initialDate || todayLocal);
      setTime(initialTime || "");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-[65] flex flex-col bg-background animate-fade-in">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card shrink-0">
        <div>
          <h3 className="text-sm font-bold text-foreground">Перенести прийом</h3>
          {date && time && (
            <p className="text-xs text-primary font-bold mt-0.5">
              {new Date(date + "T00:00:00").toLocaleDateString("uk-UA", { day: "numeric", month: "long" })} · {time}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              if (!date || !time) return;
              await onApply(date, time);
            }}
            disabled={!date || !time}
            className="px-4 py-2 bg-primary text-primary-foreground text-sm font-bold rounded-lg active:scale-[0.96] transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            Зберегти
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-accent active:scale-[0.95] transition-all"
          >
            <X size={20} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <CalendarView
          onSlotClick={(selectedDate, hour) => {
            // Use local date components — toISOString() shifts to UTC and causes
            // an off-by-one day for timezones ahead of UTC (e.g. Kyiv UTC+3).
            const y = selectedDate.getFullYear();
            const m = String(selectedDate.getMonth() + 1).padStart(2, "0");
            const d = String(selectedDate.getDate()).padStart(2, "0");
            setDate(`${y}-${m}-${d}`);
            setTime(`${String(hour).padStart(2, "0")}:00`);
          }}
          selectedSlot={date && time ? {
            dateStr: date,
            hour: parseInt(time, 10),
            name: patientName,
          } : undefined}
          realPatients={allPatients}
          initialFocusDate={initialDate}
        />
      </div>
    </div>
  );
}
