/** @format */
/**
 * Plan 06 — pure helpers for join applications: Arabic-aware name matching,
 * duplicate detection, completeness score and SLA badge. No DB access here.
 */
import { normalizeEmail, normalizePhone } from "./identityNormalization";

const RAW_STOP_WORDS = [
  "شركة", "شركه", "مؤسسة", "مؤسسه", "مصنع", "مكتب", "للتجارة", "لتجارة", "والتوريدات",
  "للتوريدات", "وشركاه", "وشركاؤه", "جروب", "group", "co", "company", "ltd", "llc", "for", "trading",
  "ال",
];

function foldArabic(input: string): string {
  return input
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}
const STOP_WORDS = new Set(RAW_STOP_WORDS.map((w) => foldArabic(w)));

/** Arabic-friendly normalization: no diacritics, unified alef/ya/ta marbuta, no stop words. */
export function normalizeArabicName(input: string | null | undefined): string {
  const base = (input ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return base
    .split(" ")
    .map((w) => (w.length > 3 && w.startsWith("ال") ? w.slice(2) : w))
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(" ");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** 0..1 — 1 means the same name after normalization. */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const x = normalizeArabicName(a);
  const y = normalizeArabicName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const direct = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
  const xs = new Set(x.split(" "));
  const ys = new Set(y.split(" "));
  const shared = [...xs].filter((w) => ys.has(w)).length;
  const tokens = shared / Math.max(xs.size, ys.size);
  return Math.max(direct, tokens * 0.9);
}

export type MatchReason = "phone" | "email" | "name";
export type MatchConfidence = "high" | "medium" | "low";

export type MatchCandidate = {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
};

export type MatchResult = {
  reasons: MatchReason[];
  confidence: MatchConfidence;
  score: number;
  nameSimilarity: number;
};

const NAME_MATCH_THRESHOLD = 0.8;

/** Compares an application with one existing record. Returns null if nothing matches. */
export function matchRecord(
  app: { phone: string; email?: string | null; companyName: string },
  other: MatchCandidate,
): MatchResult | null {
  const reasons: MatchReason[] = [];
  const phoneA = normalizePhone(app.phone);
  const phoneB = normalizePhone(other.phone);
  if (phoneA && phoneB && phoneA === phoneB) reasons.push("phone");
  const emailA = normalizeEmail(app.email);
  const emailB = normalizeEmail(other.email);
  if (emailA && emailB && emailA === emailB) reasons.push("email");
  const sim = nameSimilarity(app.companyName, other.name);
  if (sim >= NAME_MATCH_THRESHOLD) reasons.push("name");
  if (!reasons.length) return null;
  const score = (reasons.includes("phone") ? 50 : 0) + (reasons.includes("email") ? 30 : 0) + Math.round(sim * 20);
  const confidence: MatchConfidence =
    reasons.includes("phone") || (reasons.includes("email") && reasons.includes("name")) || sim === 1 ? "high"
    : reasons.length >= 2 || reasons.includes("email") ? "medium"
    : "low";
  return { reasons, confidence, score: Math.min(100, score), nameSimilarity: Number(sim.toFixed(2)) };
}

type CompletenessInput = {
  fullName?: string | null;
  companyName?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  email?: string | null;
  commercialRegisterNo?: string | null;
  taxId?: string | null;
  expectedMonthlyVolume?: string | null;
};

const WEIGHTS: Array<[keyof CompletenessInput, number]> = [
  ["fullName", 15], ["companyName", 15], ["phone", 15], ["address", 10], ["city", 10],
  ["email", 10], ["commercialRegisterNo", 10], ["taxId", 10], ["expectedMonthlyVolume", 5],
];

export function completenessScore(a: CompletenessInput): number {
  let total = 0;
  for (const [key, weight] of WEIGHTS) if ((a[key] ?? "").toString().trim()) total += weight;
  return total;
}

/** Fields that are empty — used to tell the customer what is still missing. */
export function missingFields(a: CompletenessInput): Array<keyof CompletenessInput> {
  return WEIGHTS.filter(([key]) => !(a[key] ?? "").toString().trim()).map(([key]) => key);
}

export type SlaState = "ok" | "warn" | "late" | "done";

export function slaState(
  createdAt: Date,
  stage: string,
  limits: { warnHours: number; lateHours: number },
  now: Date = new Date(),
): { state: SlaState; ageHours: number } {
  const ageHours = Math.max(0, (now.getTime() - createdAt.getTime()) / 3_600_000);
  if (["approved", "rejected", "duplicate_auto_closed"].includes(stage)) return { state: "done", ageHours };
  // waiting on the customer isn't the team's delay
  if (stage === "needs_info") return { state: "ok", ageHours };
  if (ageHours >= limits.lateHours) return { state: "late", ageHours };
  if (ageHours >= limits.warnHours) return { state: "warn", ageHours };
  return { state: "ok", ageHours };
}

/** Stage kept in step with the legacy `status` column. */
export function statusForStage(stage: string): "pending" | "needs_info" | "approved" | "rejected" {
  if (stage === "needs_info") return "needs_info";
  if (stage === "approved") return "approved";
  if (stage === "rejected" || stage === "duplicate_auto_closed") return "rejected";
  return "pending";
}
