import { breakdownText, qtyBreakdown } from "../lib/qtyBreakdown";
import { formatNumber } from "../lib/format";

/** الكمية للموظف: القطع دايمًا، ولو الطلب عنده كرتونة بنزود تحتها «N كرتونة + M قطعة (الكرتونة X قطعة)». */
export function QtyCell({ qty, unit, per }: { qty: string | number | null; unit?: string; per?: number | null }) {
  const n = qty === null ? NaN : Number(qty);
  if (!Number.isFinite(n)) return <span>—</span>;
  const b = qtyBreakdown(n, per);
  return (
    <span class="st-qty">
      <span>{unit ? `${formatNumber(n)} ${unit}` : formatNumber(n)}</span>
      {b ? <small class="st-qty__carton">{breakdownText(b)}</small> : null}
    </span>
  );
}
