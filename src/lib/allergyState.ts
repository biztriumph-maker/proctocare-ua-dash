export type AllergyStatus = "allergen" | "none" | "unknown";

export const ALLERGY_NONE_TOKEN = "__ALLERGY_NONE__";

export function parseAllergyState(value?: string | null): { status: AllergyStatus; allergen: string } {
  const raw = (value || "").trim();
  if (!raw) return { status: "unknown", allergen: "" };
  if (raw === ALLERGY_NONE_TOKEN) return { status: "none", allergen: "" };
  return { status: "allergen", allergen: raw };
}

export function encodeAllergyState(status: AllergyStatus, allergen?: string): string {
  if (status === "none") return ALLERGY_NONE_TOKEN;
  if (status === "unknown") return "";
  return (allergen || "").trim();
}

export function hasConfirmedAllergen(value?: string | null): boolean {
  return parseAllergyState(value).status === "allergen";
}

export function allergyStatusLabel(status: AllergyStatus): string {
  if (status === "none") return "Не виявлено";
  if (status === "unknown") return "Не з'ясовано";
  return "Вказати алерген";
}
