import { t } from "../copy";
import { formatDate, formatMoney } from "../lib/format";
import type { SalesOrder } from "./salesCore";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** HTML الفاتورة للطباعة (RTL، بسيط، A4). */
export function invoiceHtml(o: SalesOrder, customer: string, statusLabel: string): string {
  const rows = (o.items ?? [])
    .map(
      (i) =>
        `<tr><td>${esc(i.description)}</td><td class="n">${esc(String(Number(i.qty)))}</td><td class="n">${esc(formatMoney(Number(i.unitPrice)))}</td><td class="n">${esc(formatMoney(Number(i.total)))}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(o.orderNumber)}</title>
<style>
body{font-family:Tahoma,Arial,sans-serif;margin:32px;color:#111}
h1{font-size:22px;margin:0 0 4px}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin:16px 0;font-size:14px}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:14px}
th,td{border:1px solid #bbb;padding:8px;text-align:start}
th{background:#f2f2f2}
.n{text-align:end;font-variant-numeric:tabular-nums}
.sum{margin-top:12px;text-align:end;font-size:18px;font-weight:bold}
.foot{margin-top:32px;text-align:center;color:#555;font-size:13px}
@media print{body{margin:12mm}}
</style></head><body>
<h1>${esc(t("sales.print.company"))} — ${esc(t("sales.print.title"))}</h1>
<div class="meta">
<div>${esc(t("sales.print.number"))}: <b>${esc(o.orderNumber)}</b></div>
<div>${esc(t("sales.print.status"))}: ${esc(statusLabel)}</div>
<div>${esc(t("sales.print.to"))}: ${esc(customer)}</div>
<div>${esc(t("sales.print.date"))}: ${esc(formatDate(o.date))}</div>
<div></div>
<div>${esc(t("sales.print.due"))}: ${esc(o.dueDate ? formatDate(o.dueDate) : "—")}</div>
</div>
<table><thead><tr><th>${esc(t("sales.item.desc"))}</th><th>${esc(t("sales.item.qty"))}</th><th>${esc(t("sales.item.price"))}</th><th>${esc(t("sales.item.total"))}</th></tr></thead><tbody>${rows}</tbody></table>
<div class="sum">${esc(t("sales.total"))}: ${esc(formatMoney(Number(o.total)))}</div>
<div class="foot">${esc(t("sales.print.thanks"))}</div>
</body></html>`;
}

/** بيفتح نافذة الطباعة. بيرجّع false لو المتصفح منعها. */
export function printInvoice(o: SalesOrder, customer: string, statusLabel: string): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(invoiceHtml(o, customer, statusLabel));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
  return true;
}
