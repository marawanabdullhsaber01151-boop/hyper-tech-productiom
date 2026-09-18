/** @format */

// Phase 3 (Governance & Portal project) — "أهم مكونات هذا المنتج".
//
// The portal product page shows a dedicated section listing the components an
// admin deliberately marked as featured. Only the component's NAME and its
// optional IMAGE may ever reach a customer-facing response — qty, unit and
// unitCost are internal costing data. This module holds the shaping logic as
// a pure function so that guarantee is unit-testable without a database, and
// so there is exactly one place where the allowed fields are defined.

// The only fields a featured ingredient may expose to a portal customer.
export const PORTAL_FEATURED_INGREDIENT_FIELDS = ["name", "image"] as const;

export type PortalFeaturedIngredient = {
  name: string;
  image: string | null;
};

// Anything that looks like an internal recipe item row. Deliberately loose:
// the point of this function is that it does NOT pass unknown fields through,
// so new columns added to bom_recipe_items later can't silently leak.
type RecipeItemLike = {
  materialName: string;
  isFeatured?: boolean | null;
  featuredImageData?: string | null;
  [key: string]: unknown;
};

/**
 * Picks out the featured components and reduces each one to just the two
 * fields the portal is allowed to show. Never spreads the source row.
 */
export function toPortalFeaturedIngredients(
  items: RecipeItemLike[],
): PortalFeaturedIngredient[] {
  return items
    .filter((item) => item.isFeatured === true)
    .map((item) => ({
      name: item.materialName,
      image: item.featuredImageData ?? null,
    }));
}

/**
 * The portal section must not render at all when nothing is featured — no
 * empty heading with nothing under it. Frontend uses this same rule.
 */
export function shouldRenderFeaturedSection(
  featured: PortalFeaturedIngredient[],
): boolean {
  return featured.length > 0;
}
