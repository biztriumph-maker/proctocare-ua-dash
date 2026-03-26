import { X, Phone, ChevronRight } from "lucide-react";
import { useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { ProcedureSelector } from "./ProcedureSelector";

export interface NewEntryData {
  name: string;
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
  "Коваленко Олена",
  "Мельник Ігор",
  "Шевченко Тарас",
  "Бондаренко Вікторія",
  "Ткаченко Наталія",
  "Лисенко Андрій",
  "Гриценко Марія",
  "Петренко Олег",
  "Сидоренко Ірина",
];

const HOURS = Array.from({ length: 10 }, (_, i) => i + 8);

export function NewEntryForm({ prefillDate, prefillTime, onClose, onSave }: NewEntryFormProps) {
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("+380");
  const [procedures, setProcedures] = useState<string[]>([]);
  const [showProcedureSelector, setShowProcedureSelector] = useState(false);
  const [date, setDate] = useState(prefillDate || new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(prefillTime || "");
  const [notes, setNotes] = useState("");
  const [aiPrep, setAiPrep] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const filteredSuggestions = name.length > 0
    ? PATIENT_SUGGESTIONS.filter((p) => p.toLowerCase().includes(name.toLowerCase()))
    : [];

  const handleSave = () => {
    if (!name || !date || !time || procedures.length === 0) return;
    onSave({ name, birthDate, phone, procedure: procedures[0], procedures, date, time, notes, aiPrep });
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-foreground/20 backdrop-blur-sm animate-fade-in">
      <div className="bg-surface-raised w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-elevated p-5 space-y-4 animate-slide-up max-h-[92vh] overflow-y-auto safe-bottom">
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
          {/* Patient name — searchable */}
          <div className="relative">
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">
              Пацієнт *
            </label>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="Прізвище та ім'я"
              className="w-full px-3 py-2.5 rounded-lg border bg-background text-sm font-medium placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
            />
            {showSuggestions && filteredSuggestions.length > 0 && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-elevated overflow-hidden animate-reveal-up">
                {filteredSuggestions.slice(0, 5).map((suggestion) => (
                  <button
                    key={suggestion}
                    onMouseDown={() => {
                      setName(suggestion);
                      setShowSuggestions(false);
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
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                Дата народження
              </label>
              <input
                type="text"
                inputMode="numeric"
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
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">
              <Phone size={10} className="inline mr-1 -mt-0.5" />
              Телефон *
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+380 __ ___ __ __"
              type="tel"
              className="w-full px-3 py-2.5 rounded-lg border bg-background text-sm font-medium tabular-nums placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
            />
          </div>

          {/* Procedure — fullscreen selector */}
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">
              Процедури *
            </label>
            <button
              type="button"
              onClick={() => setShowProcedureSelector(true)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all text-left"
            >
              <span className="text-muted-foreground/40">Обрати процедуру</span>
              <ChevronRight size={14} className="text-muted-foreground shrink-0" />
            </button>
            {procedures.length > 0 && (
              <div className="mt-1.5 space-y-1">
                {procedures.map((p) => (
                  <div key={p} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-primary/5 border border-primary/15">
                    <span className="text-xs font-medium text-foreground flex-1 truncate">{p}</span>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setShowProcedureSelector(true)}
                  className="w-full text-xs font-bold text-primary py-1.5 hover:underline transition-colors"
                >
                  Змінити послуги
                </button>
              </div>
            )}
          </div>

          {/* Date & Time — calendar picker */}
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">Дата та час</label>
            <button
              type="button"
              onClick={() => setShowCalendarPicker(true)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all text-left"
            >
              <span className={cn(date && time ? "text-foreground font-bold" : "text-muted-foreground/40")}>
                {date && time ? `${new Date(date + "T00:00:00").toLocaleDateString("uk-UA", { day: "numeric", month: "long" })} · ${time}` : "Обрати дату та час"}
              </span>
              <ChevronRight size={14} className="text-muted-foreground shrink-0" />
            </button>
          </div>

          {/* Calendar Picker Overlay */}
          {showCalendarPicker && (
            <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-foreground/20 backdrop-blur-sm animate-fade-in" onClick={() => setShowCalendarPicker(false)}>
              <div className="bg-surface-raised w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-elevated p-5 space-y-4 animate-slide-up max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground">Оберіть дату та час</h3>
                  <button onClick={() => setShowCalendarPicker(false)} className="p-1.5 rounded-md hover:bg-accent active:scale-[0.95] transition-all">
                    <X size={18} />
                  </button>
                </div>

                {/* Simple date grid */}
                <div>
                  <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Дата</p>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border bg-background text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                  />
                </div>

                {/* Time slots */}
                <div>
                  <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Час</p>
                  <div className="grid grid-cols-5 gap-2">
                    {HOURS.map((h) => {
                      const val = `${String(h).padStart(2, "0")}:00`;
                      return (
                        <button
                          key={h}
                          type="button"
                          onClick={() => setTime(val)}
                          className={cn(
                            "py-2.5 text-sm font-bold rounded-lg border transition-all active:scale-[0.95]",
                            time === val
                              ? "bg-primary text-primary-foreground border-primary shadow-sm"
                              : "bg-background text-foreground border-border hover:border-primary/40"
                          )}
                        >
                          {val}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowCalendarPicker(false)}
                  disabled={!date || !time}
                  className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-bold text-sm transition-all hover:shadow-card-hover active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
                >
                  Підтвердити
                </button>
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
              className="w-full px-3 py-2.5 rounded-lg border bg-background text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all resize-none"
            />
          </div>

          {/* AI Prep toggle removed — moved to patient card */}
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={!name || !date || !time || procedures.length === 0}
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
