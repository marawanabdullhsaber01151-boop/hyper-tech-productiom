import { t } from "../copy";
/** تنسيقات الأرقام والتواريخ — أرقام لاتينية (0-9) ومنطقة القاهرة. */
const TZ = "Africa/Cairo";
const nf = new Intl.NumberFormat("en-US");
const dateFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const rtf = new Intl.RelativeTimeFormat("ar", { numeric: "auto" });

export const formatNumber = (n: number) => nf.format(n);
export const formatMoney = (n: number, currency = t("money.egp")) =>
  `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n)} ${currency}`;

const toDate = (d: Date | string | number) => (d instanceof Date ? d : new Date(d));

export function formatDate(d: Date | string | number): string {
  const x = toDate(d);
  return Number.isNaN(x.getTime()) ? "—" : dateFmt.format(x);
}
export function formatDateTime(d: Date | string | number): string {
  const x = toDate(d);
  return Number.isNaN(x.getTime()) ? "—" : `${dateFmt.format(x)} ${timeFmt.format(x)}`;
}

export function formatRelative(d: Date | string | number, now: number = Date.now()): string {
  const x = toDate(d).getTime();
  if (Number.isNaN(x)) return "—";
  const diff = (x - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return t("time.now");
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
    ["week", 604800],
    ["month", 2592000],
    ["year", 31536000],
  ];
  let unit: Intl.RelativeTimeFormatUnit = "minute";
  let size = 60;
  for (const [u, s] of units) {
    if (abs >= s) {
      unit = u;
      size = s;
    }
  }
  return rtf.format(Math.round(diff / size), unit).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660));
}
