import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, X, Check } from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import type { PatientStatus } from "./PatientCard";

interface CalendarSlot {
  hour: number;
  patient?: { name: string; status: PatientStatus; procedure: string };
}

interface CalendarViewProps {
  onSlotClick: (date: Date, hour: number) => void;
  onPatientClick?: (patient: { name: string; status: PatientStatus; procedure: string; time: string }) => void;
  searchQuery?: string;
}

const statusDot: Record<PatientStatus, string> = {
  ready: "bg-status-ready",
  progress: "bg-status-progress",
  risk: "bg-status-risk",
};

const DAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const PROCEDURES = ["Колоноскопія", "Ректоскопія", "Аноскопія", "Консультація"];

function getMockSlots(dateStr: string): CalendarSlot[] {
  const seed = dateStr.split("-").reduce((a, b) => a + parseInt(b), 0);
  return HOURS.map((hour) => {
    const hash = (seed * 31 + hour * 7) % 100;
    if (hash < 25) return { hour, patient: { name: "Коваленко О.", status: "ready" as PatientStatus, procedure: PROCEDURES[hash % 4] } };
    if (hash < 35) return { hour, patient: { name: "Мельник І.", status: "progress" as PatientStatus, procedure: PROCEDURES[(hash + 1) % 4] } };
    if (hash < 42) return { hour, patient: { name: "Шевченко Т.", status: "risk" as PatientStatus, procedure: PROCEDURES[(hash + 2) % 4] } };
    return { hour };
  });
}

function getWeekDates(refDate: Date): Date[] {
  const d = new Date(refDate);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
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

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function CalendarView({ onSlotClick, onPatientClick, searchQuery = "" }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [viewMode, setViewMode] = useState<"week" | "day">("week");

  const weekDates = useMemo(() => getWeekDates(currentDate), [currentDate]);

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
      <div className="flex rounded-xl bg-[hsl(199,89%,86%)] p-1 gap-1">
        <button
          onClick={() => setViewMode("day")}
          className={cn(
            "flex-1 py-2 rounded-lg text-sm transition-all duration-200 active:scale-[0.97]",
            viewMode === "day"
              ? "bg-white font-bold text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
              : "font-medium text-foreground/60 hover:text-foreground/80"
          )}
        >
          День
        </button>
        <button
          onClick={() => setViewMode("week")}
          className={cn(
            "flex-1 py-2 rounded-lg text-sm transition-all duration-200 active:scale-[0.97]",
            viewMode === "week"
              ? "bg-white font-bold text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
              : "font-medium text-foreground/60 hover:text-foreground/80"
          )}
        >
          Тиждень
        </button>
      </div>

      {/* Date header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => (viewMode === "week" ? shiftWeek(-1) : shiftDay(-1))}
          className="p-2 rounded-md hover:bg-accent active:scale-[0.95] transition-all"
        >
          <ChevronLeft size={20} />
        </button>
        <button
          onClick={() => setShowMonthPicker(!showMonthPicker)}
          className="text-base font-bold capitalize hover:text-primary transition-colors active:scale-[0.97]"
        >
          {viewMode === "day"
            ? currentDate.toLocaleDateString("uk-UA", { weekday: "long", day: "numeric", month: "long" })
            : monthLabel}
        </button>
        <button
          onClick={() => (viewMode === "week" ? shiftWeek(1) : shiftDay(1))}
          className="p-2 rounded-md hover:bg-accent active:scale-[0.95] transition-all"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Month picker overlay */}
      {showMonthPicker && (
        <div className="border-2 border-muted-foreground/40 rounded-lg shadow-[0_4px_20px_rgba(0,0,0,0.08)] bg-white p-3 space-y-2 animate-reveal-up">
          <div className="flex items-center justify-between">
            <button onClick={() => shiftMonth(-1)} className="p-1 hover:bg-accent rounded active:scale-[0.95] transition-all">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold capitalize">{monthLabel}</span>
            <button onClick={() => shiftMonth(1)} className="p-1 hover:bg-accent rounded active:scale-[0.95] transition-all">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0 text-center">
            {DAY_LABELS.map((d) => (
              <span key={d} className="text-[10px] font-semibold text-muted-foreground py-1 border-b border-border">
                {d}
              </span>
            ))}
            {monthDates.map((date, i) => {
              if (!date) return <span key={`e-${i}`} className="border-b border-r border-border/40" />;
              const str = dateToStr(date);
              const isSelected = isSameDay(date, currentDate);
              const isToday = isSameDay(date, new Date());
              return (
                <button
                  key={str}
                  onClick={() => selectDateFromMonth(date)}
                  className={cn(
                    "relative flex items-center justify-center w-full h-9 text-xs font-medium transition-all active:scale-[0.93]",
                    "border-b border-r border-border/40",
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : isToday
                        ? "bg-[hsl(204,100%,93%)] text-primary font-bold"
                        : "hover:bg-accent/60 text-foreground"
                  )}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {viewMode === "week" ? (
        <WeekGrid
          weekDates={weekDates}
          onSlotClick={onSlotClick}
          onPatientClick={onPatientClick}
          searchQuery={searchQuery}
          onSelectDay={(d) => {
            setCurrentDate(d);
            setViewMode("day");
          }}
        />
      ) : (
        <DayGrid date={currentDate} onSlotClick={onSlotClick} onPatientClick={onPatientClick} searchQuery={searchQuery} />
      )}
    </div>
  );
}

// ── Slot Popover ──
function SlotPopover({
  slot,
  hour,
  onClose,
  onPatientClick,
  openDirection,
  openHorizontal,
}: {
  slot: { name: string; status: PatientStatus; procedure: string };
  hour: number;
  onClose: () => void;
  onPatientClick?: (patient: { name: string; status: PatientStatus; procedure: string; time: string }) => void;
  openDirection: "up" | "down";
  openHorizontal: "left" | "right" | "center";
}) {
  return (
    <div
      className={cn(
        "absolute z-20 w-48 bg-popover border rounded-lg shadow-elevated p-3 space-y-1.5 animate-reveal-up",
        openDirection === "up" ? "bottom-full mb-1" : "top-full mt-1",
        openHorizontal === "left" ? "right-0" : openHorizontal === "right" ? "left-0" : "left-1/2 -translate-x-1/2"
      )}
      style={{
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      <div className="flex items-center justify-between">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPatientClick?.({ ...slot, time: `${String(hour).padStart(2, "0")}:00` });
          }}
          className="flex items-center gap-1.5 min-w-0 hover:underline"
        >
          <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", statusDot[slot.status])} />
          <span className="text-xs font-semibold text-foreground truncate">{slot.name}</span>
        </button>
        <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="p-0.5 rounded hover:bg-accent active:scale-[0.9] transition-all shrink-0">
          <X size={12} className="text-muted-foreground" />
        </button>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPatientClick?.({ ...slot, time: `${String(hour).padStart(2, "0")}:00` });
        }}
        className="text-xs text-muted-foreground hover:text-primary hover:underline transition-colors cursor-pointer"
      >
        {slot.procedure}
      </button>
    </div>
  );
}

// ── Week Grid ──
function WeekGrid({
  weekDates,
  onSlotClick,
  onSelectDay,
  onPatientClick,
  searchQuery = "",
}: {
  weekDates: Date[];
  onSlotClick: (date: Date, hour: number) => void;
  onSelectDay: (d: Date) => void;
  onPatientClick?: (patient: { name: string; status: PatientStatus; procedure: string; time: string }) => void;
  searchQuery?: string;
}) {
  const today = new Date();
  const [activePopover, setActivePopover] = useState<string | null>(null);

  const slotsPerDay = useMemo(() => {
    return weekDates.map((d) => getMockSlots(dateToStr(d)));
  }, [weekDates]);

  const isPast = (d: Date) => {
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return target < t;
  };

  return (
    <div className="border-2 border-muted-foreground/40 rounded-lg overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.08)]">
      {/* Header row */}
      <div className="grid grid-cols-[48px_repeat(7,1fr)] border-b border-border">
        <div className="border-r border-border bg-[hsl(204,100%,97%)]" />
        {weekDates.map((d, i) => {
          const isToday = isSameDay(d, today);
          const past = isPast(d);
          return (
            <button
              key={i}
              onClick={() => onSelectDay(d)}
              className={cn(
                "text-center py-2 transition-all active:scale-[0.96]",
                i < 6 && "border-r border-border",
                isToday && "bg-[hsl(204,100%,93%)]",
                past && !isToday && "bg-[hsl(214,20%,89%)] opacity-70"
              )}
            >
              <p className="text-[11px] font-bold text-foreground/50 uppercase leading-none">
                {DAY_LABELS[i]}
              </p>
              <p className={cn(
                "text-base font-bold tabular-nums leading-tight mt-0.5",
                isToday ? "text-primary" : past ? "text-muted-foreground" : "text-foreground"
              )}>
                {d.getDate()}
              </p>
            </button>
          );
        })}
      </div>

      {/* Grid body */}
      <div className="grid grid-cols-[48px_repeat(7,1fr)]">
        {HOURS.map((hour, hi) => (
          <div key={hour} className="contents">
            <div className={cn(
              "flex items-center justify-end pr-2 text-xs text-foreground font-bold tabular-nums h-11 bg-[hsl(204,100%,97%)]",
              "border-r border-border",
              hi < HOURS.length - 1 && "border-b border-border"
            )}>
              {String(hour).padStart(2, "0")}:00
            </div>
            {weekDates.map((d, di) => {
              const slot = slotsPerDay[di]?.find((s) => s.hour === hour);
              const popoverKey = `${di}-${hour}`;
              const past = isPast(d);
              const isSearchMatch = searchQuery.trim() && slot?.patient?.name.toLowerCase().includes(searchQuery.toLowerCase());

              // Smart positioning: open up if bottom half, open left if right side
              const openDirection = hi >= HOURS.length / 2 ? "up" : "down";
              const openHorizontal = di >= 5 ? "left" : di <= 1 ? "right" : "center";

              const statusBg = slot?.patient
                ? slot.patient.status === "ready"
                  ? "bg-status-ready-bg border border-status-ready/25"
                  : slot.patient.status === "progress"
                    ? "bg-status-progress-bg border border-status-progress/25"
                    : "bg-status-risk-bg border border-status-risk/25"
                : null;

              return (
                <div
                  key={di}
                  className={cn(
                    "relative p-[5px]",
                    past ? "bg-[hsl(214,20%,89%)]" : "bg-white",
                    hi < HOURS.length - 1 && "border-b border-border",
                    di < 6 && "border-r border-border"
                  )}
                >
                  <button
                    onClick={() => {
                      if (slot?.patient) {
                        setActivePopover(activePopover === popoverKey ? null : popoverKey);
                      } else {
                        onSlotClick(d, hour);
                      }
                    }}
                    className={cn(
                      "w-full h-[28px] rounded transition-all duration-150 flex items-center justify-center",
                      "active:scale-[0.90]",
                      statusBg
                        ? cn(statusBg, past && "opacity-50", "hover:opacity-85")
                        : "bg-transparent",
                      isSearchMatch && "ring-2 ring-primary ring-offset-1"
                    )}
                  >
                    {past && slot?.patient && (
                      <div className="flex items-center gap-0.5">
                        {slot.patient.status === "ready" && <Check size={12} className="text-status-ready" strokeWidth={3} />}
                        {slot.patient.status === "risk" && <span className="text-[9px] font-extrabold text-status-risk">Н/З</span>}
                        {slot.patient.status === "progress" && <span className="text-[9px] font-extrabold text-status-risk">₴</span>}
                      </div>
                    )}
                  </button>
                  {slot?.patient && activePopover === popoverKey && (
                     <SlotPopover
                      slot={slot.patient}
                      hour={hour}
                      onClose={() => setActivePopover(null)}
                      onPatientClick={onPatientClick}
                      openDirection={openDirection as "up" | "down"}
                      openHorizontal={openHorizontal}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Day Grid ──
function DayGrid({
  date,
  onSlotClick,
  onPatientClick,
  searchQuery = "",
}: {
  date: Date;
  onSlotClick: (date: Date, hour: number) => void;
  onPatientClick?: (patient: { name: string; status: PatientStatus; procedure: string; time: string }) => void;
  searchQuery?: string;
}) {
  const slots = useMemo(() => getMockSlots(dateToStr(date)), [date]);

  const statusColor: Record<PatientStatus, string> = {
    ready: "bg-status-ready-bg border-status-ready/30",
    progress: "bg-status-progress-bg border-status-progress/30",
    risk: "bg-status-risk-bg border-status-risk/30",
  };

  return (
    <div className="space-y-1">
      {slots.map((slot, i) => {
        const isSearchMatch = searchQuery.trim() && slot.patient?.name.toLowerCase().includes(searchQuery.toLowerCase());
        return (
          <div key={slot.hour} className="relative">
            <button
              onClick={() => {
                if (slot.patient) {
                  onPatientClick?.({ ...slot.patient, time: `${String(slot.hour).padStart(2, "0")}:00` });
                } else {
                  onSlotClick(date, slot.hour);
                }
              }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all duration-200",
                "active:scale-[0.98] animate-reveal-up",
                slot.patient
                  ? cn("border-l-2", statusColor[slot.patient.status])
                  : "hover:bg-accent/60 border border-transparent hover:border-border",
                isSearchMatch && "ring-2 ring-primary ring-offset-1"
              )}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <span className="text-sm font-bold text-foreground tabular-nums w-12 shrink-0">
                {String(slot.hour).padStart(2, "0")}:00
              </span>
              {slot.patient ? (
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={cn("w-2 h-2 rounded-full shrink-0", statusDot[slot.patient.status])} />
                  <span className="text-[15px] font-semibold text-foreground truncate">
                    {slot.patient.name}
                  </span>
                  <span className="text-sm text-muted-foreground truncate ml-auto">
                    {slot.patient.procedure}
                  </span>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground/50">— вільно —</span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
