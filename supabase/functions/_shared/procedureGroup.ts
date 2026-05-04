export type ProcedureGroup = "K" | "G";

export function classifyProcedureGroup(procedureName: string): ProcedureGroup | null {
  if (!procedureName) return null;
  const n = procedureName.toLowerCase();
  const hasColono =
    n.includes("колоноскоп") ||
    n.includes("ректоскоп") ||
    n.includes("ректо-сигмоскоп") ||
    n.includes("комплекс");
  const hasGastro = n.includes("гастроскоп");
  const hasPolyp = n.includes("поліпектом");
  if (hasColono) return "K";
  if (hasPolyp && hasGastro) return "G";
  if (hasPolyp) return "K";
  if (hasGastro) return "G";
  return null;
}
