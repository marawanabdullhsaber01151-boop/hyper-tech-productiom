import { describe, expect, it } from "vitest";
import {
  getDefaultRolesForPermission,
  OPERATIONS_MANAGER_PERMISSIONS,
} from "../lib/permissions";

process.env.JWT_SECRET ??= "stage-02-test-secret-that-is-long-enough";
process.env.DATABASE_URL ??= "postgresql://stage02:stage02@localhost:5432/stage02";

const { default: router } = await import("./operations-manager");

describe("Operations Manager routes", () => {
  it("exposes the intake, read, revision, and clarification routes", () => {
    const routes = (router as any).stack
      .map((layer: any) => layer.route)
      .filter(Boolean)
      .map((route: any) => ({
        path: route.path,
        methods: Object.keys(route.methods).filter((method) => route.methods[method]),
      }));

    expect(routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/operations-manager/cases",
          methods: ["get"],
        }),
        expect.objectContaining({
          path: "/operations-manager/cases/from-sales-order/:salesOrderId",
          methods: ["post"],
        }),
        expect.objectContaining({
          path: "/operations-manager/cases/:id",
          methods: ["get"],
        }),
        expect.objectContaining({
          path: "/operations-manager/cases/:id/revisions",
          methods: ["get"],
        }),
        expect.objectContaining({
          path: "/operations-manager/cases/:id/start-validation",
          methods: ["post"],
        }),
        expect.objectContaining({
          path: "/operations-manager/cases/:id/complete-validation",
          methods: ["post"],
        }),
        expect.objectContaining({
          path: "/operations-manager/cases/:id/request-sales-clarification",
          methods: ["post"],
        }),
      ]),
    );
  });

  it("defaults case editing to Operations Control roles only", () => {
    const roles = getDefaultRolesForPermission(
      OPERATIONS_MANAGER_PERMISSIONS.caseEdit,
    );
    expect(roles).toContain("operations_manager");
    expect(roles).toContain("chairman");
    expect(roles).not.toContain("production_manager");
    expect(roles).not.toContain("warehouse_manager");
  });
});