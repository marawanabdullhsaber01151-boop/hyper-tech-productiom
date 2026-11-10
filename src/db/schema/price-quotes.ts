/** @format */
// عروض الأسعار (45أ): عرض لعميل بمدة صلاحية وسطور بأسعار متفق عليها.
import { pgTable, serial, integer, text, numeric, date, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { portalCustomersTable } from "./portal-customers";
import { bomRecipesTable } from "./bom";
import { systemUsersTable } from "./settings";

export const priceQuotesTable = pgTable(
  "price_quotes",
  {
    id: serial("id").primaryKey(),
    quoteNumber: text("quote_number").notNull().unique(),
    portalCustomerId: integer("portal_customer_id").notNull().references(() => portalCustomersTable.id, { onDelete: "cascade" }),
    customerName: text("customer_name").notNull(),
    /** draft | sent | ordered | declined | cancelled — «منتهي» بيتحسب من validUntil وقت القراءة. */
    status: text("status").notNull().default("draft"),
    validUntil: date("valid_until", { mode: "string" }).notNull(),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => systemUsersTable.id, { onDelete: "set null" }),
    createdByName: text("created_by_name"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedByName: text("decided_by_name"),
    declineReason: text("decline_reason"),
    cancelReason: text("cancel_reason"),
    batchRef: text("batch_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    customerIdx: index("price_quotes_customer_idx").on(table.portalCustomerId, table.id),
    statusIdx: index("price_quotes_status_idx").on(table.status, table.validUntil),
  }),
);

export const priceQuoteLinesTable = pgTable(
  "price_quote_lines",
  {
    id: serial("id").primaryKey(),
    quoteId: integer("quote_id").notNull().references(() => priceQuotesTable.id, { onDelete: "cascade" }),
    bomRecipeId: integer("bom_recipe_id").notNull().references(() => bomRecipesTable.id),
    productName: text("product_name").notNull(),
    qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  },
  (table) => ({
    quoteRecipeUnique: uniqueIndex("price_quote_lines_quote_recipe_unique").on(table.quoteId, table.bomRecipeId),
  }),
);

export type PriceQuote = typeof priceQuotesTable.$inferSelect;
export type PriceQuoteLine = typeof priceQuoteLinesTable.$inferSelect;
