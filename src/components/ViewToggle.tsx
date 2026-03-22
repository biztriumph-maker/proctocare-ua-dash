import { cn } from "@/lib/utils";

interface ViewToggleProps {
  activeView: "operational" | "calendar";
  onViewChange: (view: "operational" | "calendar") => void;
}

export function ViewToggle({ activeView, onViewChange }: ViewToggleProps) {
  return (
    <div className="flex rounded-lg bg-surface-sunken p-0.5 gap-0.5">
      <button
        onClick={() => onViewChange("operational")}
        className={cn(
          "flex-1 py-2 px-3 rounded-md text-xs font-medium transition-all duration-200",
          "active:scale-[0.97]",
          activeView === "operational"
            ? "bg-surface-raised shadow-card text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        🩺 Оперативка
      </button>
      <button
        onClick={() => onViewChange("calendar")}
        className={cn(
          "flex-1 py-2 px-3 rounded-md text-xs font-medium transition-all duration-200",
          "active:scale-[0.97]",
          activeView === "calendar"
            ? "bg-surface-raised shadow-card text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        📅 Планування
      </button>
    </div>
  );
}
