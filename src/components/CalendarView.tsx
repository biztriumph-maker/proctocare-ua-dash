import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useState, useMemo } from "react";
import type { PatientStatus } from "./PatientCard";

interface CalendarSlot {
  hour: number;
  patient?: { name: string; status: PatientStatus };
}

interface CalendarViewProps {
  onSlotClick: (date: Date, hour: number) => void;
  onFindOpening: () => void;
}

const statusDot: Record<PatientStatus, string> = {
  ready: "bg-status-ready",
  progress: "bg-status-progress",
  risk: "bg-status-risk",
};

const statusLabel: Record<PatientStatus, string> = {
  ready: "Допущено",
  progress: "Підготовка",
  risk: "Ризик",
};

const MOCK_SLOTS: CalendarSlot[] = [
  { hour: 8, patient: { name: "Коваленко О.", status: "ready" } },
  { hour: 9, patient: { name: "Мельник І.", status: "progress" } },
  { hour: 10 },
  { hour: 11, patient: { name: "Шевченко Т.", status: "risk" } },
  { hour: 12 },
  { hour: 13 },
  { hour: 14, patient: { name: "Бондаренко В.", status: "ready" } },
  { hour: 15 },
  { hour: 16, patient: { name: "Ткаченко Н.", status: "progress" } },
  { hour: 17 },
];

export function CalendarView({ onSlotClick, onFindOpening }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const dateStr = useMemo(() => {
    return currentDate.toLocaleDateString("uk-UA", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }, [currentDate]);

  const shiftDay = (delta: number) => {
    setCurrentDate((d) => {
      const next = new Date(d);
      next.setDate(next.getDate() + delta);
      return next;
    });
  };

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Date nav */}
      <div className="flex items-center justify-between">
        <button onClick={() => shiftDay(-1)} className="p-2 rounded-md hover:bg-accent active:scale-[0.95] transition-all">
          <ChevronLeft size={18} />
        </button>
        <h3 className="text-xs font-semibold capitalize">{dateStr}</h3>
        <button onClick={() => shiftDay(1)} className="p-2 rounded-md hover:bg-accent active:scale-[0.95] transition-all">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Find opening */}
      <button
        onClick={onFindOpening}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-primary/30 text-primary text-xs font-medium hover:bg-primary/5 active:scale-[0.98] transition-all"
      >
        <Search size={14} />
        Знайти вільне вікно
      </button>

      {/* Time slots */}
      <div className="space-y-0.5">
        {MOCK_SLOTS.map((slot, i) => (
          <button
            key={slot.hour}
            onClick={() => onSlotClick(currentDate, slot.hour)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-all duration-200",
              "active:scale-[0.98] animate-reveal-up",
              slot.patient
                ? "bg-surface-raised shadow-card hover:shadow-card-hover"
                : "hover:bg-accent/60 border border-transparent hover:border-border"
            )}
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <span className="text-[11px] font-semibold text-muted-foreground tabular-nums w-10 shrink-0">
              {String(slot.hour).padStart(2, "0")}:00
            </span>
            {slot.patient ? (
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", statusDot[slot.patient.status])} />
                <span className="text-[13px] font-medium text-foreground truncate">
                  {slot.patient.name}
                </span>
                <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{statusLabel[slot.patient.status]}</span>
              </div>
            ) : (
              <span className="text-[11px] text-muted-foreground/50">— вільно —</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
