import { useMemo } from "react";
import type { Patient, HistoryEntry } from "@/components/PatientCard";
import type { FileItem } from "@/components/PatientFiles";

// ── Local date utilities ──────────────────────────────────────────────────────

function getTodayIsoKyiv(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kiev" }).format(new Date());
}

function isoToDisplay(isoDate?: string, fallback?: string): string {
  const parts = isoDate?.split("-");
  if (parts?.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
  return fallback || isoDate || "";
}

function calcAge(birthDate: string): { age: number | null; ageStr: string } {
  const parts = birthDate.split(".");
  if (parts.length === 3 && parts[2].length === 4) {
    const bd = new Date(+parts[2], +parts[1] - 1, +parts[0]);
    if (!isNaN(bd.getTime())) {
      const today = new Date();
      let age = today.getFullYear() - bd.getFullYear();
      const m = today.getMonth() - bd.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
      if (age >= 0 && age < 150) {
        const ld = age % 10, lt = age % 100;
        const s = (lt >= 11 && lt <= 14) ? "років" : ld === 1 ? "рік" : (ld >= 2 && ld <= 4) ? "роки" : "років";
        return { age, ageStr: `${age} ${s}` };
      }
    }
  }
  return { age: null, ageStr: "—" };
}

function mergeUniqueHistoryEntries(
  primary: HistoryEntry[] | undefined,
  seeded: HistoryEntry[]
): HistoryEntry[] {
  const map = new Map<string, HistoryEntry>();
  for (const item of [...seeded, ...(primary || [])]) {
    map.set(`${item.date}|${item.value}`, item);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

const RESCHEDULED_MARKER = "__RESCHEDULED_TO__:";

function getInitialActiveProtocol(patient: Patient, activeVisitIso: string): string {
  const sameVisitEntry = (patient.protocolHistory || [])
    .filter((h) => h.date === activeVisitIso && !h.value.startsWith(RESCHEDULED_MARKER))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .at(-1);
  if (sameVisitEntry?.value?.trim()) return sameVisitEntry.value;
  if (typeof patient.protocol === "string" && patient.protocol.trim()) {
    return patient.protocol;
  }
  if (activeVisitIso > getTodayIsoKyiv()) return "";
  return patient.protocol || "";
}

// ── Public types ──────────────────────────────────────────────────────────────

/** Computed personal profile of the patient (read-only, derived from DB data). */
export type PatientProfileData = {
  name: string;
  patronymic: string;
  birthDate: string;
  age: string;
  ageNum: number | null;
  phone: string;
  allergies: string;
  diagnosis: string;
  notes: string;
  lastVisit: string;
};

/** Summary of a single past visit for history display and AI consumption. */
export type PastVisitSummary = {
  id: string;
  date: string;
  displayDate: string;
  time: string;
  services: string;
  outcome: "completed" | "no-show";
  protocol?: string;
  files: FileItem[];
};

/**
 * Single aggregated context object for a patient.
 * Designed to be the canonical data source for components and the AI Assistant.
 */
export type PatientContext = {
  /** Source-of-truth patient record from Supabase. */
  patient: Patient;

  /** Computed personal profile (read-only snapshot of DB fields). */
  profile: PatientProfileData;

  /** ISO date of the currently open visit (YYYY-MM-DD). */
  activeVisitIso: string;

  /** Human-readable date of the current visit (DD.MM.YYYY). */
  activeVisitDisplayDate: string;

  /** True when this is a completed visit from the past. */
  isCompletedPastVisit: boolean;

  /** True when this visit was marked as no-show and is in the past. */
  isNoShowPast: boolean;

  /**
   * True when visit-specific fields (notes, diagnosis, services, protocol)
   * should be shown empty — i.e., the visit is done and the card is ready for
   * the next appointment.
   */
  shouldClearVisitFields: boolean;

  /** Outcome of the currently viewed visit (undefined = not finished yet). */
  currentVisitOutcome: "completed" | "no-show" | undefined;

  /** All visits for this patient, sorted chronologically. */
  relatedVisits: Patient[];

  /** Completed and no-show visits before the current one, sorted DESC. */
  pastVisitSummaries: PastVisitSummary[];

  /** Unique past completed visit dates in DD.MM.YYYY format, sorted DESC. */
  completedPastVisitDates: string[];

  /** True when the patient has at least one completed past visit. */
  hasPastVisits: boolean;

  /** The most recent completed (non-no-show) visit before the current one. */
  lastCompletedVisit: Patient | undefined;

  /** Map of DD.MM.YYYY → outcome, used for archive badge rendering. */
  archivedVisitOutcomeByDate: Record<string, "completed" | "no-show">;

  /** Merged protocol history across the current and all related visits. */
  protocolHistory: HistoryEntry[];

  /** Merged procedure history across all related visits. */
  procedureHistory: HistoryEntry[];

  /** Files attached to the current visit. */
  currentFiles: FileItem[];

  /** Files from other completed past visits of this patient. */
  relatedFiles: FileItem[];

  /** All files (current + related), deduplicated and sorted DESC by date. */
  allFiles: FileItem[];

  // ── Initial field values ─────────────────────────────────────────────────
  // Respects shouldClearVisitFields: returns "" for completed/no-show past visits.
  initialPhone: string;
  initialAllergies: string;
  initialDiagnosis: string;
  initialNotes: string;
  initialProtocol: string;
  initialBirthDate: string;
  initialServices: string[];
};

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Aggregates all data for a patient into a single context object.
 *
 * Replaces scattered useMemo calls in PatientDetailView and provides a
 * canonical data source that can be passed directly to the AI Assistant.
 */
export function usePatientContext(patient: Patient, allPatients: Patient[] = []): PatientContext {
  const activeVisitIso = patient.date || getTodayIsoKyiv();
  const activeVisitDisplayDate = isoToDisplay(activeVisitIso);

  // All visits that belong to this patient, sorted chronologically.
  const relatedVisits = useMemo(() => {
    const filterFn = patient.patientDbId
      ? (p: Patient) => p.patientDbId === patient.patientDbId
      : (() => {
          const normalize = (v: Pick<Patient, "name" | "patronymic">) => {
            const compactName = (v.name || "").replace(/\s+/g, " ").trim().toLowerCase();
            const parts = compactName.split(" ").filter(Boolean);
            const surname = parts[0] || "";
            const firstName = parts[1] || "";
            const explicitPatronymic = (v.patronymic || "").replace(/\s+/g, " ").trim().toLowerCase();
            const parsedPatronymic = parts.length > 2 ? parts.slice(2).join(" ") : "";
            const patronymic = explicitPatronymic || parsedPatronymic;
            return `${surname}|${firstName}|${patronymic}`;
          };
          const key = normalize(patient);
          return (p: Patient) => normalize(p) === key;
        })();

    return allPatients
      .filter(filterFn)
      .filter((p) => !!p.date)
      .slice()
      .sort((a, b) => `${a.date || ""}${a.time || ""}`.localeCompare(`${b.date || ""}${b.time || ""}`));
  }, [allPatients, patient]);

  const lastCompletedVisit = useMemo(() => {
    return relatedVisits
      .filter((v) => (v.date || "") < activeVisitIso)
      .filter((v) => !v.noShow)
      .filter((v) => !!v.completed || v.status === "ready")
      .sort((a, b) =>
        `${b.date || ""}${b.time || ""}`.localeCompare(`${a.date || ""}${a.time || ""}`)
      )[0];
  }, [relatedVisits, activeVisitIso]);

  const completedPastVisitDates = useMemo(() => {
    const unique = new Set<string>();
    for (const visit of relatedVisits) {
      if (!visit.date || visit.date >= activeVisitIso) continue;
      if (visit.noShow) continue;
      if (!visit.completed && visit.status !== "ready") continue;
      unique.add(isoToDisplay(visit.date));
    }
    return Array.from(unique).sort((a, b) => {
      const parse = (s: string) => {
        const [d, m, y] = s.split(".");
        return new Date(+y, +m - 1, +d).getTime();
      };
      return parse(b) - parse(a);
    });
  }, [relatedVisits, activeVisitIso]);

  const archivedVisitOutcomeByDate = useMemo(() => {
    const map: Record<string, "completed" | "no-show"> = {};
    for (const visit of relatedVisits) {
      if (!visit.date || visit.date >= activeVisitIso) continue;
      const displayDate = isoToDisplay(visit.date);
      if (visit.noShow) {
        map[displayDate] = "no-show";
        continue;
      }
      if (visit.completed || visit.status === "ready" || visit.status === "completed") {
        if (!map[displayDate]) map[displayDate] = "completed";
      }
    }
    return map;
  }, [relatedVisits, activeVisitIso]);

  const todayIso = getTodayIsoKyiv();
  const isCompletedPastVisit =
    (patient.completed || patient.status === "ready") &&
    (!patient.date || patient.date <= todayIso);
  const isNoShowPast =
    !!patient.noShow && (!patient.date || patient.date <= todayIso);
  const shouldClearVisitFields = isCompletedPastVisit || isNoShowPast;

  const currentVisitOutcome: "completed" | "no-show" | undefined =
    patient.noShow && (!patient.date || patient.date <= todayIso)
      ? "no-show"
      : (patient.completed || patient.status === "ready" || patient.status === "completed") &&
          (!patient.date || patient.date <= todayIso)
        ? "completed"
        : undefined;

  // Collect protocols and files from other completed visits of this patient.
  const { relatedCompletedProtocols, relatedFiles } = useMemo(() => {
    const protocols: HistoryEntry[] = [];
    const files: FileItem[] = [];
    for (const v of relatedVisits) {
      if (v.id === patient.id) continue;
      if (!v.completed && v.status !== "ready") continue;
      // Pull in protocol history so the "Copy from last visit" button works.
      if (patient.fromForm || !patient.files?.length) {
        if (v.protocolHistory?.length) {
          protocols.push(...v.protocolHistory);
        } else if (v.protocol?.trim() && v.date) {
          protocols.push({
            value: v.protocol.trim(),
            timestamp: isoToDisplay(v.date),
            date: v.date,
          });
        }
      }
      if (v.files?.length) {
        files.push(...(v.files as FileItem[]));
      }
    }
    return { relatedCompletedProtocols: protocols, relatedFiles: files };
  }, [relatedVisits, patient.id, patient.fromForm, patient.files]);

  const protocolHistory = useMemo(
    () =>
      mergeUniqueHistoryEntries(
        [...(patient.protocolHistory || []), ...relatedCompletedProtocols],
        []
      ),
    [patient.protocolHistory, relatedCompletedProtocols]
  );

  const procedureHistory = useMemo(
    () => mergeUniqueHistoryEntries(patient.procedureHistory, []),
    [patient.procedureHistory]
  );

  const currentFiles = (patient.files || []) as FileItem[];

  const allFiles = useMemo(() => {
    const seen = new Set<string>();
    const result: FileItem[] = [];
    for (const f of [...currentFiles, ...relatedFiles]) {
      if (!seen.has(f.id)) {
        seen.add(f.id);
        result.push(f);
      }
    }
    return result.sort((a, b) => {
      const toIso = (d: string) => {
        const p = d.split(".");
        return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : d;
      };
      return toIso(b.date).localeCompare(toIso(a.date));
    });
  }, [currentFiles, relatedFiles]);

  const pastVisitSummaries = useMemo((): PastVisitSummary[] => {
    const seen = new Set<string>();
    const results: PastVisitSummary[] = [];
    for (const v of [...relatedVisits].reverse()) {
      if (!v.date || v.date >= activeVisitIso) continue;
      if (seen.has(v.date)) continue;
      if (!v.noShow && !v.completed && v.status !== "ready") continue;
      seen.add(v.date);
      const outcome: "completed" | "no-show" = v.noShow ? "no-show" : "completed";
      const protocol =
        (v.protocolHistory || [])
          .filter((h) => h.date === v.date)
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]?.value ||
        v.protocol ||
        "";
      results.push({
        id: v.id,
        date: v.date,
        displayDate: isoToDisplay(v.date),
        time: v.time || "",
        services: v.procedure || "",
        outcome,
        protocol: protocol || undefined,
        files: (v.files || []) as FileItem[],
      });
    }
    return results;
  }, [relatedVisits, activeVisitIso]);

  const { age: ageNum, ageStr: age } = calcAge(patient.birthDate || "");

  const profile: PatientProfileData = {
    name: patient.name || "",
    patronymic: patient.patronymic || "",
    birthDate: patient.birthDate || "",
    age,
    ageNum,
    phone: patient.phone || "",
    allergies: patient.allergies ?? "",
    diagnosis: patient.diagnosis || "",
    notes: patient.notes || patient.primaryNotes || "",
    lastVisit: patient.lastVisit || "",
  };

  // Initial field values — respect shouldClearVisitFields rule.
  const initialNotes = shouldClearVisitFields
    ? ""
    : (patient.notes ?? patient.primaryNotes ?? "");
  const initialProtocol = shouldClearVisitFields
    ? ""
    : getInitialActiveProtocol(patient, activeVisitIso);
  const initialPhone = patient.phone || "";
  const initialAllergies = patient.allergies ?? "";
  const initialDiagnosis =
    shouldClearVisitFields || patient.status === "planning"
      ? ""
      : (patient.diagnosis || "");
  const initialBirthDate = patient.birthDate || "";
  const initialServices = shouldClearVisitFields
    ? []
    : patient.procedure
      ? patient.procedure.split(", ")
      : [];

  return {
    patient,
    profile,
    activeVisitIso,
    activeVisitDisplayDate,
    isCompletedPastVisit,
    isNoShowPast,
    shouldClearVisitFields,
    currentVisitOutcome,
    relatedVisits,
    pastVisitSummaries,
    completedPastVisitDates,
    hasPastVisits: pastVisitSummaries.length > 0,
    lastCompletedVisit,
    archivedVisitOutcomeByDate,
    protocolHistory,
    procedureHistory,
    currentFiles,
    relatedFiles,
    allFiles,
    initialPhone,
    initialAllergies,
    initialDiagnosis,
    initialNotes,
    initialProtocol,
    initialBirthDate,
    initialServices,
  };
}
