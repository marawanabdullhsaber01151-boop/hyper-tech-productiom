import { describe, expect, it } from "vitest";
import {
  PORTAL_PERMISSION_KEYS,
  PORTAL_PERMISSIONS,
  expandPermissions,
  resolveEffectivePermissions,
  sanitizePermissionList,
} from "./portalPermissions";

describe("portal permission registry", () => {
  it("has unique keys, Arabic labels and only valid implies", () => {
    expect(new Set(PORTAL_PERMISSION_KEYS).size).toBe(PORTAL_PERMISSION_KEYS.length);
    for (const p of PORTAL_PERMISSIONS) {
      expect(p.label).toMatch(/[؀-ۿ]/);
      for (const implied of p.implies ?? []) expect(PORTAL_PERMISSION_KEYS).toContain(implied);
    }
  });
  it("expands implied permissions transitively and drops unknown keys", () => {
    const e = expandPermissions(["orders.cancel_company", "nope.nothing"]);
    expect(e.has("orders.cancel_own")).toBe(true);
    expect(e.has("orders.view_company")).toBe(true);
    expect(e.has("orders.view_own")).toBe(true);
    expect(e.has("nope.nothing")).toBe(false);
    expect(expandPermissions(["team.manage"]).has("team.view")).toBe(true);
  });
  it("owner always has everything, regardless of role/overrides", () => {
    const eff = resolveEffectivePermissions({
      isOwner: true,
      rolePermissions: [],
      overrides: [{ permissionKey: "orders.create", effect: "deny" }],
    });
    expect(eff.size).toBe(PORTAL_PERMISSION_KEYS.length);
  });
  it("role ∪ allow − deny, with deny winning over implied grants", () => {
    const eff = resolveEffectivePermissions({
      isOwner: false,
      rolePermissions: ["orders.create"],
      overrides: [
        { permissionKey: "orders.view_company", effect: "allow" },
        { permissionKey: "cart.use", effect: "deny" },
      ],
    });
    expect(eff.has("orders.create")).toBe(true);
    expect(eff.has("orders.view_company")).toBe(true);
    expect(eff.has("cart.use")).toBe(false); // implied by orders.create but denied
  });
  it("sanitizes lists", () => {
    expect(sanitizePermissionList(["chat.use", "chat.use", "x", "catalog.view"])).toEqual(["catalog.view", "chat.use"]);
  });
});
