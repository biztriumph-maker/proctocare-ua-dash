import { useState, type ReactNode } from "react";
import { X, Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProcedureCategory {
  title: string;
  items: string[];
}

export const PROCEDURE_CATALOG: ProcedureCategory[] = [
  {
    title: "Діагностичні процедури",
    items: [
      "Колоноскопія",
      "Колоноскопія (без мед сну) з біопсією + Гістологія",
      "Колоноскопія з медичним сном (2200 мед. сон)",
      "Гастроскопія",
      "Гастроскопія (без мед сну) з біопсією + Гістологія",
      "Гастроскопія з медичним сном (2200 мед. сон)",
      "Гастроскопія + колоноскопія з медичним сном (2700 мед. сон)",
      "Ректоскопія з використанням ендоскопу",
      "Ректо-сигмоскопія з використанням ендоскопу",
      "Консультація ендоскопіста без проведення процедури",
    ],
  },
  {
    title: "Біопсія та дослідження",
    items: [
      "Взяття біопсії одноразовими щипцями",
      "Ректоскопія з використанням ендоскопу + Біопсія + Гістологія",
      "Ректосигмоскопія з використанням ендоскопа + Біопсія + Гістологія",
      "Розширена біопсія при ректоскопії та гістологією",
      "Розширена біопсія при ректосигмоскопії та гістологією",
      "Розширена біопсія з колоноскопією та гістологією",
      "Гістологія H. Pylori",
      "Взяття біопсії методом OLGA/OLGIM + Helicobacter pylori",
    ],
  },
  {
    title: "Поліпектомія",
    items: [
      "Поліпектомія при колоноскопії 1 клас 1А",
      "Поліпектомія при колоноскопії 1 клас 1Б",
      "Поліпектомія при колоноскопії 2 клас 2А",
      "Поліпектомія при колоноскопії 2 клас 2Б",
      "Поліпектомія при колоноскопії 3 клас 3А",
      "Поліпектомія при колоноскопії 3 клас 3Б",
      "Поліпектомія при гастроскопії 1 клас",
      "Поліпектомія при гастроскопії 2 клас",
      "Поліпектомія при гастроскопії 3 клас",
    ],
  },
  {
    title: "Медичний сон",
    items: [
      "Медичний сон до 20хв.",
      "Медичний сон 20-30хв.",
      "Медичний сон при поліпектомії та розширеній біопсії (від 30 до 60хв)",
    ],
  },
];

interface ProcedureSelectorProps {
  selected: string[];
  onConfirm: (selected: string[]) => void;
  onClose: () => void;
}

function renderProcedureLabel(item: string): ReactNode {
  // Emphasize quoted phrase in UI, while keeping original item value unchanged.
  if (item.includes("(без мед сну)")) {
    const normalized = item.replace("(без мед сну)", "");
    return (
      <>
        {normalized.trim()} (
        <strong>"без медичного сну"</strong>
        )
      </>
    );
  }

  if (item.includes("(без медичного сну)")) {
    const normalized = item.replace("(без медичного сну)", "");
    return (
      <>
        {normalized.trim()} (
        <strong>"без медичного сну"</strong>
        )
      </>
    );
  }

  return item;
}

export function ProcedureSelector({ selected, onConfirm, onClose }: ProcedureSelectorProps) {
  const [checked, setChecked] = useState<string[]>(selected);

  const toggle = (item: string) => {
    setChecked((prev) =>
      prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]
    );
  };

  const [search, setSearch] = useState("");

  const filteredCatalog = PROCEDURE_CATALOG.map((cat) => ({
    ...cat,
    items: cat.items.filter((item) =>
      item.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter((cat) => cat.items.length > 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/30 backdrop-blur-sm animate-fade-in">
      <div className="bg-card w-full max-w-lg mx-4 rounded-2xl shadow-elevated flex flex-col" style={{ height: "90vh", maxHeight: "90vh" }}>
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-base font-bold text-foreground">Обрати процедури</h2>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors active:scale-[0.93]"
          >
            <X size={20} className="text-foreground" />
          </button>
        </div>

        {/* Search */}
        <div className="shrink-0 px-4 py-2.5 border-b border-border/50">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background border border-border">
            <Search size={14} className="text-muted-foreground shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Пошук послуги..."
              className="bg-transparent outline-none text-sm w-full text-foreground placeholder:text-muted-foreground/50"
            />
            {search && (
              <button onClick={() => setSearch("")} className="shrink-0">
                <X size={14} className="text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto">
          {filteredCatalog.map((cat) => (
            <div key={cat.title}>
              <div className="px-4 py-2.5 bg-muted/50 border-b border-border/40">
                <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
                  {cat.title}
                </h3>
              </div>
              {cat.items.map((item) => {
                const isChecked = checked.includes(item);
                return (
                  <button
                    key={item}
                    onClick={() => toggle(item)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left border-b border-border/30 transition-colors active:bg-accent/60",
                      isChecked ? "bg-primary/5" : "bg-background"
                    )}
                  >
                    <div
                      className={cn(
                        "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all",
                        isChecked
                          ? "bg-primary border-primary"
                          : "border-border bg-background"
                      )}
                    >
                      {isChecked && <Check size={13} className="text-primary-foreground" strokeWidth={3} />}
                    </div>
                    <span className={cn("text-sm", isChecked ? "font-bold text-foreground" : "text-foreground")}>
                      {renderProcedureLabel(item)}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Sticky confirm button */}
        <div className="shrink-0 p-4 bg-card border-t border-border shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
          <button
            onClick={() => onConfirm(checked)}
            className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-bold text-sm transition-all hover:bg-primary/90 active:scale-[0.97] shadow-sm"
          >
            Підтвердити ({checked.length})
          </button>
        </div>
      </div>
    </div>
  );
}
