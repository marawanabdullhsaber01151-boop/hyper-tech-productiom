import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://hyper:hyper@localhost:5432/hyper_test";
});

import { getSettingDef, layerSetting, PORTAL_SETTING_DEFS, validateSettingWrite } from "./portalSettings";

const rows = (list: Array<[string, number | null, string, unknown]>) =>
  list.map(([scope, scopeId, key, value]) => ({ scope, scopeId, key, value }));

describe("portal settings", () => {
  it("every def has a valid default for its own schema and an Arabic label", () => {
    for (const d of PORTAL_SETTING_DEFS) {
      expect(d.schema.safeParse(d.default).success, d.key).toBe(true);
      expect(d.label).toMatch(/[؀-ۿ]/);
    }
  });
  it("layers member → company → global → default", () => {
    const r = rows([
      ["global", null, "ui.theme.accent", "green"],
      ["company", 7, "ui.theme.accent", "orange"],
      ["member", 11, "ui.theme.accent", "purple"],
    ]);
    expect(layerSetting("ui.theme.accent", r, { companyId: 7, memberId: 11 })).toBe("purple");
    expect(layerSetting("ui.theme.accent", r, { companyId: 7, memberId: 99 })).toBe("orange");
    expect(layerSetting("ui.theme.accent", r, { companyId: 8 })).toBe("green");
    expect(layerSetting("ui.theme.accent", [], { companyId: 8 })).toBe("blue");
  });
  it("ignores stored values that fail the schema, and layers not allowed for the key", () => {
    const bad = rows([["company", 7, "team.max_members", "lots"], ["global", null, "team.max_members", 25]]);
    expect(layerSetting("team.max_members", bad, { companyId: 7 })).toBe(25);
    const wrongScope = rows([["member", 5, "team.max_members", 99]]);
    expect(layerSetting("team.max_members", wrongScope, { companyId: 7, memberId: 5 })).toBe(10);
  });
  it("team.max_members defaults to 10 and join.mode to approval", () => {
    expect(layerSetting("team.max_members", [], {})).toBe(10);
    expect(layerSetting("join.mode", [], { companyId: 1 })).toBe("approval");
  });
  it("supports open-ended ui.v2.<page> flags", () => {
    expect(getSettingDef("ui.v2.portal-orders")).toBeTruthy();
    expect(getSettingDef("ui.v2.Bad Key")).toBeUndefined();
    expect(layerSetting("ui.v2.portal-orders", [], {})).toBe(false);
  });
  it("validates writes (scope, editor, value)", () => {
    expect(validateSettingWrite("join.mode", "company", "auto", "owner")).toBe("auto");
    expect(() => validateSettingWrite("join.mode", "company", "weird", "owner")).toThrow();
    expect(() => validateSettingWrite("team.max_members", "company", 20, "owner")).toThrow(); // staff only
    expect(() => validateSettingWrite("security.lockout.minutes", "company", 10, "staff")).toThrow(); // global only
    expect(() => validateSettingWrite("nope", "global", 1, "staff")).toThrow();
  });
  it("throws for an unknown key when layering", () => {
    expect(() => layerSetting("nope", [], {})).toThrow();
  });
});
