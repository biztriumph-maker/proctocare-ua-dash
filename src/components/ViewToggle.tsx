import { cn } from "@/lib/utils";

interface ViewToggleProps {
  activeView: "operational" | "calendar";
  onViewChange: (view: "operational" | "calendar") => void;
  disabledOperational?: boolean;
}

export function ViewToggle({ activeView, onViewChange, disabledOperational = false }: ViewToggleProps) {
  return (
    <div className="flex rounded-xl bg-[#BAE6FD] p-1 gap-1">
      <button
        onClick={() => { if (!disabledOperational) onViewChange("operational"); }}
        disabled={disabledOperational}
        title={disabledOperational ? "Пошук показує майбутній запис — Оперативка недоступна" : undefined}
        className={cn(
          "flex-1 py-2.5 px-4 rounded-lg text-sm transition-all duration-200",
          disabledOperational
            ? "opacity-40 cursor-not-allowed"
            : activeView === "operational"
              ? "bg-white font-bold text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.12)] active:scale-[0.97]"
              : "font-medium text-foreground/60 hover:text-foreground/80 active:scale-[0.97]"
        )}
      >
        🩺 Оперативка
      </button>
      <button
        onClick={() => onViewChange("calendar")}
        className={cn(
          "flex-1 py-2.5 px-4 rounded-lg text-sm transition-all duration-200",
          "active:scale-[0.97]",
          activeView === "calendar"
            ? "bg-white font-bold text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
            : "font-medium text-foreground/60 hover:text-foreground/80"
        )}
      >
        📅 Планування
      </button>
    </div>
  );
}
