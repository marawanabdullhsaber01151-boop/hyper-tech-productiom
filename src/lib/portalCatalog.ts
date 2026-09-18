/** @format */

// Phase 1 (Governance & Portal project): once a bom_recipes row is linked to
// a صفحة البيانات الأساسية (Foundation) "finished_good" item, the portal
// catalog must show that Foundation item's code/name/base unit instead of
// the BOM recipe's own denormalized fields. Legacy, unlinked recipes keep
// showing their own fields exactly as before. This is a small pure function
// so it can be unit-tested without a database.

export type PortalProductSource = {
  productCode: string | null;
  productName: string;
};

export type FoundationProductSource = {
  code: string;
  name: string;
  baseUnit: string;
} | null | undefined;

export function resolvePortalProductIdentity(
  recipe: PortalProductSource,
  foundationItem: FoundationProductSource,
) {
  return {
    productCode: foundationItem?.code ?? recipe.productCode,
    productName: foundationItem?.name ?? recipe.productName,
    baseUnit: foundationItem?.baseUnit ?? null,
  };
}
