/** @format */

import { describe, expect, it } from "vitest";
import { resolvePortalProductIdentity } from "./portalCatalog";

describe("resolvePortalProductIdentity (Phase 1 — portal catalog ↔ Foundation link)", () => {
  it("prefers the Foundation item's code/name/base unit when the recipe is linked", () => {
    const result = resolvePortalProductIdentity(
      { productCode: "OLD-CODE", productName: "الاسم القديم في الوصفة" },
      { code: "FG-001", name: "اسم المنتج في صفحة البيانات الأساسية", baseUnit: "carton" },
    );
    expect(result).toEqual({
      productCode: "FG-001",
      productName: "اسم المنتج في صفحة البيانات الأساسية",
      baseUnit: "carton",
    });
  });

  it("falls back to the recipe's own denormalized fields for a legacy, unlinked recipe", () => {
    const result = resolvePortalProductIdentity(
      { productCode: "LEGACY-CODE", productName: "اسم الوصفة القديمة" },
      null,
    );
    expect(result).toEqual({
      productCode: "LEGACY-CODE",
      productName: "اسم الوصفة القديمة",
      baseUnit: null,
    });
  });

  it("falls back correctly even when the legacy recipe has no product code at all", () => {
    const result = resolvePortalProductIdentity(
      { productCode: null, productName: "اسم بس من غير كود" },
      undefined,
    );
    expect(result).toEqual({
      productCode: null,
      productName: "اسم بس من غير كود",
      baseUnit: null,
    });
  });
});
