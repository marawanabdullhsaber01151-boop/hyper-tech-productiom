import "../copy/eInvoice";
import "../copy/sales";
import { t } from "../copy";
import { formatDate, formatMoney, formatNumber } from "../lib/format";
import { qrSvg } from "../lib/qr";
import type { Invoice } from "./invoiceCore";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** HTML الفاتورة الرسمية للطباعة: بيانات الفاتورة المختومة (مش بيانات الأمر الحالية) + QR التحقق. */
export function officialInvoiceHtml(inv: Invoice, qr: string): string {
  const rows = inv.lines
    .map((l) => `<tr><td>${esc(l.description)}</td><td class="n">${esc(formatNumber(Number(l.qty)))}</td><td class="n">${esc(formatMoney(Number(l.unitPrice)))}</td><td class="n">${esc(formatMoney(Number(l.total)))}</td></tr>`)
    .join("");
  const vat = Number(inv.taxAmount) > 0 ? `<div class="vat">${esc(t("ei.p.vat", { r: Number(inv.taxRate) }))}: ${esc(formatMoney(Number(inv.taxAmount)))}</div>` : "";
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(inv.invoiceNumber)}</title>
<style>
body{font-family:Tahoma,Arial,sans-serif;margin:32px;color:#111}
h1{font-size:22px;margin:0 0 4px}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin:16px 0;font-size:14px}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:14px}
th,td{border:1px solid #bbb;padding:8px;text-align:start}
th{background:#f2f2f2}
.n{text-align:end;font-variant-numeric:tabular-nums}
.sum{margin-top:12px;text-align:end;font-size:18px;font-weight:bold}
.vat{text-align:end;font-size:13px;color:#444;margin-top:4px}
.verify{display:flex;gap:16px;align-items:center;margin-top:28px;border-top:1px solid #ccc;padding-top:16px;font-size:12px;color:#444}
.verify svg{flex:none}
.verify .u{word-break:break-all;direction:ltr;text-align:left}
.foot{margin-top:20px;text-align:center;color:#555;font-size:12px}
@media print{body{margin:12mm}}
</style></head><body>
<h1>${esc(t("ei.p.company"))} — ${esc(t("ei.p.title"))}</h1>
<div class="meta">
<div>${esc(t("ei.number"))}: <b>${esc(inv.invoiceNumber)}</b></div>
<div>${esc(t("ei.date"))}: ${esc(formatDate(inv.issueDate))}</div>
<div>${esc(t("ei.p.to"))}: ${esc(inv.customerName)}</div>
<div>${esc(t("ei.p.order"))}: ${esc(inv.orderNumber)}</div>
</div>
<table><thead><tr><th>${esc(t("sales.item.desc"))}</th><th>${esc(t("sales.item.qty"))}</th><th>${esc(t("sales.item.price"))}</th><th>${esc(t("sales.item.total"))}</th></tr></thead><tbody>${rows}</tbody></table>
<div class="sum">${esc(t("sales.total"))}: ${esc(formatMoney(Number(inv.total)))}</div>
${vat}
<div class="verify">${qr}<div><div>${esc(t("ei.p.verify"))}</div><div class="u">${esc(inv.verifyUrl)}</div><div>${esc(t("ei.p.seal"))}: <span dir="ltr">${esc(inv.seal.slice(0, 20))}</span></div></div></div>
<div class="foot">${esc(t("ei.p.note"))}</div>
</body></html>`;
}

/** بيفتح نافذة الطباعة. false لو المتصفح منعها. */
export async function printOfficialInvoice(inv: Invoice): Promise<boolean> {
  const w = window.open("", "_blank");
  if (!w) return false;
  const qr = await qrSvg(inv.verifyUrl, { size: 120 });
  w.document.open();
  w.document.write(officialInvoiceHtml(inv, qr));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
  return true;
}
