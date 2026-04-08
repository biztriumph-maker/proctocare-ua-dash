import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, X, Check } from "lucide-react";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { Patient, PatientStatus } from "./PatientCard";
import { computePatientStatus, AllergyShield } from "./PatientCard";
import { hasConfirmedAllergen, parseAllergyState } from "@/lib/allergyState";

interface CalendarSlot {
  hour: number;
  patient?: { id?: string; name: string; patronymic?: string; status: PatientStatus; procedure: string; allergies?: string };
}

interface CalendarViewProps {
  onSlotClick: (date: Date, hour: number) => void;
  onPatientClick?: (patient: { id?: string; name: string; patronymic?: string; status: PatientStatus; procedure: string; time: string; date?: string; allergies?: string }) => void;
  searchQuery?: string;
  selectedSlot?: { dateStr: string; hour: number; name?: string };
  realPatients?: Patient[];
  focusDate?: string;
}

const statusDot: Record<PatientStatus, string> = {
  planning: "bg-slate-400",
  progress: "bg-yellow-500",
  risk: "bg-red-500",
  ready: "bg-green-500",
};

const statusSlotBg: Record<PatientStatus, string> = {
  planning: "bg-slate-300 border border-slate-500/70",
  progress: "bg-status-progress-bg border border-status-progress/30",
  risk: "bg-status-risk-bg border border-status-risk/30",
  ready: "bg-status-ready-bg border border-status-ready/30",
};

const DAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const PROCEDURES = ["Колоноскопія", "Ректоскопія", "Аноскопія", "Консультація"];

function getMockSlots(dateStr: string): CalendarSlot[] {
  return HOURS.map((hour) => ({ hour }));
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getHourFromTime(time?: string): number | null {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [h] = time.split(":");
  const hour = Number(h);
  return Number.isFinite(hour) ? hour : null;
}

function pickPatientForSlot(realPatients: Patient[] | undefined, dateStr: string, hour: number): Patient | undefined {
  if (!realPatients?.length) return undefined;

  const sameDate = realPatients.filter((p) => p.date === dateStr);
  const exact = sameDate.find((p) => p.time === `${String(hour).padStart(2, "0")}:00`);
  if (exact) return exact;

  const sameHour = sameDate
    .filter((p) => getHourFromTime(p.time) === hour)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));

  return sameHour[0];
}

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function CalendarView({ onSlotClick, onPatientClick, searchQuery = "", selectedSlot, realPatients, focusDate }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [viewMode, setViewMode] = useState<"week" | "day">("week");

  // Auto-navigate and switch to Day view when search finds a match
  useEffect(() => {
    if (!focusDate) {
      setViewMode("week");
      return;
    }
    // Parse "YYYY-MM-DD" directly as LOCAL date to avoid UTC midnight shift
    const [y, mo, d] = focusDate.split("-").map(Number);
    if (y && mo && d) {
      setCurrentDate(new Date(y, mo - 1, d));
      setViewMode("day");
    }
  }, [focusDate]);

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
          selectedSlot={selectedSlot}
          realPatients={realPatients}
          onSelectDay={(d) => {
            setCurrentDate(d);
            setViewMode("day");
          }}
        />
      ) : (
        <DayGrid date={currentDate} onSlotClick={onSlotClick} onPatientClick={onPatientClick} searchQuery={searchQuery} selectedSlot={selectedSlot} realPatients={realPatients} />
      )}
    </div>
  );
}

// ── Slot Popover ──
function SlotPopover({
  slot,
  hour,
  dateStr,
  onClose,
  onPatientClick,
  anchorRect,
}: {
  slot: { id?: string; name: string; patronymic?: string; status: PatientStatus; procedure: string; allergies?: string };
  hour: number;
  dateStr?: string;
  onClose: () => void;
  onPatientClick?: (patient: { id?: string; name: string; patronymic?: string; status: PatientStatus; procedure: string; time: string; date?: string; allergies?: string }) => void;
  anchorRect: DOMRect;
}) {
  const POPOVER_WIDTH = 200;
  const POPOVER_HEIGHT = 80;
  const GAP = 6;
  const MARGIN = 8;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Vertical: prefer below, flip to above if no space
  const spaceBelow = vh - anchorRect.bottom;
  const top = spaceBelow >= POPOVER_HEIGHT + GAP
    ? anchorRect.bottom + GAP
    : anchorRect.top - POPOVER_HEIGHT - GAP;

  // Horizontal: center on anchor, clamp within viewport
  let left = anchorRect.left + anchorRect.width / 2 - POPOVER_WIDTH / 2;
  left = Math.max(MARGIN, Math.min(left, vw - POPOVER_WIDTH - MARGIN));

  return (
    <div
      className="fixed z-[200] bg-popover border rounded-lg shadow-elevated p-3 space-y-1.5 animate-reveal-up"
      style={{
        width: POPOVER_WIDTH,
        top,
        left,
      }}
    >
      <div className="flex items-center justify-between">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPatientClick?.({ ...slot, time: `${String(hour).padStart(2, "0")}:00`, date: dateStr });
          }}
          className="flex items-center gap-1.5 min-w-0 hover:underline"
        >
          <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", statusDot[slot.status])} />
          {hasConfirmedAllergen(slot.allergies) && (
            <AllergyShield size={13} style={{ filter: "drop-shadow(0 0 4px rgba(239,68,68,0.65))" }} className="shrink-0" />
          )}
          <span className="text-xs font-semibold text-foreground truncate">{(() => {
            const parts = slot.name.split(" ");
            const surname = parts[0] || "";
            const firstInit = parts[1]?.[0] ? parts[1][0] + "." : "";
            const patronymicInit = slot.patronymic?.[0] ? slot.patronymic[0] + "." : "";
            return `${surname} ${firstInit}${patronymicInit}`.trim();
          })()}</span>
        </button>
        <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="p-0.5 rounded hover:bg-accent active:scale-[0.9] transition-all shrink-0">
          <X size={12} className="text-muted-foreground" />
        </button>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPatientClick?.({ ...slot, time: `${String(hour).padStart(2, "0")}:00`, date: dateStr });
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
  selectedSlot,
  realPatients,
}: {
  weekDates: Date[];
  onSlotClick: (date: Date, hour: number) => void;
  onSelectDay: (d: Date) => void;
  onPatientClick?: (patient: { id?: string; name: string; patronymic?: string; status: PatientStatus; procedure: string; time: string; date?: string }) => void;
  searchQuery?: string;
  selectedSlot?: { dateStr: string; hour: number; name?: string };
  realPatients?: Patient[];
}) {
  const today = new Date();
  const [activePopover, setActivePopover] = useState<{ key: string; rect: DOMRect } | null>(null);

  const slotsPerDay = useMemo(() => {
    return weekDates.map((d) => {
      const dateStr = dateToStr(d);
      const mock = getMockSlots(dateStr);
      if (!realPatients?.length) return mock;
      return mock.map(slot => {
        const real = pickPatientForSlot(realPatients, dateStr, slot.hour);
        if (real) return { hour: slot.hour, patient: { id: real.id, name: real.name, patronymic: real.patronymic, status: computePatientStatus(real), procedure: real.procedure, allergies: real.allergies } };
        return slot;
      });
    });
  }, [weekDates, realPatients]);

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
                "text-center py-2 transition-all active:scale-[0.96] relative",
                i < 6 && "border-r border-border",
                isToday && "bg-[hsl(204,100%,93%)]",
                past && !isToday && "bg-slate-50"
              )}
            >
              <p className={cn(
                "text-[11px] font-bold uppercase leading-none",
                past && !isToday ? "text-slate-400" : "text-foreground/50"
              )}>
                {DAY_LABELS[i]}
              </p>
              <p className={cn(
                "text-base font-bold tabular-nums leading-tight mt-0.5",
                isToday ? "text-primary" : past ? "text-slate-400" : "text-foreground"
              )}>
                {d.getDate()}
              </p>
              {past && !isToday && (
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-4 h-[2px] rounded-full bg-slate-300/70" />
              )}
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
              const isSearchMatch = !!(searchQuery.trim() && slot?.patient?.name.toLowerCase().includes(searchQuery.toLowerCase()));

              const statusBg = slot?.patient ? statusSlotBg[slot.patient.status] : null;

              const isSelected = !slot?.patient && !!selectedSlot && dateToStr(d) === selectedSlot.dateStr && hour === selectedSlot.hour;

              const isToday = isSameDay(d, today);
              return (
                <div
                  key={di}
                  className={cn(
                    "relative p-[5px]",
                    isSearchMatch
                      ? "bg-primary/20 ring-2 ring-inset ring-primary/70 z-[5]"
                      : isSelected ? "bg-sky-100/80" : "bg-white",
                    hi < HOURS.length - 1 && "border-b border-border",
                    di < 6 && "border-r border-border"
                  )}
                >
                  <button
                    onClick={(e) => {
                      if (slot?.patient) {
                        const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                        setActivePopover(activePopover?.key === popoverKey ? null : { key: popoverKey, rect });
                      } else {
                        setActivePopover(null);
                        onSlotClick(d, hour);
                      }
                    }}
                    className={cn(
                      "w-full h-[28px] rounded transition-all duration-150 flex items-center justify-center",
                      "active:scale-[0.90]",
                      isSearchMatch
                        ? "bg-primary/40 border-2 border-primary"
                        : isSelected
                          ? "bg-sky-200 border border-sky-500/60"
                          : statusBg
                          ? cn(statusBg, "hover:opacity-85")
                          : "bg-transparent",
                    )}
                    style={past && slot?.patient ? { backgroundImage: "repeating-linear-gradient(60deg, transparent, transparent 4px, rgba(255,255,255,0.55) 4px, rgba(255,255,255,0.55) 5.5px)" } : undefined}
                  >
                    {isSelected && selectedSlot?.name && (
                      <span className="text-[8px] font-bold text-primary truncate px-0.5 leading-none">
                        {selectedSlot.name}
                      </span>
                    )}
                    {!isSelected && slot?.patient && (
                      <div className="flex items-center gap-0.5">
                        {past && slot.patient.status === "ready" && <Check size={12} className="text-status-ready" strokeWidth={3} />}
                        {past && slot.patient.status === "risk" && <span className="text-[9px] font-extrabold text-status-risk">Н/З</span>}
                        {hasConfirmedAllergen(slot.patient.allergies) && (
                          <AllergyShield size={11} style={{ filter: "drop-shadow(0 0 3px rgba(239,68,68,0.7))" }} className="shrink-0" />
                        )}
                      </div>
                    )}
                  </button>
                  {slot?.patient && activePopover?.key === popoverKey && (
                     <SlotPopover
                      slot={slot.patient}
                      hour={hour}
                      dateStr={dateToStr(d)}
                      onClose={() => setActivePopover(null)}
                      onPatientClick={onPatientClick}
                      anchorRect={activePopover.rect}
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
  selectedSlot,
  realPatients,
}: {
  date: Date;
  onSlotClick: (date: Date, hour: number) => void;
  onPatientClick?: (patient: { id?: string; name: string; patronymic?: string; status: PatientStatus; procedure: string; time: string; date?: string; allergies?: string }) => void;
  searchQuery?: string;
  selectedSlot?: { dateStr: string; hour: number; name?: string };
  realPatients?: Patient[];
}) {
  const slots = useMemo(() => {
    const dateStr = dateToStr(date);
    const mock = getMockSlots(dateStr);
    if (!realPatients?.length) return mock;
    return mock.map(slot => {
      const real = pickPatientForSlot(realPatients, dateStr, slot.hour);
      if (real) return { hour: slot.hour, patient: { id: real.id, name: real.name, patronymic: real.patronymic, status: computePatientStatus(real), procedure: real.procedure, allergies: real.allergies } };
      return slot;
    });
  }, [date, realPatients]);

  const statusColor: Record<PatientStatus, string> = {
    planning: "bg-slate-300 border-slate-500/70",
    progress: "bg-status-progress-bg border-status-progress/35",
    risk: "bg-status-risk-bg border-status-risk/35",
    ready: "bg-status-ready-bg border-status-ready/35",
  };

  const statusLabel: Record<PatientStatus, string> = {
    planning: "Планування",
    progress: "Підготовка",
    risk: "Ризик",
    ready: "Допущено",
  };

  const matchRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (searchQuery.trim() && matchRef.current) {
      matchRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [searchQuery, date]);

  return (
    <div className="space-y-1">
      {slots.map((slot, i) => {
        const isSearchMatch = !!(searchQuery.trim() && slot.patient?.name.toLowerCase().includes(searchQuery.toLowerCase()));
        const isSelected = !slot.patient && !!selectedSlot && dateToStr(date) === selectedSlot.dateStr && slot.hour === selectedSlot.hour;
        return (
          <div key={slot.hour} className="relative" ref={isSearchMatch ? matchRef : undefined}>
            <button
              onClick={() => {
                if (slot.patient) {
                  onPatientClick?.({ ...slot.patient, time: `${String(slot.hour).padStart(2, "0")}:00`, date: dateToStr(date) });
                } else {
                  onSlotClick(date, slot.hour);
                }
              }}
              title={slot.patient ? `${slot.patient.name}${slot.patient.patronymic ? ` ${slot.patient.patronymic}` : ""}\n${slot.patient.procedure}\nСтатус: ${statusLabel[slot.patient.status]}\nПідготовка: ${Math.floor(Math.random() * 100)}% виконано${hasConfirmedAllergen(slot.patient.allergies) ? `\n⚠️ АЛЕРГІЯ: ${parseAllergyState(slot.patient.allergies).allergen}` : ""}\nОстанній контакт: ${new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}` : undefined}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all duration-200",
                "active:scale-[0.98] animate-reveal-up",
                isSelected
                  ? "bg-primary/15 border border-primary/50"
                  : slot.patient
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
                  {hasConfirmedAllergen(slot.patient.allergies) && (
                    <AllergyShield size={15} style={{ filter: "drop-shadow(0 0 5px rgba(239,68,68,0.7))" }} className="shrink-0" />
                  )}
                  <span className="text-[15px] font-semibold text-foreground truncate">
                    {slot.patient.name}{slot.patient.patronymic ? ` ${slot.patient.patronymic}` : ""}
                  </span>
                  <span className="text-sm text-muted-foreground truncate ml-auto">
                    {slot.patient.procedure}
                  </span>
                </div>
              ) : isSelected && selectedSlot?.name ? (
                <span className="text-sm font-bold text-primary truncate">{selectedSlot.name}</span>
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
