export type ClientExamPurpose =
  | "persiapan_ukai"
  | "persiapan_masuk_apoteker"
  | "lainnya";

export type StoredExamPurpose =
  | ClientExamPurpose
  | "ukai"
  | "cpns"
  | "pppk"
  | "other";

export const normalizeExamPurposeInput = (
  value: unknown,
): ClientExamPurpose | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "persiapan_ukai" || normalized === "ukai") {
    return "persiapan_ukai";
  }

  if (normalized === "persiapan_masuk_apoteker") {
    return "persiapan_masuk_apoteker";
  }

  if (
    normalized === "lainnya" ||
    normalized === "other" ||
    normalized === "cpns" ||
    normalized === "pppk"
  ) {
    return "lainnya";
  }

  return null;
};

export const mapStoredExamPurposeToClient = (
  value: unknown,
): ClientExamPurpose => normalizeExamPurposeInput(value) ?? "lainnya";

export const formatExamPurposeLabel = (value: unknown): string => {
  const normalized = mapStoredExamPurposeToClient(value);

  if (normalized === "persiapan_ukai") {
    return "Persiapan UKAI";
  }

  if (normalized === "persiapan_masuk_apoteker") {
    return "Persiapan Masuk Apoteker";
  }

  return "Lainnya";
};
