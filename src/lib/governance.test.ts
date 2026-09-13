import { describe, expect, it } from "vitest";
import { createDelegationSchema } from "../db/schema/governance";
import { ACTION_REGISTRY } from "./actionRegistry";

describe("Governance rules", () => {
  it("rejects self delegation and a reversed time window", () => {
    expect(() =>
      createDelegationSchema.parse({
        grantorUserId: 7,
        delegateUserId: 7,
        actionKey: "sales.approve",
        scopeType: "company",
        startsAt: "2026-08-24T08:00:00.000Z",
        endsAt: "2026-08-24T07:00:00.000Z",
        reason: "اختبار",
      }),
    ).toThrow();
  });

  it("keeps action keys unique and non-empty", () => {
    const keys = ACTION_REGISTRY.map((action) => action.key);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => key.trim().length > 0)).toBe(true);
  });
});