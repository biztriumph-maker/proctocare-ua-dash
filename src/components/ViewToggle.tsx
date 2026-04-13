import { cn } from "@/lib/utils";

interface ViewToggleProps {
  activeView: "operational" | "calendar";
  onViewChange: (view: "operational" | "calendar") => void;
  disabledOperational?: boolean;
}

export function ViewToggle({ activeView, onViewChange, disabledOperational = false }: ViewToggleProps) {
  return (
    <div className="flex h-[50px] gap-2 bg-transparent border-0">
      <button
        onClick={() => { if (!disabledOperational) onViewChange("operational"); }}
        disabled={disabledOperational}
        title={disabledOperational ? "Пошук показує майбутній запис — Оперативка недоступна" : undefined}
        className={cn(
          "flex h-full flex-1 items-center justify-center px-5 rounded-[12px] border text-[18px] font-[500] tracking-[0.02em] transition-all duration-200",
          disabledOperational
            ? "opacity-40 cursor-not-allowed border-[#D1D5DB] bg-[#F3F4F6] text-[#374151]"
            : activeView === "operational"
              ? "border-[#003366] bg-[#003366] text-white shadow-[0_2px_8px_rgba(0,51,102,0.15)] active:scale-[0.97]"
              : "border-[#D1D5DB] bg-[#F3F4F6] text-[#374151] hover:border-[#C4CAD3] hover:bg-[#ECEFF3] active:scale-[0.97]"
        )}
      >
        🩺 Оперативка
      </button>
      <button
        onClick={() => onViewChange("calendar")}
        className={cn(
          "flex h-full flex-1 items-center justify-center px-5 rounded-[12px] border text-[18px] font-[500] tracking-[0.02em] transition-all duration-200 active:scale-[0.97]",
          activeView === "calendar"
            ? "border-[#003366] bg-[#003366] text-white shadow-[0_2px_8px_rgba(0,51,102,0.15)]"
            : "border-[#D1D5DB] bg-[#F3F4F6] text-[#374151] hover:border-[#C4CAD3] hover:bg-[#ECEFF3]"
        )}
      >
        📅 Планування
      </button>
    </div>
  );
}
