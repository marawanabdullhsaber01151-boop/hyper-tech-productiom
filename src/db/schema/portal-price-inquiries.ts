/** @format */

// Phase 6 (Governance & Portal project) — "اطلب سعر" (ask-before-you-order).
//
// Performance notes (this phase was asked to pay special attention to
// performance):
// - Customer identity and product name are denormalized onto this table at
//   request time (same pattern already used by
//   production_workflow_orders.customerName/customerPhone — see
//   src/routes/portal.ts), so the sales-side pending list never needs a join
//   across portal_customers/contacts/bom_recipes just to render a row.
// - suggestedPrice is a snapshot of bom_recipes.referencePrice taken at
//   request time, not recomputed on every read — cheap and historically
//   accurate even if the reference price changes later.
// - No new polling loop was added anywhere for this feature. Answering an
//   inquiry goes through the EXISTING portal notification system the
//   customer already polls every 25s (see loadPortalNotificationCount in
//   public/JS/portal.js) — the inquiries list itself is fetched on demand
//   when the customer opens that section, not polled.
// - Composite indexes below mirror the (customer, createdAt) and (status)
//   index patterns already used on portal_notifications and
//   production_workflow_orders in this codebase.

import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { portalCustomersTable } from "./portal-customers";
import { bomRecipesTable } from "./bom";

export const portalPriceInquiriesTable = pgTable(
  "portal_price_inquiries",
  {
    id: serial("id").primaryKey(),
    portalCustomerId: integer("portal_customer_id")
      .notNull()
      .references(() => portalCustomersTable.id, { onDelete: "cascade" }),
    bomRecipeId: integer("bom_recipe_id")
      .notNull()
      .references(() => bomRecipesTable.id),
    // Denormalized at request time — see performance note above.
    productName: text("product_name").notNull(),
    customerName: text("customer_name").notNull(),
    customerCompany: text("customer_company"),
    customerPhone: text("customer_phone").notNull(),
    // Always a canonical piece quantity (same "canonicalize at entry" rule
    // as Phase 5 orders) + which unit the customer actually typed in, purely
    // for display.
    requestedQty: numeric("requested_qty", { precision: 12, scale: 3 }).notNull(),
    requestedUnit: text("requested_unit").notNull().default("piece"),
    // Snapshot of bom_recipes.referencePrice at request time. Null if the
    // product had no reference price configured yet.
    suggestedPrice: numeric("suggested_price", { precision: 12, scale: 2 }),
    finalPrice: numeric("final_price", { precision: 12, scale: 2 }),
    status: text("status").notNull().default("pending"), // pending | answered | withdrawn
    answeredByUserId: integer("answered_by_user_id"),
    answeredByName: text("answered_by_name"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    statusCreatedIdx: index("portal_price_inquiries_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    customerCreatedIdx: index(
      "portal_price_inquiries_customer_created_idx",
    ).on(table.portalCustomerId, table.createdAt),
  }),
);

export const createPriceInquirySchema = z.object({
  bomRecipeId: z.number().int().positive(),
  qty: z.string().regex(/^(?=.*[1-9])[0-9]{1,6}(?:\.[0-9]{1,3})?$/),
  orderUnit: z.enum(["piece", "carton"]).optional().default("piece"),
});

export const answerPriceInquirySchema = z.object({
  // If omitted, the currently-suggested price is used as-is (accept
  // suggested with no changes). If provided, it becomes the final price.
  finalPrice: z
    .string()
    .regex(/^[0-9]{1,10}(?:\.[0-9]{1,2})?$/)
    .optional(),
});

export type PortalPriceInquiry = typeof portalPriceInquiriesTable.$inferSelect;
