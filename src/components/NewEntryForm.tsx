import { X, Phone, CalendarDays, ChevronRight } from "lucide-react";
import { useState, useRef } from "react";
import { cn } from "@/lib/utils";
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

export function NewEntryForm({ prefillDate, prefillTime, onClose, onSave }: NewEntryFormProps) {
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("+380");
  const [procedures, setProcedures] = useState<string[]>([]);
  const [showProcedureSelector, setShowProcedureSelector] = useState(false);
  const [date, setDate] = useState(prefillDate || new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(prefillTime || "");
  const [notes, setNotes] = useState("");
  const aiPrep = true; // default, toggle moved to patient card
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showPlanningPicker, setShowPlanningPicker] = useState(false);
  const nameRef = useRef<HTMLTextAreaElement>(null);
  const birthDateRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  const filteredSuggestions = name.length > 0
    ? PATIENT_SUGGESTIONS.filter((p) => p.toLowerCase().includes(name.toLowerCase()))
    : [];

  const handleSave = () => {
    if (!name || !date || !time || procedures.length === 0) return;
    const words = name.trim().split(/\s+/);
    const parsedName = words.slice(0, 2).join(" ");
    const patronymic = words.slice(2).join(" ");
    const finalBirthDate = birthDateRef.current?.value || birthDate;
    const finalPhone = phoneRef.current?.value || phone;
    onSave({ name: parsedName, patronymic, birthDate: finalBirthDate, phone: finalPhone, procedure: procedures[0], procedures, date, time, notes, aiPrep });
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
      <div className="bg-surface-raised w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-elevated p-5 space-y-4 animate-fade-in max-h-[92vh] overflow-y-scroll safe-bottom">
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
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">
              ПІБ пацієнта *
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
              onBlur={() => setShowSuggestions(false)}
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

          {/* Birth Date + Phone — simple native inputs */}
          <div style={{display:'flex',gap:'12px'}}>
            <div style={{flex:1}}>
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                Дата народження
              </label>
              <input
                id="newentry-birthdate"
                ref={birthDateRef}
                type="text"
                defaultValue=""
                placeholder="ДД.ММ.РРРР"
                maxLength={10}
                style={{width:'100%',padding:'10px 12px',fontSize:'14px',fontWeight:'bold',borderRadius:'8px',border:'1px solid hsl(220,12%,90%)',outline:'none',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}
              />
            </div>
            <div style={{flex:1}}>
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                <Phone size={10} className="inline mr-1 -mt-0.5" />
                Телефон
              </label>
              <input
                id="newentry-phone"
                ref={phoneRef}
                type="text"
                defaultValue="+380"
                placeholder="+380"
                style={{width:'100%',padding:'10px 12px',fontSize:'14px',borderRadius:'8px',border:'1px solid hsl(220,12%,90%)',outline:'none',fontFamily:'inherit'}}
              />
            </div>
          </div>

          {/* Procedure — fullscreen selector */}
          <div>
            <button
              type="button"
              onClick={() => setShowProcedureSelector(true)}
              className="w-full text-left"
            >
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                {procedures.length > 0 ? "Змінити послуги" : "Обрати послуги"} *
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
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">Дата та час</label>
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
