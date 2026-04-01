import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRIES,
  buildPhoneValue,
  splitPhoneValue,
  type PhoneCountry,
} from "@/lib/phoneCountry";

interface CountryPhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  onValidityChange?: (isValid: boolean) => void;
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
  placeholder?: string;
  autoFocus?: boolean;
}

function normalizeLocalDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

function normalizeDialCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 4);
}

function prioritizeUkraine(countries: PhoneCountry[]): PhoneCountry[] {
  return [...countries].sort((a, b) => {
    if (a.iso2 === "UA" && b.iso2 !== "UA") return -1;
    if (b.iso2 === "UA" && a.iso2 !== "UA") return 1;
    return a.nameUk.localeCompare(b.nameUk, "uk");
  });
}

export function CountryPhoneInput({
  value,
  onChange,
  onValidityChange,
  className,
  inputClassName,
  buttonClassName,
  placeholder,
  autoFocus,
}: CountryPhoneInputProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [manualCode, setManualCode] = useState("");

  const parsed = useMemo(() => splitPhoneValue(value), [value]);
  const selectedCountry = parsed.country || DEFAULT_PHONE_COUNTRY;
  const nationalDigits = parsed.nationalDigits || "";
  const isValid = nationalDigits.length >= selectedCountry.minNationalLength && nationalDigits.length <= selectedCountry.maxNationalLength;

  useEffect(() => {
    setManualCode(selectedCountry.isManual ? selectedCountry.dialCode : "");
  }, [selectedCountry.dialCode, selectedCountry.isManual]);

  useEffect(() => {
    onValidityChange?.(isValid);
  }, [isValid, onValidityChange]);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filteredCountries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digitQuery = q.replace(/\D/g, "");
    if (!q) return prioritizeUkraine(PHONE_COUNTRIES);
    const matches = PHONE_COUNTRIES.filter((country) => {
      const name = country.nameUk.toLowerCase();
      const iso = country.iso2.toLowerCase();
      const byName = name.includes(q);
      const byIso = iso.includes(q);
      const byDial = digitQuery.length > 0 && country.dialCode.includes(digitQuery);
      return byName || byIso || byDial;
    });

    return matches.sort((a, b) => {
      if (a.iso2 === "UA" && b.iso2 !== "UA") return -1;
      if (b.iso2 === "UA" && a.iso2 !== "UA") return 1;

      const aName = a.nameUk.toLowerCase();
      const bName = b.nameUk.toLowerCase();
      const aExact = aName === q ? 0 : 1;
      const bExact = bName === q ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;

      const aStarts = aName.startsWith(q) ? 0 : 1;
      const bStarts = bName.startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;

      return aName.localeCompare(bName, "uk");
    });
  }, [search]);

  const applyCountry = (country: PhoneCountry) => {
    onChange(buildPhoneValue(country, nationalDigits));
    setIsOpen(false);
    setSearch("");
  };

  const applyManualCode = () => {
    const code = normalizeDialCode(manualCode);
    if (!code) return;
    onChange(`+${code}${nationalDigits}`);
    setIsOpen(false);
    setSearch("");
  };

  const handleInputChange = (raw: string) => {
    if (raw.trim().startsWith("+")) {
      const next = splitPhoneValue(raw);
      onChange(buildPhoneValue(next.country, next.nationalDigits));
      return;
    }

    const localDigits = normalizeLocalDigits(raw);
    onChange(buildPhoneValue(selectedCountry, localDigits));
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className={cn(
            "shrink-0 inline-flex items-center gap-1 rounded-lg border bg-background px-2.5 text-sm font-semibold text-foreground hover:border-primary/40 transition-colors",
            buttonClassName
          )}
          aria-label="Обрати країну"
        >
          <span>{selectedCountry.flag}</span>
          <span>+{selectedCountry.dialCode}</span>
          <ChevronDown size={14} className="text-muted-foreground" />
        </button>

        <input
          type="tel"
          value={nationalDigits}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder={placeholder || "Введіть номер"}
          autoFocus={autoFocus}
          className={cn(
            "w-full rounded-lg border bg-background px-3 py-2.5 text-sm font-medium outline-none transition-all focus:ring-2",
            isValid
              ? "text-foreground border-status-ready/40 focus:border-status-ready focus:ring-status-ready/20"
              : "text-status-risk border-status-risk/60 focus:border-status-risk focus:ring-status-risk/20",
            inputClassName
          )}
        />
      </div>

      {isOpen && (
        <div className="absolute z-[80] mt-2 w-full max-w-sm rounded-xl border bg-popover shadow-elevated overflow-hidden">
          <div className="p-2 border-b bg-background/60">
            <div className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-2">
              <Search size={14} className="text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Пошук країни"
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={manualCode}
                onChange={(e) => setManualCode(normalizeDialCode(e.target.value))}
                placeholder="Код вручну (напр. 999)"
                className="w-full rounded-lg border bg-background px-2.5 py-2 text-sm outline-none"
              />
              <button
                type="button"
                onClick={applyManualCode}
                disabled={!normalizeDialCode(manualCode)}
                className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-40"
              >
                Застосувати
              </button>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filteredCountries.map((country) => (
              <button
                key={`${country.iso2}-${country.dialCode}`}
                type="button"
                onClick={() => applyCountry(country)}
                className="w-full px-3 py-2 text-left hover:bg-accent/70 transition-colors flex items-center justify-between"
              >
                <span className="text-sm font-medium text-foreground">
                  {country.flag} {country.nameUk}
                </span>
                <span className="text-sm text-muted-foreground">+{country.dialCode}</span>
              </button>
            ))}
            {filteredCountries.length === 0 && (
              <div className="px-3 py-3 text-sm text-muted-foreground">Нічого не знайдено</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
