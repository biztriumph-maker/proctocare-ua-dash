import { cn } from "@/lib/utils";

interface ViewToggleProps {
  activeView: "operational" | "calendar";
  onViewChange: (view: "operational" | "calendar") => void;
}

export function ViewToggle({ activeView, onViewChange }: ViewToggleProps) {
  return (
    <div className="flex rounded-xl bg-[#F0F2F5] p-1 gap-1">
      <button
        onClick={() => onViewChange("operational")}
        className={cn(
          "flex-1 py-2.5 px-4 rounded-lg text-sm transition-all duration-200",
          "active:scale-[0.97]",
          activeView === "operational"
            ? "bg-white font-bold text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
            : "font-medium text-muted-foreground hover:text-foreground"
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
            ? "bg-white font-bold text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
            : "font-medium text-muted-foreground hover:text-foreground"
        )}
      >
        📅 Планування
      </button>
    </div>
  );
}
