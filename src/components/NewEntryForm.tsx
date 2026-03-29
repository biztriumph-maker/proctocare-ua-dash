import { X, Phone, CalendarDays, ChevronRight } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { correctNameSpelling } from "@/lib/nameCorrection";
import { ProcedureSelector } from "./ProcedureSelector";
import { CalendarView } from "./CalendarView";

export interface NewEntryData {
  name: string;
  patronymic: string;
  birthDate: string;
  phone: string;
  procedure: string;
  procedures: string[];
  date: string;
  time: string;
  notes: string;
  aiPrep: boolean;
}

interface NewEntryFormProps {
  prefillDate?: string;
  prefillTime?: string;
  onClose: () => void;
  onSave: (entry: NewEntryData) => void;
}


const PATIENT_SUGGESTIONS = [
  "Коваленко Олена Василівна",
  "Мельник Ігор Петрович",
  "Шевченко Тарас Олексійович",
  "Бондаренко Вікторія Іванівна",
  "Ткаченко Наталія Миколаївна",
  "Лисенко Андрій Сергійович",
  "Гриценко Марія Олексіївна",
  "Петренко Олег Андрійович",
  "Сидоренко Ірина Василівна",
];

function normalizeUaPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "+380";

  let localPart = digits;
  if (localPart.startsWith("380")) localPart = localPart.slice(3);
  else if (localPart.startsWith("0")) localPart = localPart.slice(1);

  localPart = localPart.slice(0, 9);
  return `+380${localPart}`;
}

function formatUaPhoneMasked(value: string): string {
  const normalized = normalizeUaPhone(value);
  const localPart = normalized.slice(4);
  const p1 = localPart.slice(0, 2);
  const p2 = localPart.slice(2, 5);
  const p3 = localPart.slice(5, 7);
  const p4 = localPart.slice(7, 9);

  const chunks = [p1, p2, p3, p4].filter(Boolean);
  return chunks.length ? `+380 ${chunks.join(" ")}` : "+380";
}

export function NewEntryForm({ prefillDate, prefillTime, onClose, onSave }: NewEntryFormProps) {
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("+380 ");
  const [procedures, setProcedures] = useState<string[]>([]);
  const [showProcedureSelector, setShowProcedureSelector] = useState(false);
  const [date, setDate] = useState(prefillDate || new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(prefillTime || "");
  const [notes, setNotes] = useState("");
  const aiPrep = true; // default, toggle moved to patient card
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showPlanningPicker, setShowPlanningPicker] = useState(false);
  const nameRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const filteredSuggestions = name.length > 0
    ? PATIENT_SUGGESTIONS.filter((p) => p.toLowerCase().includes(name.toLowerCase()))
    : [];

  const handleSave = () => {
    if (!name || !date || !time || procedures.length === 0) return;
    const words = name.trim().split(/\s+/);
    const parsedName = words.slice(0, 2).join(" ");
    const patronymic = words.slice(2).join(" ");
    onSave({ name: parsedName, patronymic, birthDate, phone: normalizeUaPhone(phone), procedure: procedures[0], procedures, date, time, notes, aiPrep });
  };

  const formattedDate = (() => {
    try {
      const d = new Date(date + "T00:00:00");
      return d.toLocaleDateString("uk-UA", { weekday: "short", day: "numeric", month: "long" });
    } catch {
      return date;
    }
  })();

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div className="relative z-10 bg-surface-raised w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-elevated p-5 space-y-4 animate-fade-in max-h-[92dvh] overflow-y-auto safe-bottom">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-foreground">Новий запис</h2>
            {(prefillDate || prefillTime) && (
              <p className="text-[11px] text-primary font-medium mt-0.5">
                {formattedDate}{prefillTime ? ` · ${prefillTime}` : ""}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-accent active:scale-[0.95] transition-all">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3.5">
          {/* Patient full name (ПІБ) — searchable textarea */}
          <div className="relative">
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block flex items-center gap-1">
              ПІБ ПАЦІЄНТА <span className="text-status-risk text-sm leading-none">*</span>
            </label>
            <textarea
              ref={nameRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setShowSuggestions(true);
                e.target.style.height = "auto";
                e.target.style.height = e.target.scrollHeight + "px";
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => {
                setShowSuggestions(false);
                const corrected = correctNameSpelling(name);
                if (corrected !== name) {
                  setName(corrected);
                  if (nameRef.current) {
                    nameRef.current.value = corrected;
                    nameRef.current.style.height = "auto";
                    nameRef.current.style.height = nameRef.current.scrollHeight + "px";
                  }
                }
              }}
              placeholder="Прізвище Ім'я По батькові"
              rows={1}
              spellCheck
              lang="uk"
              autoCorrect="on"
              autoCapitalize="words"
              className="w-full px-3 py-2.5 rounded-lg border bg-background text-sm font-medium placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all resize-none overflow-hidden"
            />
            {showSuggestions && filteredSuggestions.length > 0 && (
              <div className="absolute z-[55] bottom-full left-0 right-0 mb-1 bg-popover border rounded-lg shadow-elevated overflow-hidden">
                {filteredSuggestions.slice(0, 4).map((suggestion) => (
                  <button
                    key={suggestion}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setName(suggestion);
                      setShowSuggestions(false);
                      // resize textarea
                      if (nameRef.current) {
                        nameRef.current.style.height = "auto";
                        nameRef.current.style.height = nameRef.current.scrollHeight + "px";
                      }
                    }}
                    className="w-full text-left px-3 py-2 text-[13px] text-foreground hover:bg-accent/60 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Birth Date + Age in one row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block flex items-center gap-1">
                ДАТА НАРОДЖЕННЯ <span className="text-status-risk text-sm leading-none">*</span>
              </label>
              <input
                type="text"
                value={birthDate}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^\d]/g, "").slice(0, 8);
                  let formatted = raw;
                  if (raw.length > 2) formatted = raw.slice(0, 2) + "." + raw.slice(2);
                  if (raw.length > 4) formatted = raw.slice(0, 2) + "." + raw.slice(2, 4) + "." + raw.slice(4);
                  setBirthDate(formatted);
                }}
                placeholder="ДД.ММ.РРРР"
                maxLength={10}
                className="w-full px-3 py-2.5 rounded-lg border bg-background text-sm font-bold tabular-nums placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                Вік
              </label>
              <div className="flex items-center px-3 py-2.5 rounded-lg border bg-background h-[42px]">
                <span className="text-sm font-bold text-foreground tabular-nums">
                  {(() => {
                    const parts = birthDate.split(".");
                    if (parts.length === 3 && parts[2].length === 4) {
                      const bd = new Date(+parts[2], +parts[1] - 1, +parts[0]);
                      if (!isNaN(bd.getTime())) {
                        const today = new Date();
                        let age = today.getFullYear() - bd.getFullYear();
                        const m = today.getMonth() - bd.getMonth();
                        if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
                        if (age >= 0 && age < 150) {
                          const ld = age % 10, lt = age % 100;
                          const s = (lt >= 11 && lt <= 14) ? "років" : ld === 1 ? "рік" : (ld >= 2 && ld <= 4) ? "роки" : "років";
                          return `${age} ${s}`;
                        }
                      }
                    }
                    return "... років";
                  })()}
                </span>
              </div>
            </div>
          </div>

          {/* Phone */}
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block flex items-center gap-1">
              <span className="flex items-center gap-1"><Phone size={10} className="-mt-0.5" /> ТЕЛЕФОН</span> <span className="text-status-risk text-sm leading-none">*</span>
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(formatUaPhoneMasked(e.target.value))}
              placeholder="+380 __ ___ __ __"
              type="tel"
              className={cn(
                "w-full px-3 py-2.5 rounded-lg border bg-background text-sm font-medium transition-all focus:outline-none focus:ring-2",
                phone && phone.replace(/\D/g, "").length !== 12
                  ? "border-status-risk text-status-risk focus:border-status-risk focus:ring-status-risk/20"
                  : "text-foreground placeholder:text-muted-foreground/40 focus:border-primary/40 focus:ring-primary/20",
                phone && phone.replace(/\D/g, "").length === 12 && "border-status-ready focus:border-status-ready focus:ring-status-ready/20"
              )}
            />
          </div>

          {/* Procedure — fullscreen selector */}
          <div>
            <button
              type="button"
              onClick={() => setShowProcedureSelector(true)}
              className="w-full text-left"
            >
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block flex items-center gap-1">
                {procedures.length > 0 ? "ЗМІНИТИ ПОСЛУГИ" : "ОБРАТИ ПОСЛУГИ"} <span className="text-status-risk text-sm leading-none">*</span>
              </span>
              {procedures.length === 0 ? (
                <div className="flex items-center justify-between px-3 py-2.5 rounded-lg border bg-background text-sm font-medium text-muted-foreground/40 hover:border-primary/40 transition-all">
                  <span>Обрати процедуру</span>
                  <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 pt-0.5">
                  {procedures.map((p) => (
                    <span
                      key={p}
                      className="text-xs font-bold px-3 py-1.5 rounded-full"
                      style={{ backgroundColor: "#E3F2FD", color: "#1976D2" }}
                    >
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </button>
          </div>

          {/* Date & Time — opens planning calendar */}
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block flex items-center gap-1">ДАТА ТА ЧАС <span className="text-status-risk text-sm leading-none">*</span></label>
            <button
              type="button"
              onClick={() => setShowPlanningPicker(true)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all text-left hover:border-primary/40"
            >
              <span className={cn(date && time ? "text-foreground font-bold" : "text-muted-foreground/40")}>
                {date && time ? `${new Date(date + "T00:00:00").toLocaleDateString("uk-UA", { day: "numeric", month: "long", weekday: "short" })} · ${time}` : "Обрати дату та час"}
              </span>
              <CalendarDays size={16} className="text-muted-foreground shrink-0" />
            </button>
          </div>

          {/* Planning Picker Overlay — full CalendarView */}
          {showPlanningPicker && (
            <div className="fixed inset-0 z-[60] flex flex-col bg-background animate-fade-in">
              <div className="flex items-center justify-between px-4 py-3 border-b bg-card shrink-0">
                <div>
                  <h3 className="text-sm font-bold text-foreground">Оберіть дату та час</h3>
                  {date && time && (
                    <p className="text-xs text-primary font-bold mt-0.5">
                      {new Date(date + "T00:00:00").toLocaleDateString("uk-UA", { day: "numeric", month: "long" })} · {time}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {date && time && (
                    <button
                      onClick={() => setShowPlanningPicker(false)}
                      className="px-4 py-2 bg-primary text-primary-foreground text-sm font-bold rounded-lg active:scale-[0.96] transition-all"
                    >
                      Підтвердити
                    </button>
                  )}
                  <button
                    onClick={() => setShowPlanningPicker(false)}
                    className="p-1.5 rounded-md hover:bg-accent active:scale-[0.95] transition-all"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <CalendarView
                  onSlotClick={(selectedDate, hour) => {
                    setDate(selectedDate.toISOString().slice(0, 10));
                    setTime(`${String(hour).padStart(2, "0")}:00`);
                  }}
                  selectedSlot={date && time ? {
                    dateStr: date,
                    hour: parseInt(time),
                    name: name.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(" ") || undefined,
                  } : undefined}
                />
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">Нотатки</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Додаткова інформація..."
              rows={2}
              spellCheck
              lang="uk"
              autoCorrect="on"
              autoCapitalize="sentences"
              className="w-full px-3 py-2.5 rounded-lg border bg-background text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all resize-none"
            />
          </div>

          {/* AI Prep toggle removed — moved to patient card */}
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={!name.trim() || !date || !time || procedures.length === 0 || phone.replace(/\D/g, "").length !== 12 || birthDate.replace(/\D/g, "").length !== 8}
          className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-bold text-sm transition-all duration-200 hover:shadow-card-hover active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
        >
          Зберегти запис
        </button>
      </div>

      {showProcedureSelector && (
        <ProcedureSelector
          selected={procedures}
          onConfirm={(sel) => {
            setProcedures(sel);
            setShowProcedureSelector(false);
          }}
          onClose={() => setShowProcedureSelector(false)}
        />
      )}
    </div>
  );
}
