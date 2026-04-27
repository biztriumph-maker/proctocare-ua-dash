import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, X, Check } from "lucide-react";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { Patient, PatientStatus } from "./PatientCard";
import { computePatientStatus, AllergyShield } from "./PatientCard";
import { hasConfirmedAllergen } from "@/lib/allergyState";

interface CalendarSlot {
  hour: number;
  patient?: { id?: string; name: string; patronymic?: string; status: PatientStatus; procedure: string; allergies?: string; completed?: boolean; noShow?: boolean };
}

interface CalendarViewProps {
  onSlotClick: (date: Date, hour: number) => void;
  onPatientClick?: (patient: { id?: string; name: string; patronymic?: string; status: PatientStatus; procedure: string; time: string; date?: string; allergies?: string }) => void;
  searchQuery?: string;
  selectedSlot?: { dateStr: string; hour: number; name?: string };
  realPatients?: Patient[];
  focusDate?: string;
  initialFocusDate?: string;
  suppressTransientOverlays?: boolean;
}

const statusDot: Record<PatientStatus, string> = {
  planning: "bg-slate-400",
  progress: "bg-yellow-500",
  yellow:   "bg-yellow-500",
  risk: "bg-red-500",
  ready: "bg-green-500",
};

const statusSlotBg: Record<PatientStatus, string> = {
  planning: "bg-slate-300 border border-slate-500/70",
  progress: "bg-status-progress-bg border border-status-progress/30",
  yellow:   "bg-status-progress-bg border border-status-progress/30",
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
  const candidate = exact ?? sameDate
    .filter((p) => getHourFromTime(p.time) === hour)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""))[0];

  if (!candidate) return undefined;

  // Completed visits are immutable calendar facts — always show them at their original date,
  // even when the same patient has a future planning visit on a different date.
  return candidate;
}

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function CalendarView({ onSlotClick, onPatientClick, searchQuery = "", selectedSlot, realPatients, focusDate, initialFocusDate, suppressTransientOverlays = false }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(() => {
    if (initialFocusDate) {
      const [y, mo, d] = initialFocusDate.split("-").map(Number);
      if (y && mo && d) return new Date(y, mo - 1, d);
    }
    return new Date();
  });
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

  useEffect(() => {
    if (!suppressTransientOverlays) return;
    setShowMonthPicker(false);
  }, [suppressTransientOverlays]);

  const weekDates = useMemo(() => getWeekDates(currentDate), [currentDate]);

  const monthLabel = useMemo(() => {
    return currentDate.toLocaleDateString("uk-UA", { month: "long", year: "numeric" });
  }, [currentDate]);

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
      // Navigate to the 1st of the target month so the week grid shows the beginning
      // of that month rather than the same day-of-month in the new month.
      const next = new Date(d.getFullYear(), d.getMonth() + delta, 1);
      return next;
    });
  };

  return (
    <div className="space-y-4 animate-fade-in box-border border-0">
      {/* View mode toggle */}
      <div className="flex h-[50px] gap-2 bg-transparent border-0">
        <button
          onClick={() => setViewMode("day")}
          className={cn(
            "flex h-full flex-1 items-center justify-center rounded-2xl border text-[16px] font-[500] tracking-[0.02em] transition-all duration-300 active:scale-[0.97]",
            viewMode === "day"
              ? "border-brand-active bg-brand-active text-white shadow-[0_2px_8px_rgba(0,51,102,0.18)]"
              : "border-slate-300 bg-slate-200 text-[#1e293b] hover:bg-slate-300 hover:border-slate-400"
          )}
        >
          День
        </button>
        <button
          onClick={() => setViewMode("week")}
          className={cn(
            "flex h-full flex-1 items-center justify-center rounded-2xl border text-[16px] font-[500] tracking-[0.02em] transition-all duration-300 active:scale-[0.97]",
            viewMode === "week"
              ? "border-brand-active bg-brand-active text-white shadow-[0_2px_8px_rgba(0,51,102,0.18)]"
              : "border-slate-300 bg-slate-200 text-[#1e293b] hover:bg-slate-300 hover:border-slate-400"
          )}
        >
          Тиждень
        </button>
      </div>

      {/* Date header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => (viewMode === "week" ? shiftMonth(-1) : shiftDay(-1))}
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
            : currentDate.toLocaleDateString("uk-UA", { month: "long", year: "numeric" })}
        </button>
        <button
          onClick={() => (viewMode === "week" ? shiftMonth(1) : shiftDay(1))}
          className="p-2 rounded-md hover:bg-accent active:scale-[0.95] transition-all"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Month picker overlay */}
      {showMonthPicker && (
        <div className="border-2 border-muted-foreground/40 rounded-lg shadow-[0_4px_20px_rgba(0,0,0,0.08)] bg-white p-3 space-y-2 animate-reveal-up">
          <div className="flex items-center justify-center">
            <span className="text-sm font-semibold capitalize">{monthLabel}</span>
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
          suppressTransientOverlays={suppressTransientOverlays}
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
  const GAP = 8;
  const MARGIN = 8;
  const POPOVER_HEIGHT = 78;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const popoverWidth = Math.min(220, vw - MARGIN * 2);

  // Horizontal: prefer right of slot; if it overflows, place to the left; then clamp.
  let left = anchorRect.right + GAP;
  if (left + popoverWidth > vw - MARGIN) {
    left = anchorRect.left - popoverWidth - GAP;
  }
  left = Math.max(MARGIN, Math.min(left, vw - popoverWidth - MARGIN));

  // Vertical: prefer below slot; if it overflows, place above; then clamp.
  let top = anchorRect.bottom + GAP;
  if (top + POPOVER_HEIGHT > vh - MARGIN) {
    top = anchorRect.top - POPOVER_HEIGHT - GAP;
  }
  top = Math.max(MARGIN, Math.min(top, vh - POPOVER_HEIGHT - MARGIN));

  const compactName = useMemo(() => {
    const parts = slot.name.trim().split(/\s+/).filter(Boolean);
    const lastName = parts[0] || "";
    const firstName = parts[1] || "";
    const middleNameFromName = parts.slice(2).join(" ");
    const middleName = (slot.patronymic || middleNameFromName || "").trim();
    return [
      lastName,
      firstName ? `${firstName[0]}.` : "",
      middleName ? `${middleName[0]}.` : "",
    ].filter(Boolean).join(" ");
  }, [slot.name, slot.patronymic]);

  return (
    <>
      <div className="fixed inset-0 z-[190]" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed z-[200] bg-white border border-[#D1D5DB] rounded-md p-2.5 space-y-1 animate-reveal-up"
        style={{
          width: popoverWidth,
          top,
          left,
          boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
        }}
      >
        <div className="flex items-start justify-between gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              onPatientClick?.({ ...slot, time: `${String(hour).padStart(2, "0")}:00`, date: dateStr });
            }}
            className="flex items-start gap-1 min-w-0 text-left hover:underline"
          >
            <span className={cn("w-2 h-2 rounded-full shrink-0 mt-1", statusDot[slot.status])} />
            {hasConfirmedAllergen(slot.allergies) && (
              <AllergyShield size={11} style={{ filter: "drop-shadow(0 0 4px rgba(239,68,68,0.65))" }} className="shrink-0 mt-0.5" />
            )}
            <span className="block text-[13px] leading-4 font-bold text-black truncate">{compactName}</span>
          </button>
          <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="p-0.5 rounded hover:bg-accent active:scale-[0.9] transition-all shrink-0 mt-[-1px]">
            <X size={10} className="text-muted-foreground" />
          </button>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
            onPatientClick?.({ ...slot, time: `${String(hour).padStart(2, "0")}:00`, date: dateStr });
          }}
            className="block w-full text-left text-[12px] leading-4 font-normal hover:text-primary hover:underline transition-colors cursor-pointer truncate"
            style={{ color: "#6B7280" }}
        >
          {slot.procedure}
        </button>
      </div>
    </>
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
  suppressTransientOverlays = false,
}: {
  weekDates: Date[];
  onSlotClick: (date: Date, hour: number) => void;
  onSelectDay: (d: Date) => void;
  onPatientClick?: (patient: { id?: string; name: string; patronymic?: string; status: PatientStatus; procedure: string; time: string; date?: string }) => void;
  searchQuery?: string;
  selectedSlot?: { dateStr: string; hour: number; name?: string };
  realPatients?: Patient[];
  suppressTransientOverlays?: boolean;
}) {
  const today = new Date();
  const [activePopover, setActivePopover] = useState<{ key: string; rect: DOMRect } | null>(null);

  useEffect(() => {
    if (!suppressTransientOverlays) return;
    setActivePopover(null);
  }, [suppressTransientOverlays]);

  useEffect(() => {
    setActivePopover(null);
  }, [realPatients, weekDates]);

  useEffect(() => {
    setActivePopover(null);
  }, [searchQuery, selectedSlot]);

  const slotsPerDay = useMemo(() => {
    return weekDates.map((d) => {
      const dateStr = dateToStr(d);
      const mock = getMockSlots(dateStr);
      if (!realPatients?.length) return mock;
      return mock.map(slot => {
        const real = pickPatientForSlot(realPatients, dateStr, slot.hour);
        if (real) return { hour: slot.hour, patient: { id: real.id, name: real.name, patronymic: real.patronymic, status: computePatientStatus(real), procedure: real.procedure, allergies: real.allergies, completed: !!real.completed, noShow: !!real.noShow } };
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
    <div className="border-2 border-muted-foreground/40 rounded-lg overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.08)] w-full">
      {/* Header row */}
      <div className="grid grid-cols-[36px_repeat(7,1fr)] sm:grid-cols-[48px_repeat(7,1fr)] border-b border-border w-full">
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
      <div className="grid grid-cols-[36px_repeat(7,1fr)] sm:grid-cols-[48px_repeat(7,1fr)] w-full">
        {HOURS.map((hour, hi) => (
          <div key={hour} className="contents">
            <div className={cn(
              "flex items-center justify-end pr-1 sm:pr-2 text-[9px] sm:text-xs text-foreground font-bold tabular-nums h-11 bg-[hsl(204,100%,97%)] min-w-0",
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
              const isNoShow = !!slot?.patient?.noShow || ((slot?.patient?.status as string) === "no_show");
              // A slot is "frozen" when the visit is completed and is not a no-show.
              const isFrozen = !isNoShow && (!!slot?.patient?.completed || (past && slot?.patient?.status === "ready"));
              // Completed visits always use the archived hatched style.
              const isFrozenCompleted = isFrozen;
              return (
                <div
                  key={di}
                  className={cn(
                    "relative p-[2px] sm:p-[5px] min-w-0 overflow-hidden",
                    isSearchMatch
                      ? "bg-primary/20 ring-2 ring-inset ring-primary/70 z-[5]"
                      : isSelected ? "bg-sky-100/80" : "bg-white",
                    hi < HOURS.length - 1 && "border-b border-border",
                    di < 6 && "border-r border-border"
                  )}
                >
                  {isSearchMatch && (
                    <span key={searchQuery} className="absolute inset-0 animate-flash-yellow pointer-events-none z-[6]" />
                  )}
                  <button
                    onClick={(e) => {
                      if (slot?.patient) {
                        const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                        setActivePopover(activePopover?.key === popoverKey ? null : { key: popoverKey, rect });
                        e.stopPropagation();
                        return;
                      }
                      if (isFrozen || isNoShow) {
                        // Frozen empty cell — do nothing
                        e.stopPropagation();
                        return;
                      }
                      setActivePopover(null);
                      onSlotClick(d, hour);
                    }}
                    className={cn(
                      "w-full h-[28px] rounded transition-all duration-150 flex items-center justify-center",
                      !isFrozen && !isNoShow && "active:scale-[0.90]",
                      slot?.patient ? "cursor-pointer" : isFrozen || isNoShow ? "cursor-default" : "",
                      isSearchMatch
                        ? "bg-primary/40 border-2 border-primary"
                        : isSelected
                          ? "bg-sky-200 border border-sky-500/60"
                          : !isFrozen && !isNoShow && statusBg
                          ? cn(statusBg, "hover:opacity-85")
                          : "bg-transparent",
                    )}
                    style={
                      isFrozenCompleted && slot?.patient
                        ? {
                            // Completed visits: pastel green + white diagonal stripes
                            backgroundColor: '#E8F5E9',
                            border: '1px solid #A5D6A7',
                            backgroundImage: 'repeating-linear-gradient(60deg, rgba(255,255,255,0.65) 0px, rgba(255,255,255,0.65) 2px, transparent 2px, transparent 7px)',
                          }
                        : isNoShow && slot?.patient
                        ? {
                            // No-show: light gray + diagonal hatching.
                            backgroundColor: '#ececef',
                            border: '1px solid #b5b5bd',
                            backgroundImage: 'repeating-linear-gradient(60deg, rgba(120,120,128,0.5) 0px, rgba(120,120,128,0.5) 1px, transparent 1px, transparent 7px)',
                          }
                        : undefined
                    }
                  >
                    {isSelected && (
                      <>
                        {/* Mobile: compact square dot */}
                        <span className="block sm:hidden w-3 h-3 rounded-sm bg-primary/80 mx-auto" />
                        {/* Desktop: name text */}
                        {selectedSlot?.name && (
                          <span className="hidden sm:block text-[8px] font-bold text-primary truncate px-0.5 leading-none">
                            {selectedSlot.name}
                          </span>
                        )}
                      </>
                    )}
                    {!isSelected && slot?.patient && (
                      <div className="absolute inset-0 pointer-events-none">
                        {hasConfirmedAllergen(slot.patient.allergies) && (
                          <AllergyShield
                            size={10}
                            style={{ filter: "drop-shadow(0 0 3px rgba(239,68,68,0.7))" }}
                            className="absolute left-[8px] top-1/2 -translate-y-1/2 shrink-0"
                          />
                        )}
                        {isNoShow && (
                          <span className="hidden sm:flex absolute inset-0 items-center justify-center text-[9px] font-extrabold text-status-risk z-10">
                            Н/З
                          </span>
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
      if (real) return { hour: slot.hour, patient: { id: real.id, name: real.name, patronymic: real.patronymic, status: computePatientStatus(real), procedure: real.procedure, allergies: real.allergies, completed: !!real.completed, noShow: !!real.noShow } };
      return slot;
    });
  }, [date, realPatients]);

  const statusColor: Record<PatientStatus, string> = {
    planning: "bg-slate-300 border-slate-500/70",
    progress: "bg-status-progress-bg border-status-progress/35",
    yellow:   "bg-status-progress-bg border-status-progress/35",
    risk: "bg-status-risk-bg border-status-risk/35",
    ready: "bg-status-ready-bg border-status-ready/35",
  };

  const statusLabel: Record<PatientStatus, string> = {
    planning: "Планування",
    progress: "Підготовка",
    yellow:   "Підготовка",
    risk: "Ризик",
    ready: "Допущено",
  };

  const matchRef = useRef<HTMLDivElement | null>(null);
  const [activePopover, setActivePopover] = useState<{ key: string; rect: DOMRect } | null>(null);

  useEffect(() => {
    setActivePopover(null);
  }, [date, searchQuery, selectedSlot, realPatients]);

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
        const isNoShow = !!slot.patient?.noShow || ((slot.patient?.status as string) === "no_show");
        const popoverKey = `${slot.hour}`;
        const todayAtStart = new Date();
        todayAtStart.setHours(0, 0, 0, 0);
        const dateAtStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const isPastDate = dateAtStart < todayAtStart;
        const isCompletedVisit = !isNoShow && (!!slot.patient?.completed || (isPastDate && slot.patient?.status === "ready"));
        return (
          <div key={slot.hour} className={cn("relative", isSearchMatch && "rounded-lg overflow-hidden")} ref={isSearchMatch ? matchRef : undefined}>
            {isSearchMatch && (
              <span key={searchQuery} className="absolute inset-0 animate-flash-yellow rounded-lg pointer-events-none z-[1]" />
            )}
            <button
              onClick={(e) => {
                if (slot.patient) {
                  const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                  setActivePopover(activePopover?.key === popoverKey ? null : { key: popoverKey, rect });
                } else {
                  setActivePopover(null);
                  onSlotClick(date, slot.hour);
                }
              }}
              className={cn(
                "w-full h-[50px] flex items-stretch rounded-lg text-left transition-all duration-200",
                "active:scale-[0.98] animate-reveal-up",
                isSearchMatch && "ring-2 ring-primary ring-offset-1"
              )}
              style={{
                animationDelay: `${i * 40}ms`,
              }}
            >
              <span className="flex w-14 shrink-0 items-center pr-3 text-[16px] font-[500] text-foreground tabular-nums">
                {String(slot.hour).padStart(2, "0")}:00
              </span>
              <span className="my-2 w-px shrink-0 bg-[#E5E7EB]" aria-hidden="true" />
              {slot.patient ? (
                <div
                  className={cn(
                    "ml-3 flex min-w-0 flex-1 items-center gap-2 rounded-[10px] px-3",
                    isCompletedVisit
                      ? "border border-[#A5D6A7] bg-[#E8F5E9]"
                      : isNoShow
                      ? "border border-[#b5b5bd] bg-[#ececef]"
                      : cn("border-l-2 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)]", statusColor[slot.patient.status]),
                    isSelected && "ring-2 ring-primary/40"
                  )}
                  style={
                    isCompletedVisit
                      ? {
                          backgroundImage: 'repeating-linear-gradient(60deg, rgba(255,255,255,0.65) 0px, rgba(255,255,255,0.65) 2px, transparent 2px, transparent 7px)',
                          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
                        }
                      : isNoShow
                      ? {
                          backgroundImage: 'repeating-linear-gradient(60deg, rgba(120,120,128,0.5) 0px, rgba(120,120,128,0.5) 1px, transparent 1px, transparent 7px)',
                          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
                        }
                      : undefined
                  }
                >
                  <span className={cn("w-2 h-2 rounded-full shrink-0", isNoShow ? "bg-status-risk" : statusDot[slot.patient.status])} />
                  {hasConfirmedAllergen(slot.patient.allergies) && (
                    <AllergyShield size={15} style={{ filter: "drop-shadow(0 0 5px rgba(239,68,68,0.7))" }} className="shrink-0" />
                  )}
                  <span className="text-[16px] font-[500] text-foreground truncate min-w-0">
                    {slot.patient.name}{slot.patient.patronymic ? ` ${slot.patient.patronymic}` : ""}
                  </span>
                  {isNoShow && (
                    <span className="shrink-0 text-xs font-extrabold text-status-risk">Н/З</span>
                  )}
                  <span className="ml-auto shrink-0 text-[14px] text-muted-foreground/60 hidden sm:block">
                    {slot.patient.procedure}
                  </span>
                </div>
              ) : (
                <div
                  className={cn(
                    "ml-3 flex min-w-0 flex-1 items-center rounded-[10px] border border-[#F3F4F6] bg-[#FBFBFC] px-3",
                    isSelected && "border-primary/40 bg-primary/10"
                  )}
                >
                  {isSelected && selectedSlot?.name ? (
                    <span className="truncate text-[16px] font-[500] text-primary">{selectedSlot.name}</span>
                  ) : (
                    <span className="text-[16px] font-[500] text-[#9CA3AF]">вільно</span>
                  )}
                </div>
              )}
            </button>
            {slot.patient && activePopover?.key === popoverKey && (
              <SlotPopover
                slot={slot.patient}
                hour={slot.hour}
                dateStr={dateToStr(date)}
                onClose={() => setActivePopover(null)}
                onPatientClick={onPatientClick}
                anchorRect={activePopover.rect}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
