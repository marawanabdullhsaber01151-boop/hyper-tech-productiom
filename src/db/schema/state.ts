/** @format */

import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod";

export const appStateTable = pgTable("app_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const setStateSchema = z.object({
  value: z.unknown(),
});

export type AppState = typeof appStateTable.$inferSelect;
