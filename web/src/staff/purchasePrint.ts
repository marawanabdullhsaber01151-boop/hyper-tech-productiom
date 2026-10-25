import { t } from "../copy";
import { formatDate, formatMoney, formatNumber } from "../lib/format";
import type { PoFull } from "./purchasingCore";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** HTML أمر الشراء للطباعة (RTL، A4). الأسعار بتظهر لو الدور بيشوفها. */
export function poHtml(o: PoFull, statusLabel: string): string {
  const prices = o.total !== undefined;
  const rows = o.items
    .map((i) => `<tr><td>${esc(i.description)}</td><td class="n">${esc(formatNumber(Number(i.qty)))} ${esc(i.unit ?? "")}</td>${prices ? `<td class="n">${esc(formatMoney(Number(i.unitPrice ?? 0)))}</td><td class="n">${esc(formatMoney(Number(i.qty) * Number(i.unitPrice ?? 0)))}</td>` : ""}</tr>`)
    .join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(o.poNumber)}</title>
<style>
body{font-family:Tahoma,Arial,sans-serif;margin:32px;color:#111}
h1{font-size:22px;margin:0 0 4px}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin:16px 0;font-size:14px}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:14px}
th,td{border:1px solid #bbb;padding:8px;text-align:start}th{background:#f2f2f2}.n{text-align:end;font-variant-numeric:tabular-nums}
.sum{margin-top:12px;text-align:end;font-size:18px;font-weight:bold}
.sign{margin-top:48px;display:flex;justify-content:space-between;font-size:13px;color:#555}
@media print{body{margin:12mm}}
</style></head><body>
<h1>${esc(t("sales.print.company"))} — ${esc(t("po.print.title"))}</h1>
<div class="meta">
<div>${esc(t("sales.print.number"))}: <b>${esc(o.poNumber)}</b></div>
<div>${esc(t("sales.print.status"))}: ${esc(statusLabel)}</div>
<div>${esc(t("po.print.supplier"))}: ${esc(o.supplierName ?? "—")}</div>
<div>${esc(t("sales.print.date"))}: ${esc(formatDate(o.createdAt))}</div>
<div>${esc(t("po.detail.expected"))}: ${esc(o.expectedDate ? formatDate(o.expectedDate) : "—")}</div>
<div>${esc(t("po.detail.created"))}: ${esc(o.createdByName ?? "—")}</div>
</div>
<table><thead><tr><th>${esc(t("po.item.name"))}</th><th>${esc(t("po.item.qty"))}</th>${prices ? `<th>${esc(t("po.item.price"))}</th><th>${esc(t("po.item.total"))}</th>` : ""}</tr></thead><tbody>${rows}</tbody></table>
${prices ? `<div class="sum">${esc(t("po.detail.total"))}: ${esc(formatMoney(Number(o.total)))}</div>` : ""}
${o.notes ? `<p>${esc(t("po.detail.notes"))}: ${esc(o.notes)}</p>` : ""}
<div class="sign"><span>${esc(t("po.print.sign"))}</span><span>${esc(t("po.print.supplier"))}</span></div>
</body></html>`;
}

export function printPo(o: PoFull, statusLabel: string): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(poHtml(o, statusLabel));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
  return true;
}
