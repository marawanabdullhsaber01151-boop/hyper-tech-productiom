/** @format */

const arabicIndicDigits = "٠١٢٣٤٥٦٧٨٩";
const easternArabicDigits = "۰۱۲۳۴۵۶۷۸۹";
const westernDigits = "0123456789";

function normalizeDigits(input: string): string {
  return input
    .normalize("NFKC")
    .replace(
      /[٠-٩]/g,
      (digit) => westernDigits[arabicIndicDigits.indexOf(digit)] ?? digit,
    )
    .replace(
      /[۰-۹]/g,
      (digit) => westernDigits[easternArabicDigits.indexOf(digit)] ?? digit,
    );
}

/**
 * Canonical phone format for this Egypt-based portal: E.164-style +20 for
 * Egyptian local numbers, while preserving an explicit international prefix.
 * Formatting characters and Arabic-Indic digits are removed/normalized.
 */
export function normalizePhone(input: string | null | undefined): string {
  const raw = normalizeDigits(input ?? "").trim();
  const hasPlus = /^\s*\+/.test(raw);
  const digits = raw.replace(/\D/g, "");

  if (!digits) return "";
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (hasPlus) return `+${digits}`;
  if (/^0\d{10}$/.test(digits)) return `+20${digits.slice(1)}`;
  if (/^20\d{10}$/.test(digits)) return `+${digits}`;
  return digits;
}

export function normalizeEmail(input: string | null | undefined): string {
  return (input ?? "").normalize("NFKC").trim().toLowerCase();
}

export function normalizeCompanyName(
  input: string | null | undefined,
): string {
  return (input ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

export function normalizePortalIdentifier(input: string): {
  channel: "phone" | "email";
  value: string;
} {
  const candidate = input.trim();
  return candidate.includes("@") ?
      { channel: "email", value: normalizeEmail(candidate) }
    : { channel: "phone", value: normalizePhone(candidate) };
}