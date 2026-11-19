/**
 * Plain-language region names, used everywhere a person reads them.
 * (The backend's short codes — NETC, SNFH, ET, RC — are not shown in the UI.)
 */
export const REGION_NAMES: Record<number, string> = {
  1: "Non-enhancing tumor core",
  2: "Edema (swelling)",
  3: "Enhancing tumor",
  4: "Resection cavity",
};

export const REGION_HINTS: Record<number, string> = {
  1: "Tumor tissue that does not light up after contrast; often dead (necrotic) tissue.",
  2: "Swelling around the tumor; bright on FLAIR scans.",
  3: "Active tumor that lights up after a contrast injection.",
  4: "The space left where tumor was removed by surgery.",
};

/** Labels 1–3 together, the study's main measure. */
export const TUMOR_AREA_NAME = "Whole tumor area";
export const TUMOR_AREA_HINT = "Non-enhancing core, edema and enhancing tumor together.";

export const regionName = (value: number | null | undefined) =>
  value === null || value === undefined || value === 0 ? "Background" : (REGION_NAMES[value] ?? `Region ${value}`);
