/** @format */

import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod";

/**
 * Atomic business-number sequences.
 * The row is locked inside the same transaction that creates the business record.
 */
export const phase0NumberSequencesTable = pgTable(
  "phase0_number_sequences",
  {
    id: serial("id").primaryKey(),
    sequenceKey: text("sequence_key").notNull(),
    prefix: text("prefix").notNull(),
    nextValue: integer("next_value").notNull().default(1),
    padding: integer("padding").notNull().default(6),
    active: boolean("active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    keyUnique: uniqueIndex("phase0_number_sequences_key_unique").on(
      table.sequenceKey,
    ),
    activeIdx: index("phase0_number_sequences_active_idx").on(table.active),
  }),
);

export const phase0NumberSequenceSchema = z.object({
  sequenceKey: z.string().trim().min(1).max(80),
  prefix: z.string().trim().min(1).max(30),
  nextValue: z.number().int().positive().default(1),
  padding: z.number().int().min(1).max(12).default(6),
});

export const phase0TransitionCheckSchema = z.object({
  entityType: z.enum([
    "production_order",
    "production_operation",
    "batch",
    "quality_lot",
  ]),
  fromState: z.string().trim().min(1).max(80),
  toState: z.string().trim().min(1).max(80),
});

export type Phase0NumberSequence =
  typeof phase0NumberSequencesTable.$inferSelect;