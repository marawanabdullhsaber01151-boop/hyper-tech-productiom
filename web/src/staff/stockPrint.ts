import { t, type CopyKey } from "../copy";
import { formatDateTime, formatNumber } from "../lib/format";
import { reorderQty, stockValue, type Movement, type StockItem } from "./stockCore";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const n = (v: string | number) => formatNumber(Number(v) || 0);

export interface ItemReport {
  item: StockItem;
  supplier: string | null;
  leadDays: number | null;
  recipes: string[];
  moves: Movement[];
}

/** HTML تقرير الصنف للطباعة (RTL، A4). */
export function itemReportHtml(r: ItemReport): string {
  const { item } = r;
  const v = stockValue(item);
  const need = reorderQty(Number(item.qty), Number(item.minQty));
  const facts: Array<[string, string]> = [
    [t("inv.drawer.qty"), `${n(item.qty)} ${item.unit ?? ""}`],
    [t("inv.drawer.reserved"), n(item.reservedQty ?? 0)],
    [t("inv.drawer.avail"), n(item.availableQty)],
    [t("inv.drawer.min"), n(item.minQty)],
    [t("inv.drawer.supplier"), r.supplier ?? "—"],
    [t("inv.drawer.lead"), r.leadDays ? t("inv.drawer.lead.days", { n: r.leadDays }) : "—"],
  ];
  if (item.unitPrice !== undefined) facts.push([t("inv.drawer.price"), n(item.unitPrice)]);
  if (v !== null) facts.push([t("inv.drawer.value"), n(v)]);
  const rows = r.moves
    .slice(0, 15)
    .map((m) => `<tr><td>${esc(formatDateTime(m.createdAt))}</td><td>${esc(t(m.movementType === "in" ? "inv.mv.type.in" : "inv.mv.type.out"))}</td><td class="n">${esc(n(m.qty))}</td><td>${esc(m.notes ?? "")}</td></tr>`)
    .join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(item.name)}</title>
<style>
body{font-family:Tahoma,Arial,sans-serif;margin:32px;color:#111}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px;border-block-end:2px solid #999;padding-block-end:4px}
.sub{color:#555;font-size:13px}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin:14px 0;font-size:14px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #bbb;padding:6px 8px;text-align:start}th{background:#f2f2f2}
.n{text-align:end;font-variant-numeric:tabular-nums}.note{margin-top:10px;font-weight:bold}
@media print{body{margin:12mm}}
</style></head><body>
<h1>${esc(t("sales.print.company"))} — ${esc(t("inv.print.title"))}</h1>
<div class="sub">${esc(item.name)} · ${esc(item.code ?? "—")} · ${esc(t(`staff.stock.cat.${item.category}` as CopyKey))}</div>
<div class="facts">${facts.map(([k, val]) => `<div>${esc(k)}: <b>${esc(val)}</b></div>`).join("")}</div>
${need > 0 ? `<div class="note">${esc(r.supplier ? t("inv.reorder", { q: n(need), unit: item.unit ?? "", supplier: r.supplier }) : t("inv.reorder.nosup", { q: n(need), unit: item.unit ?? "" }))}</div>` : ""}
${r.recipes.length ? `<h2>${esc(t("inv.usage.bom"))}</h2><div>${r.recipes.map(esc).join(t("inv.sep"))}</div>` : ""}
<h2>${esc(t("inv.print.recent"))}</h2>
<table><thead><tr><th>${esc(t("inv.mv.col.date"))}</th><th>${esc(t("inv.mv.col.type"))}</th><th>${esc(t("inv.mv.col.qty"))}</th><th>${esc(t("inv.mv.col.notes"))}</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}

/** بيفتح نافذة الطباعة. بيرجّع false لو المتصفح منعها. */
export function printItemReport(r: ItemReport): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(itemReportHtml(r));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
  return true;
}
