import type { ScheduleInsertRow } from "./types.ts";

export interface ScheduleInput {
  visitId: string;
  patientId: string;
  visitDate: string; // ISO: YYYY-MM-DD
  procedureGroup: "K" | "G";
  drugChoice: "fortrans" | "izyklin" | null;
}

// Returns the UTC instant for a given local Kyiv wall-clock time on a specific date.
// Uses Intl.DateTimeFormat probe to handle DST correctly (Europe/Kiev = UTC+2/UTC+3).
function kyivToUtc(dateIso: string, hour: number, minute = 0): Date {
  // Start with the naive UTC time (as if Kyiv were UTC)
  const naiveUtc = new Date(
    `${dateIso}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`
  );

  // Find what Kyiv wall-clock hour this UTC instant maps to
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kiev",
    hour: "2-digit",
    hour12: false,
  });
  const kyivHour = parseInt(formatter.format(naiveUtc), 10);

  // The offset: kyivHour = utcHour + offset_hours → offset_hours = kyivHour - utcHour
  // So to get UTC from local: utcMs = localMs - offset_hours * 3600000
  const offsetMs = (kyivHour - hour) * 3_600_000;
  return new Date(naiveUtc.getTime() - offsetMs);
}

function dayOffset(visitDate: string, daysBeforeVisit: number): string {
  const d = new Date(visitDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - daysBeforeVisit);
  return d.toISOString().slice(0, 10);
}

export function buildScheduleRows(input: ScheduleInput): ScheduleInsertRow[] {
  const { visitId, patientId, visitDate, procedureGroup } = input;
  const rows: ScheduleInsertRow[] = [];

  if (procedureGroup === "K") {
    rows.push({
      visit_id: visitId,
      patient_id: patientId,
      block_key: "block7K",
      scheduled_at: kyivToUtc(dayOffset(visitDate, 4), 8).toISOString(),
    });
    rows.push({
      visit_id: visitId,
      patient_id: patientId,
      block_key: "block8K",
      scheduled_at: kyivToUtc(dayOffset(visitDate, 3), 8).toISOString(),
    });
    rows.push({
      visit_id: visitId,
      patient_id: patientId,
      block_key: "block9K",
      scheduled_at: kyivToUtc(dayOffset(visitDate, 2), 8).toISOString(),
    });
    rows.push({
      visit_id: visitId,
      patient_id: patientId,
      block_key: "block10K",
      scheduled_at: kyivToUtc(dayOffset(visitDate, 1), 8).toISOString(),
    });
    rows.push({
      visit_id: visitId,
      patient_id: patientId,
      block_key: "block11K",
      scheduled_at: kyivToUtc(visitDate, 4).toISOString(),
    });
  }

  if (procedureGroup === "G") {
    rows.push({
      visit_id: visitId,
      patient_id: patientId,
      block_key: "block12G_day_before",
      scheduled_at: kyivToUtc(dayOffset(visitDate, 1), 8).toISOString(),
    });
    rows.push({
      visit_id: visitId,
      patient_id: patientId,
      block_key: "block12G_morning",
      scheduled_at: kyivToUtc(visitDate, 8).toISOString(),
    });
  }

  return rows;
}
