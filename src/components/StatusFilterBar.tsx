import { cn } from "@/lib/utils";

export type FilterType = "all" | "ready" | "risk" | "attention";

interface FilterBadge {
  type: FilterType;
  label: string;
  count: number;
  colorClass: string;
  activeColorClass: string;
}

interface StatusFilterBarProps {
  activeFilter: FilterType;
  onFilterChange: (filter: FilterType) => void;
  counts: { total: number; ready: number; risk: number; attention: number };
}

export function StatusFilterBar({ activeFilter, onFilterChange, counts }: StatusFilterBarProps) {
  const badges: FilterBadge[] = [
    { type: "all", label: "Усього", count: counts.total, colorClass: "text-foreground", activeColorClass: "bg-foreground text-background" },
    { type: "ready", label: "Допущені", count: counts.ready, colorClass: "text-status-ready", activeColorClass: "bg-status-ready text-white" },
    { type: "risk", label: "Ризик", count: counts.risk, colorClass: "text-status-risk", activeColorClass: "bg-status-risk text-white" },
    { type: "attention", label: "Підготовка", count: counts.attention, colorClass: "text-status-progress", activeColorClass: "bg-status-progress text-white" },
  ];

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
      {badges.map((badge) => (
        <button
          key={badge.type}
          onClick={() => onFilterChange(badge.type === activeFilter ? "all" : badge.type)}
          className={cn(
            "flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-all duration-200",
            "active:scale-[0.96]",
            activeFilter === badge.type
              ? badge.activeColorClass
              : cn("bg-surface-raised shadow-card", badge.colorClass, "hover:shadow-card-hover")
          )}
        >
          {badge.label}
          <span className="tabular-nums">{badge.count}</span>
        </button>
      ))}
    </div>
  );
}
