import { describe, expect, it } from "vitest";
import {
  normalizeCompanyName,
  normalizeEmail,
  normalizePhone,
  normalizePortalIdentifier,
} from "./identityNormalization";

describe("identity normalization", () => {
  it("normalizes Egyptian phone formatting and digit variants to one key", () => {
    const expected = "+201012345678";

    expect(normalizePhone("010 123 45678")).toBe(expected);
    expect(normalizePhone("+20 (10) 1234-5678")).toBe(expected);
    expect(normalizePhone("0020-10-1234-5678")).toBe(expected);
    expect(normalizePhone("٠١٠ ١٢٣ ٤٥٦٧٨")).toBe(expected);
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone("----")).toBe("");
  });

  it("normalizes email case and surrounding whitespace", () => {
    expect(normalizeEmail("  Customer@Example.COM  ")).toBe(
      "customer@example.com",
    );
    expect(normalizeEmail("")).toBe("");
    expect(normalizeEmail(null)).toBe("");
  });

  it("normalizes company whitespace and comparison case", () => {
    expect(normalizeCompanyName("  ACME   Trading  ")).toBe("acme trading");
    expect(normalizeCompanyName("")).toBe("");
    expect(normalizeCompanyName(undefined)).toBe("");
  });

  it("uses the same canonical identifier for login variants", () => {
    expect(normalizePortalIdentifier("  +20 10 1234 5678 ")).toEqual({
      channel: "phone",
      value: "+201012345678",
    });
    expect(normalizePortalIdentifier(" Customer@Example.COM ")).toEqual({
      channel: "email",
      value: "customer@example.com",
    });
  });
});