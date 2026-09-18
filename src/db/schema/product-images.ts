/** @format */

// Phase 2 (Governance & Portal project) — product images.
//
// Storage decision (pre-flight audit finding, documented here rather than
// silently built around): this project has no existing file-upload
// infrastructure at all (no multer/S3/Cloudinary — confirmed by searching
// the whole codebase before writing this file) and is deployed on Vercel
// (see vercel.json), whose serverless functions have an ephemeral,
// effectively-read-only filesystem outside /tmp — writing uploaded files to
// disk under public/ would not persist or be servable across requests or
// deployments. Provisioning a new external object-storage service is out of
// scope for this phase (it would need new credentials/env configuration the
// owner would have to set up). Given that, images are stored directly in
// Postgres as base64 data URLs (small admin-curated product photos, not
// user-generated bulk uploads), with a hard per-image size cap enforced in
// src/routes/bom.ts to keep row/table size reasonable. If image volume grows
// significantly later, this table's imageData column can be swapped for a
// storagePath/url column pointing at real object storage without changing
// any other part of the schema.

import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { bomRecipesTable } from "./bom";

export const productImagesTable = pgTable(
  "product_images",
  {
    id: serial("id").primaryKey(),
    bomRecipeId: integer("bom_recipe_id")
      .notNull()
      .references(() => bomRecipesTable.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("secondary"), // "primary" | "secondary"
    imageData: text("image_data").notNull(), // base64 data URL, e.g. data:image/png;base64,...
    sortOrder: integer("sort_order").notNull().default(0),
    uploadedByUserId: integer("uploaded_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    recipeIdx: index("product_images_recipe_idx").on(table.bomRecipeId),
    // At most one primary image per recipe.
    onePrimaryPerRecipe: uniqueIndex("product_images_one_primary_per_recipe")
      .on(table.bomRecipeId)
      .where(sql`${table.role} = 'primary'`),
  }),
);

export const insertProductImageSchema = z.object({
  bomRecipeId: z.number().int().positive(),
  role: z.enum(["primary", "secondary"]).default("secondary"),
  imageData: z
    .string()
    .regex(
      /^data:image\/(png|jpe?g|webp);base64,/,
      "لازم تكون صورة بصيغة png أو jpg أو webp",
    ),
  sortOrder: z.number().int().default(0),
});

export type InsertProductImage = z.infer<typeof insertProductImageSchema>;
export type ProductImage = typeof productImagesTable.$inferSelect;
