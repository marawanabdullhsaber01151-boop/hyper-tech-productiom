import { ar, type CopyKey, type Msg, type Plural } from "./ar";

export type { CopyKey };
export type Params = Record<string, string | number>;

let overrides: Record<string, string> = {};
const rules = new Intl.PluralRules("ar");

/** نصوص بديلة جاية من الإعدادات (copy.overrides). */
export function setCopyOverrides(next: Record<string, string> | null | undefined) {
  overrides = next ?? {};
}

function fill(s: string, p?: Params): string {
  return p ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in p ? String(p[k]) : m)) : s;
}

function pick(m: Plural, n: number): string {
  if (n === 0 && m.zero !== undefined) return m.zero;
  return (m[rules.select(n) as keyof Plural] as string | undefined) ?? m.other;
}

/** الأرقام في النص بتفضل لاتينية (0-9) عشان تتطابق مع الجداول والأكواد. */
export function t(key: CopyKey, params?: Params): string {
  const o = overrides[key];
  if (o) return fill(o, params);
  const m: Msg = ar[key];
  if (typeof m === "string") return fill(m, params);
  const n = Number(params?.n ?? 0);
  return fill(pick(m, n), { n, ...params });
}

export { ar };
