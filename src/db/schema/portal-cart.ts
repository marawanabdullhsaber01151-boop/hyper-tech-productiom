/** @format */

import {
  pgTable,
  serial,
  integer,
  numeric,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { bomRecipesTable } from "./bom";
import { portalCustomersTable } from "./portal-customers";

export const portalCartItemsTable = pgTable(
  "portal_cart_items",
  {
    id: serial("id").primaryKey(),
    portalCustomerId: integer("portal_customer_id")
      .notNull()
      .references(() => portalCustomersTable.id, { onDelete: "cascade" }),
    // Plan 02: NULL = shared company cart (cart.scope = company).
    memberId: integer("member_id"),
    bomRecipeId: integer("bom_recipe_id")
      .notNull()
      .references(() => bomRecipesTable.id, { onDelete: "cascade" }),
    qty: numeric("qty", { precision: 12, scale: 3 }).notNull().default("1"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    memberRecipeUnique: uniqueIndex("portal_cart_items_member_recipe_unique").on(
      table.portalCustomerId,
      sql`COALESCE(${table.memberId}, 0)`,
      table.bomRecipeId,
    ),
  }),
);

export type PortalCartItem = typeof portalCartItemsTable.$inferSelect;