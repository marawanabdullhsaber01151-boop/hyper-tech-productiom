import { normNum } from "./salesCore";

/** منطق المشتريات النقي (من غير شاشة). بيعكس قواعد السيرفر (`src/lib/purchasing.ts`) — السيرفر هو المرجع. */
export const PO_STATUSES = ["draft", "pending_approval", "approved", "sent", "partially_received", "received", "cancelled"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];
export const isPoStatus = (s: string): s is PoStatus => (PO_STATUSES as readonly string[]).includes(s);

export const PO_TONE: Record<PoStatus, "neutral" | "info" | "brand" | "success" | "warn" | "danger"> = {
  draft: "neutral",
  pending_approval: "warn",
  approved: "info",
  sent: "brand",
  partially_received: "warn",
  received: "success",
  cancelled: "danger",
};

export const PURCHASE_ROLES = ["chairman", "purchasing_manager", "buyer", "warehouse_manager", "storekeeper"] as const;
export const BUYER_ROLES = ["chairman", "purchasing_manager", "buyer"] as const;
export const RECEIVE_ROLES = ["chairman", "warehouse_manager", "storekeeper"] as const;
const APPROVERS = ["chairman", "purchasing_manager"];
export const isApprover = (role: string) => APPROVERS.includes(role);
export const canBuy = (role: string | undefined) => !!role && (BUYER_ROLES as readonly string[]).includes(role);
export const canReceive = (role: string | undefined) => !!role && (RECEIVE_ROLES as readonly string[]).includes(role);

export interface PoRow {
  id: number;
  poNumber: string;
  supplierId: number;
  supplierName: string | null;
  status: string;
  expectedDate: string | null;
  createdAt: string;
  itemsCount: number;
  orderedQty: string;
  receivedQty: string;
  total?: string;
}
export interface PoItem {
  id: number;
  inventoryItemId: number;
  description: string;
  unit: string | null;
  qty: string;
  receivedQty: string;
  unitPrice?: string;
  requisitionSource: string | null;
  requisitionId: number | null;
}
export interface PoFull extends Omit<PoRow, "itemsCount" | "orderedQty" | "receivedQty"> {
  notes: string | null;
  createdByName: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  cancelReason: string | null;
  updatedAt: string;
  items: PoItem[];
}
export interface Need {
  source: "ops" | "plan";
  id: number;
  number: string;
  inventoryItemId: number | null;
  name: string;
  unit: string | null;
  qty: string;
  reason: string | null;
  supplierId: number | null;
  supplierName: string | null;
  createdAt: string;
  orderable: boolean;
}

/** الانتقالات اللي الدور ده يقدر يعملها من الحالة دي (نفس جدول السيرفر). */
export function allowedMoves(status: string, role: string): PoStatus[] {
  if (!isPoStatus(status)) return [];
  const table: Record<PoStatus, PoStatus[]> = {
    draft: ["pending_approval", "approved", "cancelled"],
    pending_approval: ["approved", "draft", "cancelled"],
    approved: ["sent", "cancelled"],
    sent: ["cancelled"],
    partially_received: [],
    received: [],
    cancelled: [],
  };
  return table[status].filter((to) => {
    if (to === "approved" || to === "draft") return isApprover(role);
    if (to === "cancelled" && status !== "draft") return isApprover(role);
    return true;
  });
}
/** الزر الأساسي: الخطوة الطبيعية الجاية. المعتمد بيعتمد مباشرة من المسودة. */
export function primaryMove(status: string, role: string): PoStatus | null {
  const m = allowedMoves(status, role);
  if (status === "draft") return m.includes("approved") ? "approved" : m.includes("pending_approval") ? "pending_approval" : null;
  if (status === "pending_approval") return m.includes("approved") ? "approved" : null;
  if (status === "approved") return m.includes("sent") ? "sent" : null;
  return null;
}
export const canEditOrder = (status: string, role: string) => status === "draft" && canBuy(role);
export const canReceiveOrder = (status: string, role: string) => canReceive(role) && (status === "approved" || status === "sent" || status === "partially_received");

export const remaining = (i: Pick<PoItem, "qty" | "receivedQty">): number => Math.max(0, Math.round((Number(i.qty) - Number(i.receivedQty)) * 1000) / 1000);

const todayStr = () => new Date().toISOString().slice(0, 10);
const OPEN = ["draft", "pending_approval", "approved", "sent", "partially_received"];
export const isOpen = (s: string) => OPEN.includes(s);
export function lateDays(o: Pick<PoRow, "status" | "expectedDate">, today = todayStr()): number {
  if (!o.expectedDate || !["approved", "sent", "partially_received"].includes(o.status) || o.expectedDate >= today) return 0;
  return Math.round((Date.parse(today) - Date.parse(o.expectedDate)) / 86400000);
}

export function poCounts(rows: PoRow[], today = todayStr()): { pending: number; open: number; late: number; openValue: number | null } {
  let pending = 0;
  let open = 0;
  let late = 0;
  let value = 0;
  let anyValue = false;
  for (const r of rows) {
    if (r.status === "pending_approval") pending += 1;
    if (isOpen(r.status)) {
      open += 1;
      if (r.total !== undefined) {
        anyValue = true;
        value += Number(r.total) || 0;
      }
    }
    if (lateDays(r, today) > 0) late += 1;
  }
  return { pending, open, late, openValue: anyValue ? Math.round(value * 100) / 100 : null };
}

/** الاحتياجات القابلة للطلب متجمّعة بالمورد المسجّل على الصنف (من غير مورد في مجموعة لوحدها). */
export function groupNeeds(needs: Need[]): Array<{ key: string; supplierId: number | null; supplierName: string | null; rows: Need[] }> {
  const map = new Map<string, { key: string; supplierId: number | null; supplierName: string | null; rows: Need[] }>();
  for (const n of needs) {
    if (!n.orderable || !n.inventoryItemId) continue;
    const key = n.supplierId ? String(n.supplierId) : "none";
    const g = map.get(key) ?? { key, supplierId: n.supplierId, supplierName: n.supplierName, rows: [] };
    g.rows.push(n);
    map.set(key, g);
  }
  // اللي ليه مورد الأول، ومن غير مورد في الآخر
  return [...map.values()].sort((a, b) => (a.supplierId ? 0 : 1) - (b.supplierId ? 0 : 1));
}

export interface DraftLine {
  inventoryItemId: string;
  qty: string;
  price: string;
  requisition?: { source: "ops" | "plan"; id: number; number: string };
}
export interface Draft {
  supplierId: string;
  expectedDate: string;
  notes: string;
  lines: DraftLine[];
}
/** نفس الاحتياج مرتين في نفس الأمر بيتجمع كبند واحد (نفس الصنف) — بنحتفظ بأول احتياج كمرجع. */
export function draftFromNeeds(rows: Need[]): DraftLine[] {
  return rows.map((n) => ({ inventoryItemId: String(n.inventoryItemId ?? ""), qty: String(Number(n.qty)), price: "", requisition: { source: n.source, id: n.id, number: n.number } }));
}

export type LineError = "pick" | "qty" | "price" | "dup";
const PRICE_RE = /^\d+(?:\.\d{1,2})?$/;
const QTY_RE = /^\d+(?:\.\d{1,3})?$/;
export interface DraftCheck {
  supplier: boolean;
  items: boolean;
  lines: Array<LineError | null>;
  ok: boolean;
}
/** السعر اختياري في المسودة (بيتطلب عند الإرسال للاعتماد) بس لو اتكتب لازم يكون صح. */
export function validateDraft(d: Draft): DraftCheck {
  const seen = new Set<string>();
  const lines = d.lines.map((l): LineError | null => {
    if (!l.inventoryItemId) return "pick";
    if (seen.has(l.inventoryItemId)) return "dup";
    seen.add(l.inventoryItemId);
    const q = normNum(l.qty);
    if (!QTY_RE.test(q) || !(Number(q) > 0)) return "qty";
    const p = normNum(l.price);
    if (p !== "" && !PRICE_RE.test(p)) return "price";
    return null;
  });
  const supplier = !d.supplierId;
  const items = d.lines.length === 0;
  return { supplier, items, lines, ok: !supplier && !items && lines.every((e) => e === null) };
}
export function toPayload(d: Draft) {
  return {
    supplierId: Number(d.supplierId),
    expectedDate: d.expectedDate || null,
    notes: d.notes.trim() || null,
    items: d.lines.map((l) => ({
      inventoryItemId: Number(l.inventoryItemId),
      qty: normNum(l.qty),
      unitPrice: normNum(l.price) || "0",
      ...(l.requisition ? { requisition: { source: l.requisition.source, id: l.requisition.id } } : {}),
    })),
  };
}
export function draftTotal(lines: DraftLine[]): number {
  return Math.round(lines.reduce((s, l) => s + (Number(normNum(l.qty)) || 0) * (Number(normNum(l.price)) || 0), 0) * 100) / 100;
}

export type ReceiptError = "qty" | "over" | "none";
/** تحقق من استلام: كل بند فاضي بيتجاهل، والكمية مش أكتر من المتبقي، ولازم بند واحد على الأقل. */
export function receiptCheck(items: Array<Pick<PoItem, "id" | "qty" | "receivedQty">>, input: Record<number, string>): { errors: Record<number, ReceiptError>; none: boolean; lines: Array<{ itemId: number; qty: string }> } {
  const errors: Record<number, ReceiptError> = {};
  const lines: Array<{ itemId: number; qty: string }> = [];
  for (const i of items) {
    const raw = normNum(input[i.id] ?? "");
    if (raw === "") continue;
    if (!QTY_RE.test(raw) || !(Number(raw) > 0)) {
      errors[i.id] = "qty";
      continue;
    }
    if (Number(raw) > remaining(i) + 1e-9) {
      errors[i.id] = "over";
      continue;
    }
    lines.push({ itemId: i.id, qty: raw });
  }
  return { errors, none: lines.length === 0 && Object.keys(errors).length === 0, lines };
}
