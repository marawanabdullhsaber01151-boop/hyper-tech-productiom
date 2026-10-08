/** @format */

import {
  pgTable,
  serial,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { bomRecipesTable } from "./bom";
import { portalCustomersTable } from "./portal-customers";

export const portalWishlistItemsTable = pgTable(
  "portal_wishlist_items",
  {
    id: serial("id").primaryKey(),
    portalCustomerId: integer("portal_customer_id")
      .notNull()
      .references(() => portalCustomersTable.id, { onDelete: "cascade" }),
    // Plan 02: NULL = shared company wishlist.
    memberId: integer("member_id"),
    bomRecipeId: integer("bom_recipe_id")
      .notNull()
      .references(() => bomRecipesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    memberRecipeUnique: uniqueIndex("portal_wishlist_items_member_recipe_unique").on(
      table.portalCustomerId,
      sql`COALESCE(${table.memberId}, 0)`,
      table.bomRecipeId,
    ),
  }),
);

export type PortalWishlistItem = typeof portalWishlistItemsTable.$inferSelect;