import { useState, useEffect } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { AllergyShield } from "./PatientCard";
import { parseAllergyState, encodeAllergyState, type AllergyStatus } from "@/lib/allergyState";

interface PatientAllergiesProps {
  allergies: string;
  onAllergyChange: (newValue: string) => void;
}

export function PatientAllergies({ allergies, onAllergyChange }: PatientAllergiesProps) {
  const allergy = parseAllergyState(allergies);
  const [modalOpen, setModalOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState<AllergyStatus>(allergy.status);
  const [draftText, setDraftText] = useState(allergy.allergen);

  useEffect(() => {
    setDraftStatus(allergy.status);
    setDraftText(allergy.allergen);
  }, [allergy.status, allergy.allergen]);

  const handleOpen = () => {
    const parsed = parseAllergyState(allergies);
    setDraftStatus(parsed.status);
    setDraftText(parsed.allergen);
    setModalOpen(true);
  };

  const handleSave = () => {
    const storedValue = encodeAllergyState(draftStatus, draftText);
    onAllergyChange(storedValue);
    setModalOpen(false);
  };

  return (
    <>
      <div
        className={cn(
          "rounded-xl border px-3 py-2.5",
          allergy.status === "allergen"
            ? "bg-red-50 border-red-200"
            : allergy.status === "none"
              ? "bg-green-50 border-green-200"
              : "bg-slate-50 border-slate-200"
        )}
      >
        <div className="flex items-center justify-between mb-1">
          <p
            className={cn(
              "text-[10px] font-bold uppercase tracking-wide flex items-center gap-1",
              allergy.status === "allergen"
                ? "text-red-600"
                : allergy.status === "none"
                  ? "text-green-700"
                  : "text-slate-600"
            )}
          >
            {allergy.status === "allergen" && <AllergyShield size={12} />}
            Алергії
          </p>
          <button onClick={handleOpen} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/60 transition-all">
            <Pencil size={11} className={cn(allergy.status === "allergen" ? "text-red-600" : allergy.status === "none" ? "text-green-700" : "text-slate-500")} />
          </button>
        </div>
        <span
          className={cn(
            "text-sm font-bold",
            allergy.status === "allergen"
              ? "text-red-600"
              : allergy.status === "none"
                ? "text-green-700"
                : "text-slate-600"
          )}
        >
          {allergy.status === "allergen" ? allergy.allergen : allergy.status === "none" ? "Не виявлено" : "Не з'ясовано"}
        </span>
      </div>

      {modalOpen && (
        <AllergyStatusModal
          status={draftStatus}
          allergenText={draftText}
          onStatusChange={setDraftStatus}
          onAllergenTextChange={setDraftText}
          onCancel={() => setModalOpen(false)}
          onSave={handleSave}
        />
      )}
    </>
  );
}

function focusAtEnd(el: HTMLInputElement) {
  const len = el.value.length;
  el.selectionStart = len;
  el.selectionEnd = len;
}

function AllergyStatusModal({
  status,
  allergenText,
  onStatusChange,
  onAllergenTextChange,
  onCancel,
  onSave,
}: {
  status: AllergyStatus;
  allergenText: string;
  onStatusChange: (status: AllergyStatus) => void;
  onAllergenTextChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const canSave = status !== "allergen" || allergenText.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-fade-in" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl bg-card border border-border/60 shadow-elevated p-4 space-y-3 animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-foreground">Статус алергії</h3>

        <button
          type="button"
          onClick={() => onStatusChange("allergen")}
          className={cn(
            "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
            status === "allergen" ? "border-red-400 bg-red-50" : "border-border bg-background hover:bg-red-50/40"
          )}
        >
          <p className="text-sm font-bold text-red-600">🔴 Вказати алерген</p>
          <p className="text-xs text-red-500/80 mt-0.5">Вкажіть конкретну речовину або препарат</p>
        </button>

        {status === "allergen" && (
          <input
            type="text"
            value={allergenText}
            onChange={(e) => onAllergenTextChange(e.target.value)}
            onFocus={(e) => focusAtEnd(e.currentTarget)}
            placeholder="Наприклад: Пеніцилін"
            className="w-full rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700 outline-none focus:ring-2 focus:ring-red-200"
            autoFocus
          />
        )}

        <button
          type="button"
          onClick={() => onStatusChange("none")}
          className={cn(
            "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
            status === "none" ? "border-green-400 bg-green-50" : "border-border bg-background hover:bg-green-50/40"
          )}
        >
          <p className="text-sm font-bold text-green-700">✅ Не виявлено</p>
          <p className="text-xs text-green-700/80 mt-0.5">Алергії немає, перевірили</p>
        </button>

        <button
          type="button"
          onClick={() => onStatusChange("unknown")}
          className={cn(
            "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
            status === "unknown" ? "border-slate-400 bg-slate-100" : "border-border bg-background hover:bg-slate-100/60"
          )}
        >
          <p className="text-sm font-bold text-slate-700">⬜ Не з'ясовано</p>
          <p className="text-xs text-slate-600 mt-0.5">Ще не питали пацієнта</p>
        </button>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-bold text-muted-foreground border border-border rounded-lg hover:bg-muted/40 transition-colors">
            Скасувати
          </button>
          <button
            onClick={onSave}
            disabled={!canSave}
            className="px-4 py-2 text-sm font-bold text-primary-foreground bg-primary rounded-lg disabled:opacity-40"
          >
            Зберегти
          </button>
        </div>
      </div>
    </div>
  );
}
