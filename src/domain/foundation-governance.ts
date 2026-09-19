/** @format */
/**
 * Phase 03 (delivery 3) — governed master data. Pure domain logic only, no
 * database access, so every rule here can be exhaustively unit tested
 * without a PostgreSQL instance. The DB-aware counterpart lives in
 * ../lib/foundation-governance.ts.
 */
import { CRITICAL_FOUNDATION_ITEM_FIELDS } from "../db/schema/foundation";

export const FOUNDATION_ITEM_TRANSITIONS: Record<string, readonly string[]> =
  {
    draft: ["pending_approval", "retired"],
    pending_approval: ["active", "draft"],
    active: ["pending_approval", "superseded", "retired"],
    superseded: ["active", "retired"],
    retired: ["active"],
  };

export function isAllowedFoundationItemTransition(
  from: string,
  to: string,
): boolean {
  if (from === to) return true;
  return (FOUNDATION_ITEM_TRANSITIONS[from] ?? []).includes(to);
}

export function assertAllowedFoundationItemTransition(
  from: string,
  to: string,
): void {
  if (isAllowedFoundationItemTransition(from, to)) return;
  throw Object.assign(
    new Error(`لا يمكن تغيير حالة الصنف من "${from}" إلى "${to}"`),
    { status: 409, code: "INVALID_STATUS_TRANSITION" },
  );
}

/**
 * A "critical" change is one that changes how the item behaves in
 * inventory/production (unit of measure, item type, minimum stock) rather
 * than descriptive metadata (name, notes). Critical changes go through
 * request-change/approve/reject instead of a direct PATCH.
 */
export function isCriticalFoundationItemChange(
  changes: Record<string, unknown>,
): boolean {
  return CRITICAL_FOUNDATION_ITEM_FIELDS.some((field) => field in changes);
}

/**
 * Normalizes a name/code for duplicate-record detection: lowercases,
 * collapses internal whitespace, and strips characters that commonly vary
 * between otherwise-identical records (spaces around dashes, extra
 * punctuation) without altering the underlying letters/digits (Arabic
 * included — this must not strip Arabic letters).
 */
export function normalizeForDuplicateMatch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\-_/]+/g, " ")
    .replace(/[.,]/g, "")
    .trim();
}

export type ImportRow = Record<string, unknown>;

export type ImportRowResult =
  | { row: number; ok: true; code: string }
  | { row: number; ok: false; errors: string[] };

/**
 * Validates one import row against the same shape foundationItemSchema
 * expects, without touching zod's exception machinery (that happens in the
 * route, which needs the full schema instance). This pure pre-check exists
 * so obviously-bad rows (missing code, non-numeric minStock, wrong types)
 * can be reported with a 1-based row number instead of a generic zod path,
 * and so the "never partially apply a batch with any bad row" rule can be
 * enforced with a plain boolean scan before any database access.
 */
export function preValidateImportRow(
  row: ImportRow,
  index: number,
): ImportRowResult {
  const errors: string[] = [];
  const code = row.code;
  const name = row.name;
  const baseUnit = row.baseUnit;
  if (typeof code !== "string" || code.trim().length === 0) {
    errors.push("code مطلوب");
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    errors.push("name مطلوب");
  }
  if (typeof baseUnit !== "string" || baseUnit.trim().length === 0) {
    errors.push("baseUnit مطلوب");
  }
  if (
    row.minStock !== undefined &&
    row.minStock !== null &&
    !/^\d+(\.\d{1,3})?$/.test(String(row.minStock))
  ) {
    errors.push("minStock يجب أن يكون رقمًا صحيحًا");
  }
  if (errors.length > 0) {
    return { row: index + 1, ok: false, errors };
  }
  return { row: index + 1, ok: true, code: String(code).trim() };
}

export function summarizeImportRows(results: ImportRowResult[]): {
  totalRows: number;
  errorCount: number;
  okCount: number;
  canApply: boolean;
} {
  const errorCount = results.filter((r) => !r.ok).length;
  return {
    totalRows: results.length,
    errorCount,
    okCount: results.length - errorCount,
    // All-or-nothing: a batch with any invalid row can never be applied,
    // matching "never partially apply a batch" from the phase 03 brief.
    canApply: results.length > 0 && errorCount === 0,
  };
}
