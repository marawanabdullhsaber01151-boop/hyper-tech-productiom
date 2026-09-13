const SCALE_DIGITS = 6;
const SCALE = 10n ** BigInt(SCALE_DIGITS);

const DECIMAL_PATTERN = /^[+-]?(?:\d+)(?:\.\d{1,6})?$/;

function toScaled(value: string | number): bigint {
  const text = String(value).trim();
  if (!DECIMAL_PATTERN.test(text)) {
    throw new Error(`Invalid decimal quantity: ${value}`);
  }

  const negative = text.startsWith("-");
  const unsigned = text.replace(/^[+-]/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const scaled = BigInt(whole) * SCALE + BigInt(fraction.padEnd(SCALE_DIGITS, "0"));
  return negative ? -scaled : scaled;
}

function fromScaled(value: bigint): string {
  if (value === 0n) return "0";

  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(SCALE_DIGITS, "0").replace(/0+$/, "");
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

function roundPositive(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

export function isDecimalQuantity(value: unknown): value is string | number {
  return (
    (typeof value === "string" || typeof value === "number") &&
    DECIMAL_PATTERN.test(String(value).trim())
  );
}

export function isPositiveDecimalQuantity(value: unknown): boolean {
  return isDecimalQuantity(value) && toScaled(value) > 0n;
}

export function isNonNegativeDecimalQuantity(value: unknown): boolean {
  return isDecimalQuantity(value) && toScaled(value) >= 0n;
}

export function compareDecimalQuantities(a: string | number, b: string | number): -1 | 0 | 1 {
  const left = toScaled(a);
  const right = toScaled(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function addDecimalQuantities(a: string | number, b: string | number): string {
  return fromScaled(toScaled(a) + toScaled(b));
}

export function subtractDecimalQuantities(a: string | number, b: string | number): string {
  return fromScaled(toScaled(a) - toScaled(b));
}

export function multiplyDecimalQuantities(a: string | number, b: string | number): string {
  return fromScaled(roundPositive(toScaled(a) * toScaled(b), SCALE));
}

export function divideDecimalQuantities(a: string | number, b: string | number): string {
  const divisor = toScaled(b);
  if (divisor === 0n) throw new Error("Cannot divide a quantity by zero");
  return fromScaled(roundPositive(toScaled(a) * SCALE, divisor));
}

export function maxZeroDecimalQuantity(value: string | number): string {
  return toScaled(value) > 0n ? fromScaled(toScaled(value)) : "0";
}

export function minDecimalQuantities(a: string | number, b: string | number): string {
  return fromScaled(toScaled(a) <= toScaled(b) ? toScaled(a) : toScaled(b));
}