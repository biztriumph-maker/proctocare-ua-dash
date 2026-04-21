import { useState, useEffect } from "react";
import { Pencil, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { CountryPhoneInput } from "./CountryPhoneInput";
import { PatientAllergies } from "./PatientAllergies";
import type { HistoryEntry } from "./PatientCard";
import { normalizePhoneValue } from "@/lib/phoneCountry";

// ── Local helpers (mirrors PatientDetailView) ──

function calcAge(birthDate: string): { age: number | null; ageStr: string } {
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
        return { age, ageStr: `${age} ${s}` };
      }
    }
  }
  return { age: null, ageStr: "—" };
}

// ── Types ──

type HistoryList = Array<{ value: string; timestamp: string; date: string }>;

/** Subset of patient data shown in the Profile block. Extra fields on the object are silently ignored. */
export type ProfileData = {
  birthDate: string;
  phone: string;
  allergies: string;
  diagnosis: string;
  lastVisit: string;
  notes: string;
};

export interface PatientProfileProps {
  profile: ProfileData;
  lastVisitIsNoShow?: boolean;
  onFocusEdit: (field: string, value: string, history?: HistoryEntry[]) => void;
  onAllergyChange: (value: string) => void;
  onBirthDateChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  histories?: {
    phoneHistory?: HistoryList;
    birthDateHistory?: HistoryList;
    allergiesHistory?: HistoryList;
    diagnosisHistory?: HistoryList;
    notesHistory?: HistoryList;
  };
}

// ── PatientProfile ──

export function PatientProfile({
  profile,
  lastVisitIsNoShow = false,
  onFocusEdit,
  onAllergyChange,
  onBirthDateChange,
  onPhoneChange,
  histories = {},
}: PatientProfileProps) {
  const [localBirthDate, setLocalBirthDate] = useState(profile.birthDate || "");
  const [localPhone, setLocalPhone] = useState(normalizePhoneValue(profile.phone || ""));

  useEffect(() => {
    setLocalBirthDate(profile.birthDate || "");
  }, [profile.birthDate]);

  useEffect(() => {
    setLocalPhone(normalizePhoneValue(profile.phone || ""));
  }, [profile.phone]);

  const { ageStr } = calcAge(localBirthDate);

  return (
    <div className="px-4 pb-4 space-y-3">

      {/* Row 1: Дата народження + Вік */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-background rounded-xl border border-border/60 px-3 py-2.5">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Дата народження</p>
            <button
              onClick={() => onFocusEdit("birthDate", localBirthDate, histories.birthDateHistory)}
              className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-accent transition-all shrink-0"
            >
              <Pencil size={11} className="text-muted-foreground" />
            </button>
          </div>
          <input
            type="text"
            inputMode="numeric"
            value={localBirthDate}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d]/g, "").slice(0, 8);
              let f = raw;
              if (raw.length > 2) f = raw.slice(0, 2) + "." + raw.slice(2);
              if (raw.length > 4) f = raw.slice(0, 2) + "." + raw.slice(2, 4) + "." + raw.slice(4);
              setLocalBirthDate(f);
              onBirthDateChange(f);
            }}
            placeholder="ДД.ММ.РРРР"
            maxLength={10}
            className="w-full bg-transparent text-sm font-bold tabular-nums outline-none"
          />
        </div>
        <div className="bg-background rounded-xl border border-border/60 px-3 py-2.5">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1">Вік</p>
          <span className="text-sm font-bold text-foreground tabular-nums">{ageStr === "—" ? "—" : ageStr}</span>
        </div>
      </div>

      {/* Row 2: Телефон */}
      <div className="bg-background rounded-xl border border-border/60 px-3 py-2.5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Phone size={10} /> Телефон
          </p>
          <button
            onClick={() => onFocusEdit("phone", profile.phone, histories.phoneHistory)}
            className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-accent transition-all"
          >
            <Pencil size={11} className="text-muted-foreground" />
          </button>
        </div>
        <CountryPhoneInput
          value={localPhone}
          onChange={(nextValue) => {
            const normalized = normalizePhoneValue(nextValue);
            setLocalPhone(normalized);
            onPhoneChange(normalizePhoneValue(normalized));
          }}
          buttonClassName="py-2"
          inputClassName="py-2"
        />
      </div>

      {/* Row 3: Алергії */}
      <PatientAllergies allergies={profile.allergies} onAllergyChange={onAllergyChange} />

      {/* Row 4: Діагноз */}
      <div className="bg-background rounded-xl border border-border/60 px-3 py-2.5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Діагноз</p>
          <button
            onClick={() => onFocusEdit("diagnosis", profile.diagnosis, histories.diagnosisHistory)}
            className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-accent transition-all"
          >
            <Pencil size={11} className="text-muted-foreground" />
          </button>
        </div>
        <button
          onClick={() => onFocusEdit("diagnosis", profile.diagnosis, histories.diagnosisHistory)}
          className={cn("text-sm font-bold text-left w-full transition-colors", profile.diagnosis ? "text-foreground hover:text-primary" : "text-muted-foreground/40 italic")}
        >
          {profile.diagnosis || "Не встановлено"}
        </button>
      </div>

      {/* Row 5: Останній візит */}
      <div className={cn("rounded-xl border px-3 py-2.5", lastVisitIsNoShow ? "bg-status-risk-bg border-status-risk/45" : "bg-background border-border/60")}>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1">Останній візит</p>
        <span className={cn("text-sm font-bold", profile.lastVisit ? (lastVisitIsNoShow ? "text-status-risk" : "text-foreground") : "text-muted-foreground/40 italic")}>
          {profile.lastVisit
            ? (lastVisitIsNoShow ? `${profile.lastVisit} (Не з'явився)` : profile.lastVisit)
            : "Перший прийом"}
        </span>
      </div>

      {/* Row 6: Нотатки */}
      <div className="bg-background rounded-xl border border-border/60 px-3 py-2.5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Нотатки</p>
          <button
            onClick={() => onFocusEdit("notes", profile.notes, histories.notesHistory)}
            className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-accent transition-all"
          >
            <Pencil size={11} className="text-muted-foreground" />
          </button>
        </div>
        <button
          onClick={() => onFocusEdit("notes", profile.notes, histories.notesHistory)}
          className={cn("text-sm text-left w-full leading-relaxed transition-colors whitespace-pre-wrap", profile.notes ? "font-bold text-foreground hover:text-primary" : "italic text-muted-foreground/40")}
        >
          {profile.notes || "Додайте нотатки про пацієнта"}
        </button>
      </div>

    </div>
  );
}
