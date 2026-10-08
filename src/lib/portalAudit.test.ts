import { describe, expect, it } from "vitest";
import { scrubAuditData } from "./portalAudit";

describe("audit scrubbing", () => {
  it("drops secret-looking keys at any depth", () => {
    const out = scrubAuditData({
      role: "buyer",
      password: "x",
      nested: { tempPassword: "y", activationUrl: "z", token: "t", ok: 1 },
      list: [{ passwordHash: "h", name: "a" }],
      companyCode: "HT-1",
    });
    expect(out).toEqual({ role: "buyer", nested: { ok: 1 }, list: [{ name: "a" }] });
  });
});
