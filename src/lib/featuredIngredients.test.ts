/** @format */

import { describe, expect, it } from "vitest";
import {
  toPortalFeaturedIngredients,
  shouldRenderFeaturedSection,
  PORTAL_FEATURED_INGREDIENT_FIELDS,
} from "./featuredIngredients";

// A realistic internal recipe-item row, including all the internal costing
// data that must never reach a customer.
const internalItems = [
  {
    id: 1,
    recipeId: 10,
    inventoryItemId: 55,
    materialName: "نحاس",
    qty: "3.500",
    unit: "kg",
    unitCost: "420.00",
    isFeatured: true,
    featuredImageData: "data:image/png;base64,AAAA",
  },
  {
    id: 2,
    recipeId: 10,
    inventoryItemId: 56,
    materialName: "بلاستيك مقاوم للحرارة",
    qty: "1.000",
    unit: "pcs",
    unitCost: "75.50",
    isFeatured: true,
    featuredImageData: null,
  },
  {
    id: 3,
    recipeId: 10,
    inventoryItemId: 57,
    materialName: "مسامير",
    qty: "12.000",
    unit: "pcs",
    unitCost: "1.25",
    isFeatured: false,
    featuredImageData: null,
  },
];

describe("toPortalFeaturedIngredients (Phase 3)", () => {
  it("returns only the components marked as featured", () => {
    const result = toPortalFeaturedIngredients(internalItems);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.name)).toEqual([
      "نحاس",
      "بلاستيك مقاوم للحرارة",
    ]);
  });

  it("exposes ONLY name and image — never qty, unit, or unitCost", () => {
    const result = toPortalFeaturedIngredients(internalItems);
    for (const ingredient of result) {
      expect(Object.keys(ingredient).sort()).toEqual(
        [...PORTAL_FEATURED_INGREDIENT_FIELDS].sort(),
      );
      expect(ingredient).not.toHaveProperty("qty");
      expect(ingredient).not.toHaveProperty("unit");
      expect(ingredient).not.toHaveProperty("unitCost");
      expect(ingredient).not.toHaveProperty("inventoryItemId");
      expect(ingredient).not.toHaveProperty("recipeId");
    }
  });

  it("does not leak a newly-added internal column it doesn't know about", () => {
    // Guards against a future column on bom_recipe_items silently becoming
    // customer-visible because someone spread the row instead of picking fields.
    const withNewInternalColumn = [
      {
        ...internalItems[0],
        supplierSecretMargin: "999.99",
      },
    ];
    const [result] = toPortalFeaturedIngredients(withNewInternalColumn);
    expect(result).not.toHaveProperty("supplierSecretMargin");
    expect(Object.keys(result).sort()).toEqual(
      [...PORTAL_FEATURED_INGREDIENT_FIELDS].sort(),
    );
  });

  it("normalizes a missing featured image to null rather than undefined", () => {
    const result = toPortalFeaturedIngredients([
      { materialName: "مادة بدون صورة", isFeatured: true },
    ]);
    expect(result).toEqual([{ name: "مادة بدون صورة", image: null }]);
  });

  it("returns an empty list when nothing is featured", () => {
    const result = toPortalFeaturedIngredients([internalItems[2]]);
    expect(result).toEqual([]);
  });
});

describe("shouldRenderFeaturedSection (Phase 3)", () => {
  it("does not render the section when nothing is featured", () => {
    expect(shouldRenderFeaturedSection([])).toBe(false);
  });

  it("renders the section when at least one component is featured", () => {
    expect(
      shouldRenderFeaturedSection([{ name: "نحاس", image: null }]),
    ).toBe(true);
  });
});
