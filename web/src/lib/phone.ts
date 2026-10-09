/** موبايل مصري: يقبل 010.. / +2010.. / 002010.. / أرقام عربية، ويرجّع 01XXXXXXXXX. */
const AR_DIGITS = /[٠-٩۰-۹]/g;

export function toLatinDigits(s: string): string {
  return s.replace(AR_DIGITS, (c) => {
    const code = c.charCodeAt(0);
    return String(code >= 0x6f0 ? code - 0x6f0 : code - 0x660);
  });
}

export function normalizeEgyptPhone(input: string): string | null {
  let d = toLatinDigits(input).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("0020")) d = d.slice(4);
  else if (d.startsWith("20") && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith("1")) d = `0${d}`;
  return /^01[0125]\d{8}$/.test(d) ? d : null;
}

/** 01012345678 → 0101 234 5678 */
export function formatEgyptPhone(p: string): string {
  const n = normalizeEgyptPhone(p);
  return n ? `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}` : p;
}

export function whatsappLink(phone: string, text?: string): string | null {
  const n = normalizeEgyptPhone(phone);
  if (!n) return null;
  return `https://wa.me/2${n}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
