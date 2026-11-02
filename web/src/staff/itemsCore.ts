import "../copy/foundation";
import { t, type CopyKey } from "../copy";

/**
 * منطق تبويب الأصناف (خطوة 35ب): قائمة، نموذج، طلب تغيير للحقول الحرجة، استيراد (JSON/CSV) وتصدير، تحويلات وحدات.
 * السيرفر هو الحَكَم (src/routes/foundation.ts). بدون واجهة عشان يتختبر لوحده.
 */

/** نفس APPROVAL_ROLES في السيرفر: اعتماد/رفض تغيير حرج. */
export const ITEM_APPROVAL_ROLES = ["chairman", "executive_manager", "operations_manager"] as const;
export const canApproveItem = (role: string) => (ITEM_APPROVAL_ROLES as readonly string[]).includes(role);

export const ITEM_TYPES = ["raw_material", "wip", "finished_good", "packaging", "consumable"] as const;
export const ITEM_STATUSES = ["draft", "pending_approval", "active", "superseded", "retired"] as const;
export const CRITICAL_FIELDS = ["baseUnit", "itemType", "minStock"] as const;
export type CriticalField = (typeof CRITICAL_FIELDS)[number];

export interface ItemRow {
  id: number; code: string; name: string; itemType: string; baseUnit: string; active: boolean; lotTracked: boolean; serialTracked: boolean;
  shelfLifeDays: number | null; minStock: string; notes: string | null; status: string; version: number;
  pendingChangePayload: Record<string, unknown> | null; pendingChangeReason: string | null; pendingChangeRequestedByName: string | null; pendingChangeRequestedAt: string | null;
}
export interface ItemVersion { id: number; version: number; changedByName: string | null; changedById: string | null; changeReason: string | null; createdAt: string }
export interface AliasRow { id: number; alias: string }
export interface ConversionRow { id: number; fromUnit: string; toUnit: string; factor: string }
export interface DuplicateGroups { byName: Array<{ names: string[]; codes: string[] }>; byCode: Array<{ item_ids: number[] }> }
export interface ImportPreview { totalRows: number; errorCount: number; okCount: number; canApply: boolean; results: Array<{ row: number; ok: boolean; code?: string; errors?: string[] }> }

export const itemStatusTone = (s: string): "success" | "warn" | "neutral" | "info" | "danger" =>
  s === "active" ? "success" : s === "pending_approval" ? "warn" : s === "draft" ? "info" : s === "retired" ? "neutral" : "neutral";

export interface ItemStats { total: number; active: number; pending: number; draft: number; retired: number }
export const itemStats = (rows: readonly ItemRow[]): ItemStats => ({
  total: rows.length, active: rows.filter((r) => r.status === "active").length, pending: rows.filter((r) => r.status === "pending_approval").length,
  draft: rows.filter((r) => r.status === "draft").length, retired: rows.filter((r) => r.status === "retired").length,
});

export type ItemStatusFilter = "all" | (typeof ITEM_STATUSES)[number];
export function filterItems(rows: readonly ItemRow[], search: string, status: ItemStatusFilter, type: string): ItemRow[] {
  const q = search.trim().toLowerCase();
  return rows.filter((r) => (status === "all" || r.status === status) && (!type || r.itemType === type) && (!q || `${r.code} ${r.name}`.toLowerCase().includes(q)));
}

/* ───────────── أرقام ───────────── */
export const normalizeNumber = (s: string) => s.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[٫,]/g, ".");
const MIN_STOCK = /^\d+(\.\d{1,3})?$/;

/* ───────────── نموذج الصنف ───────────── */
export interface ItemForm { code: string; name: string; itemType: string; baseUnit: string; lotTracked: boolean; serialTracked: boolean; shelfLifeDays: string; minStock: string; notes: string }
export const emptyItemForm = (): ItemForm => ({ code: "", name: "", itemType: "raw_material", baseUnit: "", lotTracked: true, serialTracked: false, shelfLifeDays: "", minStock: "0", notes: "" });
export const itemToForm = (r: ItemRow): ItemForm => ({ code: r.code, name: r.name, itemType: r.itemType, baseUnit: r.baseUnit, lotTracked: r.lotTracked, serialTracked: r.serialTracked, shelfLifeDays: r.shelfLifeDays ? String(r.shelfLifeDays) : "", minStock: r.minStock, notes: r.notes ?? "" });

export type ItemFormError = "code" | "name" | "unit" | "minStock" | "shelf" | null;
export function itemError(f: ItemForm): ItemFormError {
  if (!f.code.trim() || f.code.trim().length > 80) return "code";
  if (!f.name.trim() || f.name.trim().length > 160) return "name";
  if (!f.baseUnit.trim() || f.baseUnit.trim().length > 20) return "unit";
  if (!MIN_STOCK.test(normalizeNumber(f.minStock || "0"))) return "minStock";
  if (f.shelfLifeDays.trim() && !/^[1-9]\d{0,5}$/.test(normalizeNumber(f.shelfLifeDays))) return "shelf";
  return null;
}
export const itemPayload = (f: ItemForm) => ({
  code: f.code.trim(), name: f.name.trim(), itemType: f.itemType, baseUnit: f.baseUnit.trim(), lotTracked: f.lotTracked, serialTracked: f.serialTracked,
  shelfLifeDays: f.shelfLifeDays.trim() ? Number(normalizeNumber(f.shelfLifeDays)) : null, minStock: normalizeNumber(f.minStock || "0"), notes: f.notes.trim() || null,
});
export type ItemPayload = ReturnType<typeof itemPayload>;

/** الحقول اللي اتغيّرت فعلًا عن الصنف الحالي (قيم موحّدة عشان "0" و"0.000" ما يتحسبوش تغيير). */
export function changedFields(before: ItemRow, next: ItemPayload): Partial<ItemPayload> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(next) as Array<keyof ItemPayload>) {
    const a = key === "minStock" ? Number(before.minStock) : (before as unknown as Record<string, unknown>)[key];
    const b = key === "minStock" ? Number(next.minStock) : next[key];
    if ((a ?? null) !== (b ?? null)) out[key] = next[key];
  }
  return out as Partial<ItemPayload>;
}
export const criticalChanged = (changes: Partial<ItemPayload>): CriticalField[] => CRITICAL_FIELDS.filter((f) => f in changes);
/** صنف نشط + تغيير حرج = لازم طلب تغيير واعتماد (مش تعديل مباشر). */
export const needsChangeRequest = (item: Pick<ItemRow, "status">, changes: Partial<ItemPayload>) => item.status === "active" && criticalChanged(changes).length > 0;
export const hasChanges = (changes: Partial<ItemPayload>) => Object.keys(changes).length > 0;

export interface DiffRow { field: string; from: string; to: string }
/** مقارنة التغيير المعلّق بالقيم الحالية للعرض على المعتمِد. */
export function pendingDiff(item: ItemRow): DiffRow[] {
  const changes = item.pendingChangePayload ?? {};
  return Object.entries(changes).map(([field, to]) => ({ field, from: String((item as unknown as Record<string, unknown>)[field] ?? ""), to: String(to ?? "") })).filter((d) => d.from !== d.to);
}

/** كود الأمر: الأصناف الموقوفة/المتقاعدة بتتفعّل بـ PATCH active:true. */
export const canReactivate = (item: Pick<ItemRow, "status" | "active">) => !item.active && (item.status === "retired" || item.status === "draft");
export const canEditItem = (item: Pick<ItemRow, "status">) => item.status !== "pending_approval";

/* ───────────── تحويلات الوحدات ───────────── */
export interface ConversionForm { fromUnit: string; toUnit: string; factor: string }
export const conversionError = (f: ConversionForm): "from" | "to" | "same" | "factor" | null => {
  if (!f.fromUnit.trim()) return "from";
  if (!f.toUnit.trim()) return "to";
  if (f.fromUnit.trim() === f.toUnit.trim()) return "same";
  const n = normalizeNumber(f.factor);
  return /^\d+(\.\d{1,8})?$/.test(n) && Number(n) > 0 ? null : "factor";
};
export const conversionPayload = (f: ConversionForm) => ({ fromUnit: f.fromUnit.trim(), toUnit: f.toUnit.trim(), factor: normalizeNumber(f.factor) });

/* ───────────── استيراد (JSON أو CSV/جدول إكسل) ───────────── */
export const MAX_IMPORT_ROWS = 500;
/** أسماء الأعمدة المقبولة (إنجليزي + العربي من copy) والأنواع بالعربي. بتتبني وقت الاستعمال عشان النص يفضل في copy. */
function headerAliases(): Record<string, string> {
  return {
    code: "code", name: "name", baseunit: "baseUnit", unit: "baseUnit", itemtype: "itemType", type: "itemType", minstock: "minStock", notes: "notes",
    [t("fnd.it.hdr.code")]: "code", [t("fnd.it.hdr.name")]: "name", [t("fnd.it.hdr.unit")]: "baseUnit", [t("fnd.it.hdr.type")]: "itemType", [t("fnd.it.hdr.min")]: "minStock", [t("fnd.it.hdr.notes")]: "notes",
  };
}
function typeAliases(): Record<string, string> {
  return Object.fromEntries(ITEM_TYPES.map((x) => [t(`fnd.it.type.${x}` as CopyKey), x]));
}

/** قسم سطر CSV مع دعم علامات الاقتباس، والفاصل بيتحدد من أول سطر (تاب من إكسل، أو فاصلة، أو فاصلة منقوطة). */
export function splitDelimited(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = first.includes("\t") ? "\t" : (first.match(/;/g) ?? []).length > (first.match(/,/g) ?? []).length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const push = () => { row.push(cell); cell = ""; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) push();
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; push(); if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cell += c;
  }
  push();
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export type ParsedImport = { rows: Array<Record<string, unknown>>; error: "empty" | "json" | "headers" | "tooMany" | null };
export function parseImport(raw: string): ParsedImport {
  const text = raw.replace(/^﻿/, "").trim();
  if (!text) return { rows: [], error: "empty" };
  let rows: Array<Record<string, unknown>>;
  if (text.startsWith("[")) {
    try { const parsed: unknown = JSON.parse(text); if (!Array.isArray(parsed)) return { rows: [], error: "json" }; rows = parsed as Array<Record<string, unknown>>; } catch { return { rows: [], error: "json" }; }
  } else {
    const table = splitDelimited(text);
    const aliases = headerAliases();
    const types = typeAliases();
    const header = (table[0] ?? []).map((h) => aliases[h.trim().toLowerCase()] ?? aliases[h.trim()] ?? "");
    if (!header.includes("code") || !header.includes("name") || !header.includes("baseUnit")) return { rows: [], error: "headers" };
    rows = table.slice(1).map((cells) => {
      const r: Record<string, unknown> = {};
      header.forEach((key, i) => {
        const v = (cells[i] ?? "").trim();
        if (!key || !v) return;
        r[key] = key === "minStock" ? normalizeNumber(v) : key === "itemType" ? (types[v] ?? v) : v;
      });
      return r;
    });
  }
  if (!rows.length) return { rows: [], error: "empty" };
  if (rows.length > MAX_IMPORT_ROWS) return { rows: [], error: "tooMany" };
  return { rows, error: null };
}

/** ملف CSV للتصدير (بـBOM عشان إكسل يقرا العربي صح). */
export function exportCsv(rows: readonly ItemRow[]): string {
  const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n\r\t;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["code", "name", "itemType", "baseUnit", "minStock", "status", "version", "notes"];
  return `﻿${[head.join(","), ...rows.map((r) => [r.code, r.name, r.itemType, r.baseUnit, r.minStock, r.status, r.version, r.notes].map(esc).join(","))].join("\r\n")}`;
}
