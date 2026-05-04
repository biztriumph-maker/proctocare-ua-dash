import { X, Phone, CalendarDays, ChevronRight, AlertTriangle, ArrowRight } from "lucide-react";
import { useEffect, useState, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { correctNameSpelling } from "@/lib/nameCorrection";
import { ProcedureSelector } from "./ProcedureSelector";
import { CalendarView } from "./CalendarView";
import type { Patient } from "./PatientCard";
import { CountryPhoneInput } from "./CountryPhoneInput";

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
  /** Якщо пацієнт обраний з існуючих — його стабільний patients.id з Supabase */
  existingPatientDbId?: string;
}

interface NewEntryFormProps {
  prefillDate?: string;
  prefillTime?: string;
  realPatients?: Patient[];
  onClose: () => void;
  onSave: (entry: NewEntryData) => void;
  /** Called when doctor clicks "Так, відкрити" on the duplicate-patient warning */
  onOpenExistingPatient?: (patient: Patient) => void;
}


// Static suggestions removed — real patients are used from realPatients prop

export function NewEntryForm({ prefillDate, prefillTime, realPatients, onClose, onSave, onOpenExistingPatient }: NewEntryFormProps) {
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("");
  const [isPhoneValid, setIsPhoneValid] = useState(false);
  const [procedures, setProcedures] = useState<string[]>([]);
  const [showProcedureSelector, setShowProcedureSelector] = useState(false);
  const [date, setDate] = useState(() => {
    if (prefillDate) return prefillDate;
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  });
  const [time, setTime] = useState(prefillTime || "");
  const [notes, setNotes] = useState("");
  const aiPrep = true; // default, toggle moved to patient card
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showPlanningPicker, setShowPlanningPicker] = useState(false);
  const nameRef = useRef<HTMLTextAreaElement>(null);
  // Якщо користувач обрав існуючого пацієнта зі списку — зберігаємо його patientDbId
  const [existingPatientDbId, setExistingPatientDbId] = useState<string | null>(null);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Дедуплікованний список реальних пацієнтів (по patientDbId або ПІБ)
  const uniqueRealPatients = (() => {
    if (!realPatients?.length) return [];
    const seen = new Set<string>();
    return realPatients.filter((p) => {
      const key = p.patientDbId || `${p.name}|${p.patronymic || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  const filteredSuggestions = name.length >= 1
    ? uniqueRealPatients.filter((p) => {
        const full = `${p.name}${p.patronymic ? ' ' + p.patronymic : ''}`;
        return full.toLowerCase().includes(name.toLowerCase());
      }).slice(0, 5)
    : [];

  // ── Duplicate detection ──
  // Triggered as soon as all 6 parameters are filled:
  // Прізвище + Ім'я + По батькові (3 parts in the name field) + full DD.MM.YYYY birth date.
  const duplicatePatient = useMemo<Patient | null>(() => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const formSurname = parts[0]?.toLowerCase() || "";
    const formFirstName = parts[1]?.toLowerCase() || "";
    const formPatronymic = parts.slice(2).join(" ").toLowerCase();
    // All three name parts required
    if (!formSurname || !formFirstName || !formPatronymic) return null;
    // Full birth date required (8 digits = DD.MM.YYYY)
    if (birthDate.replace(/\D/g, "").length !== 8) return null;
    const formBirthDate = birthDate.trim();
    return uniqueRealPatients.find((p) => {
      const pParts = (p.name || "").trim().split(/\s+/).filter(Boolean);
      const pSurname = pParts[0]?.toLowerCase() || "";
      const pFirstName = pParts[1]?.toLowerCase() || "";
      const pPatronymic = (p.patronymic || "").trim().toLowerCase();
      const pBirthDate = (p.birthDate || "").trim();
      return (
        pSurname === formSurname &&
        pFirstName === formFirstName &&
        pPatronymic === formPatronymic &&
        pBirthDate === formBirthDate
      );
    }) ?? null;
  }, [name, birthDate, uniqueRealPatients]);

  const handleSave = () => {
    if (!name || !date || !time || procedures.length === 0 || !isPhoneValid) return;
    const words = name.trim().split(/\s+/);
    const parsedName = words.slice(0, 2).join(" ");
    const patronymic = words.slice(2).join(" ");
    onSave({ name: parsedName, patronymic, birthDate, phone, procedure: procedures[0], procedures, date, time, notes, aiPrep, existingPatientDbId: existingPatientDbId || undefined });
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
                // Якщо користувач вручну змінює ім'я — знімаємо прив'язку до існуючого пацієнта
                setExistingPatientDbId(null);
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
                {filteredSuggestions.map((patient) => {
                  const fullName = `${patient.name}${patient.patronymic ? ' ' + patient.patronymic : ''}`;
                  return (
                    <button
                      key={patient.patientDbId || patient.id}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => {
                        // Автозаповнення з профілю існуючого пацієнта
                        setName(fullName);
                        setExistingPatientDbId(patient.patientDbId || null);
                        if (patient.phone) setPhone(patient.phone);
                        if (patient.birthDate) setBirthDate(patient.birthDate);
                        setShowSuggestions(false);
                        if (nameRef.current) {
                          nameRef.current.style.height = "auto";
                          nameRef.current.style.height = nameRef.current.scrollHeight + "px";
                        }
                      }}
                      className="w-full text-left px-3 py-2 text-[13px] text-foreground hover:bg-accent/60 transition-colors"
                    >
                      <span className="font-medium">{fullName}</span>
                      {patient.phone && (
                        <span className="ml-2 text-muted-foreground text-[11px]">{patient.phone}</span>
                      )}
                    </button>
                  );
                })}
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
            <CountryPhoneInput
              value={phone}
              onChange={setPhone}
              onValidityChange={setIsPhoneValid}
              inputClassName="py-2.5"
              buttonClassName="py-2.5"
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
                    const y = selectedDate.getFullYear();
                    const mo = String(selectedDate.getMonth() + 1).padStart(2, "0");
                    const d = String(selectedDate.getDate()).padStart(2, "0");
                    setDate(`${y}-${mo}-${d}`);
                    setTime(`${String(hour).padStart(2, "0")}:00`);
                  }}
                  realPatients={realPatients}
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

        {/* Duplicate patient warning */}
        {duplicatePatient && (
          <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3.5 space-y-2.5 animate-fade-in">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-amber-900 leading-snug">
                  Цей пацієнт уже зафіксований у системі (Архів).
                </p>
                <p className="text-[12px] text-amber-700 mt-0.5">
                  Бажаєте відкрити його історію та створити новий візит?
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                onOpenExistingPatient?.(duplicatePatient);
              }}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[13px] font-bold transition-colors active:scale-[0.97]"
            >
              Так, відкрити
              <ArrowRight size={14} />
            </button>
          </div>
        )}

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={!!duplicatePatient || !name.trim() || !date || !time || procedures.length === 0 || !isPhoneValid || birthDate.replace(/\D/g, "").length !== 8}
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
