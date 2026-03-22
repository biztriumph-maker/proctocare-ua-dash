import { X, Mic } from "lucide-react";
import { useState } from "react";

interface NewEntryFormProps {
  prefillDate?: string;
  prefillTime?: string;
  onClose: () => void;
  onSave: (entry: { name: string; procedure: string; date: string; time: string; notes: string }) => void;
  bookedHours?: number[];
}

const HOURS = Array.from({ length: 10 }, (_, i) => i + 8);

export function NewEntryForm({ prefillDate, prefillTime, onClose, onSave, bookedHours = [8, 9, 11, 14, 16] }: NewEntryFormProps) {
  const [name, setName] = useState("");
  const [procedure, setProcedure] = useState("");
  const [date, setDate] = useState(prefillDate || new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(prefillTime || "");
  const [notes, setNotes] = useState("");

  const handleSave = () => {
    if (!name || !date || !time) return;
    onSave({ name, procedure, date, time, notes });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-foreground/20 backdrop-blur-sm animate-fade-in">
      <div className="bg-surface-raised w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-elevated p-6 space-y-5 animate-reveal-up max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">Новий запис</h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-accent active:scale-[0.95] transition-all">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Пацієнт</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Прізвище та ім'я"
              className="w-full px-3 py-2.5 rounded-lg border bg-background text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Процедура</label>
            <input
              value={procedure}
              onChange={(e) => setProcedure(e.target.value)}
              placeholder="Тип процедури"
              className="w-full px-3 py-2.5 rounded-lg border bg-background text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Дата</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Час</label>
              <select
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
              >
                <option value="">Обрати</option>
                {HOURS.map((h) => {
                  const val = `${String(h).padStart(2, "0")}:00`;
                  const booked = bookedHours.includes(h);
                  return (
                    <option key={h} value={val} disabled={booked}>
                      {val} {booked ? "● зайнято" : ""}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Нотатки</label>
            <div className="relative">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Додаткова інформація..."
                rows={3}
                className="w-full px-3 py-2.5 pr-10 rounded-lg border bg-background text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow resize-none"
              />
              <button className="absolute right-2 bottom-2 p-1.5 rounded-md text-primary hover:bg-primary/10 active:scale-[0.95] transition-all">
                <Mic size={18} />
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={!name || !date || !time}
          className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-semibold text-sm transition-all duration-200 hover:shadow-card-hover active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
        >
          Зберегти запис
        </button>
      </div>
    </div>
  );
}
