/** عرض الكمية بالكراتين والقطع (الخطوة 42ب). الكمية في النظام دايمًا بالقطع، والكرتونة مجرد طريقة عرض وإدخال. */
import { t } from "../copy";
import { formatNumber } from "./format";

export interface QtyBreakdown { cartons: number; loose: number; pieces: number; per: number }

/** من عدد القطع وعدد القطع في الكرتونة: كراتين كاملة + الباقي. من غير كرتونة صالحة أو الكمية أقل من كرتونة: null. */
export function qtyBreakdown(pieces: number, per: number | null | undefined): QtyBreakdown | null {
  const p = Number(per);
  if (!Number.isInteger(p) || p <= 1) return null;
  if (!Number.isFinite(pieces) || !Number.isInteger(pieces) || pieces < p) return null;
  return { cartons: Math.floor(pieces / p), loose: pieces % p, pieces, per: p };
}

/** «3 كرتونة (الكرتونة 12 قطعة)» أو «3 كرتونة + 5 قطعة (الكرتونة 12 قطعة)». */
export function breakdownText(b: QtyBreakdown): string {
  const vars = { n: formatNumber(b.cartons), loose: formatNumber(b.loose), per: formatNumber(b.per) };
  return t(b.loose === 0 ? "common.qty.cartons" : "common.qty.cartonsLoose", vars);
}

/** كراتين (عدد صحيح) ← قطع. */
export const cartonsToPieces = (cartons: number, per: number): number => cartons * per;
