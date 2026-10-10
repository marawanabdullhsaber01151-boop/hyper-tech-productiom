import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {} }));
import { generateNumericCode, hashCode, hashToken, safeEqualHex } from "./authTokens";
import { makeRecoveryCode, normalizeRecoveryCode } from "./recoveryCodes";
import { fillTemplate, humanDuration } from "./channels/templates";
import { maskAddress } from "./channels/types";
import { setChannelAdapterOverride } from "./channels/registry";

beforeAll(() => {
  process.env.JWT_SECRET ??= "unit-test-secret-that-is-long-enough-123456";
});

describe("auth tokens & codes", () => {
  it("hashToken is deterministic sha256 hex, never the raw token", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("abc")).not.toContain("abc");
  });
  it("short codes are bound to the user and ignore spacing/case", () => {
    expect(hashCode(1, "1234-5678")).toBe(hashCode(1, "12345678"));
    expect(hashCode(1, "ab12")).toBe(hashCode(1, "AB12"));
    expect(hashCode(1, "12345678")).not.toBe(hashCode(2, "12345678"));
  });
  it("safeEqualHex compares in constant time and rejects bad input", () => {
    const h = hashCode(1, "x");
    expect(safeEqualHex(h, h)).toBe(true);
    expect(safeEqualHex(h, hashCode(1, "y"))).toBe(false);
    expect(safeEqualHex("", "")).toBe(false);
    expect(safeEqualHex(h, "zz")).toBe(false);
  });
  it("numeric codes have the requested length", () => {
    for (let i = 0; i < 50; i++) expect(generateNumericCode(8)).toMatch(/^\d{8}$/);
  });
  it("recovery codes look like XXXX-XXXX without ambiguous characters", () => {
    for (let i = 0; i < 100; i++) {
      const c = makeRecoveryCode();
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      expect(normalizeRecoveryCode(c.toLowerCase())).toBe(c.replace("-", ""));
    }
  });
});

describe("templates & masking", () => {
  it("fills placeholders and formats durations", () => {
    expect(fillTemplate("أهلاً {name} {x}", { name: "علي" })).toBe("أهلاً علي ");
    expect(humanDuration(1440)).toBe("24 ساعة");
    expect(humanDuration(2880)).toBe("2 أيام");
    expect(humanDuration(120)).toBe("2 ساعة");
    expect(humanDuration(10)).toBe("10 دقيقة");
  });
  it("masks destinations", () => {
    expect(maskAddress("email", "ahmed@example.com")).toBe("a***@example.com");
    expect(maskAddress("sms", "01012345678")).toBe("***678");
    expect(maskAddress("telegram", "123")).not.toContain("123");
  });
});

describe("safety nets", () => {
  it("adapter overrides are refused in production", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => setChannelAdapterOverride("email", null)).toThrow();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
  it("channel code never logs secrets, tokens, codes or message text", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) files.push(p);
      }
    };
    walk(join(__dirname, "channels"));
    files.push(join(__dirname, "authTokens.ts"), join(__dirname, "recoveryCodes.ts"), join(__dirname, "activationFlow.ts"), join(__dirname, "..", "routes", "portal-recovery.ts"));
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const calls = src.match(/logger\.\w+\([^;]*\);/gs) ?? [];
      for (const c of calls) expect(c).not.toMatch(/\b(token|code|password|text|message|url|raw|msg\.to|address)\b\s*[:,})]/i);
      expect(src).not.toMatch(/console\.(log|info|warn|error)/);
    }
  });
});
