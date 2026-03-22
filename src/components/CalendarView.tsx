import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import type { PatientStatus } from "./PatientCard";
import { toast } from "sonner";

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

const DAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

// Mock weekly data keyed by "YYYY-MM-DD"
function getMockSlots(dateStr: string): CalendarSlot[] {
  const seed = dateStr.split("-").reduce((a, b) => a + parseInt(b), 0);
  const slots: CalendarSlot[] = HOURS.map((hour) => {
    const hash = (seed * 31 + hour * 7) % 100;
    if (hash < 25) return { hour, patient: { name: "Коваленко О.", status: "ready" as PatientStatus } };
    if (hash < 35) return { hour, patient: { name: "Мельник І.", status: "progress" as PatientStatus } };
    if (hash < 42) return { hour, patient: { name: "Шевченко Т.", status: "risk" as PatientStatus } };
    return { hour };
  });
  return slots;
}

function getWeekDates(refDate: Date): Date[] {
  const d = new Date(refDate);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(d.setDate(diff));
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    return date;
  });
}

function getMonthDates(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1);
  let startDay = firstDay.getDay() - 1;
  if (startDay < 0) startDay = 6;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

function dateToStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getOccupancy(dateStr: string): "full" | "moderate" | "free" {
  const slots = getMockSlots(dateStr);
  const occupied = slots.filter((s) => s.patient).length;
  if (occupied >= 7) return "full";
  if (occupied >= 3) return "moderate";
  return "free";
}

export function CalendarView({ onSlotClick, onFindOpening }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [viewMode, setViewMode] = useState<"week" | "day">("week");

  const weekDates = useMemo(() => getWeekDates(currentDate), [currentDate]);

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const monthLabel = useMemo(() => {
    return currentDate.toLocaleDateString("uk-UA", { month: "long", year: "numeric" });
  }, [currentDate]);

  const shiftWeek = (delta: number) => {
    setCurrentDate((d) => {
      const next = new Date(d);
      next.setDate(next.getDate() + delta * 7);
      return next;
    });
  };

  const shiftDay = (delta: number) => {
    setCurrentDate((d) => {
      const next = new Date(d);
      next.setDate(next.getDate() + delta);
      return next;
    });
  };

  const selectDateFromMonth = useCallback((d: Date) => {
    setCurrentDate(d);
    setShowMonthPicker(false);
  }, []);

  // Month picker data
  const monthDates = useMemo(() => {
    return getMonthDates(currentDate.getFullYear(), currentDate.getMonth());
  }, [currentDate]);

  const shiftMonth = (delta: number) => {
    setCurrentDate((d) => {
      const next = new Date(d);
      next.setMonth(next.getMonth() + delta);
      return next;
    });
  };

  return (
    <div className="space-y-3 animate-fade-in">
      {/* View mode toggle */}
      <div className="flex rounded-md bg-surface-sunken p-0.5 gap-0.5">
        <button
          onClick={() => setViewMode("week")}
          className={cn(
            "flex-1 py-1.5 rounded text-[11px] font-medium transition-all duration-200 active:scale-[0.97]",
            viewMode === "week" ? "bg-surface-raised shadow-card text-foreground" : "text-muted-foreground"
          )}
        >
          Тиждень
        </button>
        <button
          onClick={() => setViewMode("day")}
          className={cn(
            "flex-1 py-1.5 rounded text-[11px] font-medium transition-all duration-200 active:scale-[0.97]",
            viewMode === "day" ? "bg-surface-raised shadow-card text-foreground" : "text-muted-foreground"
          )}
        >
          День
        </button>
      </div>

      {/* Date header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => (viewMode === "week" ? shiftWeek(-1) : shiftDay(-1))}
          className="p-2 rounded-md hover:bg-accent active:scale-[0.95] transition-all"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={() => setShowMonthPicker(!showMonthPicker)}
          className="text-xs font-semibold capitalize hover:text-primary transition-colors active:scale-[0.97]"
        >
          {viewMode === "day"
            ? currentDate.toLocaleDateString("uk-UA", { weekday: "long", day: "numeric", month: "long" })
            : monthLabel}
        </button>
        <button
          onClick={() => (viewMode === "week" ? shiftWeek(1) : shiftDay(1))}
          className="p-2 rounded-md hover:bg-accent active:scale-[0.95] transition-all"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Month picker overlay */}
      {showMonthPicker && (
        <div className="bg-surface-raised rounded-lg shadow-elevated p-3 space-y-2 animate-reveal-up">
          <div className="flex items-center justify-between">
            <button onClick={() => shiftMonth(-1)} className="p-1 hover:bg-accent rounded active:scale-[0.95] transition-all">
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs font-semibold capitalize">{monthLabel}</span>
            <button onClick={() => shiftMonth(1)} className="p-1 hover:bg-accent rounded active:scale-[0.95] transition-all">
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {DAY_LABELS.map((d) => (
              <span key={d} className="text-[9px] font-semibold text-muted-foreground py-1">
                {d}
              </span>
            ))}
            {monthDates.map((date, i) => {
              if (!date) return <span key={`e-${i}`} />;
              const str = dateToStr(date);
              const occ = getOccupancy(str);
              const isSelected = isSameDay(date, currentDate);
              const isToday = isSameDay(date, new Date());
              return (
                <button
                  key={str}
                  onClick={() => selectDateFromMonth(date)}
                  className={cn(
                    "relative flex flex-col items-center py-1 rounded text-[11px] font-medium transition-all active:scale-[0.93]",
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : isToday
                        ? "bg-accent text-foreground"
                        : "hover:bg-accent/60 text-foreground"
                  )}
                >
                  {date.getDate()}
                  <span
                    className={cn(
                      "w-1 h-1 rounded-full mt-0.5",
                      occ === "full" && "bg-status-risk",
                      occ === "moderate" && "bg-status-progress",
                      occ === "free" && "bg-status-ready"
                    )}
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Find opening */}
      <button
        onClick={onFindOpening}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-primary/30 text-primary text-xs font-medium hover:bg-primary/5 active:scale-[0.98] transition-all"
      >
        <Search size={14} />
        Знайти вільне вікно
      </button>

      {viewMode === "week" ? (
        <WeekGrid
          weekDates={weekDates}
          currentDate={currentDate}
          onSlotClick={onSlotClick}
          onSelectDay={(d) => {
            setCurrentDate(d);
            setViewMode("day");
          }}
        />
      ) : (
        <DayGrid
          date={currentDate}
          onSlotClick={onSlotClick}
        />
      )}
    </div>
  );
}

// ── Week Grid ──
function WeekGrid({
  weekDates,
  currentDate,
  onSlotClick,
  onSelectDay,
}: {
  weekDates: Date[];
  currentDate: Date;
  onSlotClick: (date: Date, hour: number) => void;
  onSelectDay: (d: Date) => void;
}) {
  const today = new Date();
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const slotsPerDay = useMemo(() => {
    return weekDates.map((d) => getMockSlots(dateToStr(d)));
  }, [weekDates]);

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <div className="min-w-[600px]">
        {/* Header row */}
        <div className="grid grid-cols-[48px_repeat(7,1fr)] gap-px mb-1">
          <div />
          {weekDates.map((d, i) => (
            <button
              key={i}
              onClick={() => onSelectDay(d)}
              className={cn(
                "text-center py-1.5 rounded-md transition-all active:scale-[0.96]",
                isSameDay(d, today)
                  ? "bg-primary/10"
                  : "hover:bg-accent/60"
              )}
            >
              <p className="text-[9px] font-semibold text-muted-foreground uppercase">
                {DAY_LABELS[i]}
              </p>
              <p className={cn(
                "text-[13px] font-bold tabular-nums",
                isSameDay(d, today) ? "text-primary" : "text-foreground"
              )}>
                {d.getDate()}
              </p>
            </button>
          ))}
        </div>

        {/* Grid body */}
        <div className="grid grid-cols-[48px_repeat(7,1fr)] gap-px">
          {HOURS.map((hour, hi) => (
            <div key={hour} className="contents">
              <div className="flex items-center justify-end pr-2 text-[10px] text-muted-foreground tabular-nums font-medium h-10">
                {String(hour).padStart(2, "0")}:00
              </div>
              {weekDates.map((d, di) => {
                const slot = slotsPerDay[di]?.find((s) => s.hour === hour);
                return (
                  <button
                    key={di}
                    onClick={() => {
                      if (slot?.patient) {
                        toast.info(`Деталі: ${slot.patient.name}`);
                      } else {
                        onSlotClick(d, hour);
                      }
                    }}
                    className={cn(
                      "h-10 rounded-sm border border-transparent transition-all duration-150 text-[10px] truncate px-1 flex items-center gap-0.5",
                      "active:scale-[0.96]",
                      slot?.patient
                        ? "bg-surface-raised shadow-card hover:shadow-card-hover"
                        : "hover:bg-accent/40 hover:border-border"
                    )}
                    style={{ animationDelay: `${(hi * 7 + di) * 15}ms` }}
                  >
                    {slot?.patient && (
                      <>
                        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", statusDot[slot.patient.status])} />
                        <span className="font-medium text-foreground truncate">{slot.patient.name}</span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Day Grid ──
function DayGrid({
  date,
  onSlotClick,
}: {
  date: Date;
  onSlotClick: (date: Date, hour: number) => void;
}) {
  const slots = useMemo(() => getMockSlots(dateToStr(date)), [date]);

  return (
    <div className="space-y-0.5">
      {slots.map((slot, i) => (
        <button
          key={slot.hour}
          onClick={() => {
            if (slot.patient) {
              toast.info(`Деталі: ${slot.patient.name}`);
            } else {
              onSlotClick(date, slot.hour);
            }
          }}
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
            </div>
          ) : (
            <span className="text-[11px] text-muted-foreground/50">— вільно —</span>
          )}
        </button>
      ))}
    </div>
  );
}
