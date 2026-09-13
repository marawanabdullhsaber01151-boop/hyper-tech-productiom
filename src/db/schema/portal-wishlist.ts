/** @format */

import {
  pgTable,
  serial,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { bomRecipesTable } from "./bom";
import { portalCustomersTable } from "./portal-customers";

export const portalWishlistItemsTable = pgTable(
  "portal_wishlist_items",
  {
    id: serial("id").primaryKey(),
    portalCustomerId: integer("portal_customer_id")
      .notNull()
      .references(() => portalCustomersTable.id, { onDelete: "cascade" }),
    bomRecipeId: integer("bom_recipe_id")
      .notNull()
      .references(() => bomRecipesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    customerRecipeUnique: uniqueIndex(
      "portal_wishlist_items_customer_recipe_unique",
    ).on(table.portalCustomerId, table.bomRecipeId),
  }),
);

export type PortalWishlistItem = typeof portalWishlistItemsTable.$inferSelect;