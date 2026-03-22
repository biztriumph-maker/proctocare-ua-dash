import { cn } from "@/lib/utils";

interface ViewToggleProps {
  activeView: "operational" | "calendar";
  onViewChange: (view: "operational" | "calendar") => void;
}

export function ViewToggle({ activeView, onViewChange }: ViewToggleProps) {
  return (
    <div className="flex rounded-lg bg-surface-sunken p-0.5 gap-0.5 shadow-[0_0_0_1px_hsl(var(--border))]">
      <button
        onClick={() => onViewChange("operational")}
        className={cn(
          "flex-1 py-2 px-3 rounded-md text-xs font-semibold transition-all duration-200",
          "active:scale-[0.97]",
          activeView === "operational"
            ? "bg-surface-raised shadow-[0_1px_3px_hsl(220_12%_50%/0.2),0_1px_2px_hsl(220_12%_50%/0.12)] text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        🩺 Оперативка
      </button>
      <button
        onClick={() => onViewChange("calendar")}
        className={cn(
          "flex-1 py-2 px-3 rounded-md text-xs font-semibold transition-all duration-200",
          "active:scale-[0.97]",
          activeView === "calendar"
            ? "bg-surface-raised shadow-[0_1px_3px_hsl(220_12%_50%/0.2),0_1px_2px_hsl(220_12%_50%/0.12)] text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        📅 Планування
      </button>
    </div>
  );
}
