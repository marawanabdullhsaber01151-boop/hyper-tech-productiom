/**
 * نفس خوارزمية السيرفر (src/lib/companyCode.ts): HT-XXXX-XXXX
 * 7 حروف + حرف فحص. بنفحص الغلطات في المتصفح قبل ما نبعت للسيرفر.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PREFIX = "HT";

function checkChar(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) sum += ALPHABET.indexOf(body[i]!) * (i + 3);
  return ALPHABET[sum % 32]!;
}

/** بيرجّع الشكل الخام (8 حروف) أو null لو الكود غلط. */
export function normalizeCompanyCode(input: string | null | undefined): string | null {
  let v = (input ?? "").toUpperCase().replace(/[\s\-_.]/g, "");
  if (v.startsWith(PREFIX) && v.length === 10) v = v.slice(2);
  v = v.replace(/O/g, "0").replace(/[IL]/g, "1").replace(/U/g, "V");
  if (v.length !== 8) return null;
  for (const ch of v) if (!ALPHABET.includes(ch)) return null;
  return checkChar(v.slice(0, 7)) === v[7] ? v : null;
}

export const formatCompanyCode = (raw: string) => `${PREFIX}-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;

/** تنسيق أثناء الكتابة: HT-XXXX-XXXX من غير ما يعتبره غلط قبل ما يكتمل. */
export function formatPartialCode(input: string): string {
  const up = input.toUpperCase();
  let v = up.replace(/[^0-9A-Z]/g, "");
  // البادئة بتتشال لو مكتوبة صريح (HT- / HT ) أو لو الطول بيزيد عن 8
  if (v.startsWith(PREFIX) && (/^HT[\s\-_.]/.test(up) || v.length > 8)) v = v.slice(2);
  v = v.slice(0, 8);
  if (!v) return "";
  return v.length > 4 ? `${PREFIX}-${v.slice(0, 4)}-${v.slice(4)}` : `${PREFIX}-${v}`;
}
