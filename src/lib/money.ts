/** @format */
/**
 * حساب الفلوس بأرقام صحيحة (BigInt) — ممنوع `number` للمبالغ (معيار 2.4 #7).
 *
 * القواعد:
 *  - المبالغ والأسعار نصوص عشرية («1234.50»)، والكميات نصوص أو أرقام عشرية (حتى ٣ خانات في الجداول).
 *  - إجمالي السطر = الكمية × سعر الوحدة، يُقرَّب مرة واحدة لأقرب قرش (نصف لأعلى بعيدًا عن الصفر).
 *  - إجمالي الفاتورة = مجموع إجماليات السطور المقرَّبة، فلا يختلف أبدًا عن مجموع ما يراه العميل.
 */

const PRICE_DIGITS = 4; // numeric(.., 4) في قاعدة البيانات
const QTY_DIGITS = 6;
const PRICE_SCALE = 10n ** BigInt(PRICE_DIGITS);
const QTY_SCALE = 10n ** BigInt(QTY_DIGITS);

const PRICE_PATTERN = /^\d{1,12}(?:\.\d{1,4})?$/;
const QTY_PATTERN = /^\d{1,12}(?:\.\d{1,6})?$/;

/** نفس الشكل المقبول في المخطط (zod) — يُستخدم في حدود الإدخال لرفض «abc» و«-5» و«1e3». */
export const MONEY_INPUT_PATTERN = PRICE_PATTERN;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

function scaled(value: string | number, pattern: RegExp, digits: number, label: string): bigint {
  const text = String(value).trim();
  if (!pattern.test(text)) throw new MoneyError(`${label} غير صالح: ${text}`);
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0"));
}

/** يحوّل نص عشري إلى «قروش» (وحدة صغرى = 0.01). يرفض أي مدخل غير رقمي أو سالب أو بأكتر من ٤ خانات. */
export function toCents(amount: string | number): bigint {
  const fourDigits = scaled(amount, PRICE_PATTERN, PRICE_DIGITS, "المبلغ");
  return roundDiv(fourDigits, 100n);
}

/** قسمة بتقريب نصف لأعلى (للأرقام غير السالبة فقط، وهي كل ما نقبله). */
function roundDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

export function centsToString(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** إجمالي سطر بالقروش: الكمية × سعر الوحدة، مقرَّب مرة واحدة. */
export function lineTotalCents(qty: string | number, unitPrice: string | number): bigint {
  const q = scaled(qty, QTY_PATTERN, QTY_DIGITS, "الكمية");
  const p = scaled(unitPrice, PRICE_PATTERN, PRICE_DIGITS, "السعر");
  // الناتج بمقياس 10^(6+4)، المطلوب مقياس 10^2 ⇒ نقسم على 10^8
  return roundDiv(q * p, (QTY_SCALE * PRICE_SCALE) / 100n);
}

/** إجمالي سطر كنص «0.00». */
export function lineTotal(qty: string | number, unitPrice: string | number): string {
  return centsToString(lineTotalCents(qty, unitPrice));
}

/** مجموع قائمة مبالغ نصية. */
export function sumMoney(amounts: ReadonlyArray<string | number>): string {
  let total = 0n;
  for (const amount of amounts) total += toCents(amount);
  return centsToString(total);
}

export type PricedLine = { qty: string | number; unitPrice: string | number };

/** يحسب كل السطور ومجموعها بنفس القاعدة: المجموع = مجموع السطور المقرَّبة. */
export function priceLines<T extends PricedLine>(lines: ReadonlyArray<T>): {
  lines: Array<T & { total: string }>;
  subtotal: string;
} {
  let sum = 0n;
  const priced = lines.map((line) => {
    const cents = lineTotalCents(line.qty, line.unitPrice);
    sum += cents;
    return { ...line, total: centsToString(cents) };
  });
  return { lines: priced, subtotal: centsToString(sum) };
}
