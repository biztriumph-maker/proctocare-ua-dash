import { useState, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  onSearch: (query: string) => void;
  className?: string;
}

export function SearchBar({ onSearch, className }: SearchBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const handleChange = (val: string) => {
    setQuery(val);
    onSearch(val);
  };

  const handleClose = () => {
    setQuery("");
    onSearch("");
    setExpanded(false);
  };

  return (
    <div className={cn("relative flex items-center", className)}>
      {expanded ? (
        <div className="flex items-center gap-1.5 bg-white rounded-full border border-border px-3 py-1.5 shadow-sm animate-fade-in">
          <Search size={14} className="text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Пошук пацієнта..."
            className="bg-transparent outline-none text-sm w-32 sm:w-48 text-foreground placeholder:text-muted-foreground"
          />
          <button onClick={handleClose} className="p-0.5 rounded-full hover:bg-accent active:scale-[0.9] transition-all">
            <X size={14} className="text-muted-foreground" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setExpanded(true)}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-white/80 border border-border/60 shadow-sm hover:shadow-md active:scale-[0.93] transition-all"
        >
          <Search size={16} className="text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
