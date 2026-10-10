/** @format */
/** Plan 03 — activation tokens, delivery channels, recovery codes, outbox. */
import {
  pgTable,
  serial,
  bigserial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { portalUsersTable } from "./portal-identity";

export const authTokenPurposes = ["activation", "password_reset", "invite", "channel_link", "join"] as const;
export type AuthTokenPurpose = (typeof authTokenPurposes)[number];

export const portalAuthTokensTable = pgTable(
  "portal_auth_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => portalUsersTable.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    codeHash: text("code_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    uses: integer("uses").notNull().default(0),
    maxUses: integer("max_uses").notNull().default(1),
    attempts: integer("attempts").notNull().default(0),
    createdByStaffId: integer("created_by_staff_id"),
    createdByMemberId: integer("created_by_member_id"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hashUnique: uniqueIndex("portal_auth_tokens_hash_unique").on(t.tokenHash),
    userPurpose: index("portal_auth_tokens_user_purpose_idx").on(t.userId, t.purpose, t.createdAt),
  }),
);

export const portalChannelsTable = pgTable(
  "portal_channels",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => portalUsersTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // email | telegram | whatsapp
    address: text("address").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    isPrimary: boolean("is_primary").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    prefs: jsonb("prefs").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("portal_channels_user_type_addr_unique").on(t.userId, t.type, t.address),
    lookup: index("portal_channels_type_addr_idx").on(t.type, t.address),
  }),
);

export const portalRecoveryCodesTable = pgTable(
  "portal_recovery_codes",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => portalUsersTable.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    batchId: text("batch_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userIdx: index("portal_recovery_codes_user_idx").on(t.userId, t.usedAt) }),
);

export const outboxStatuses = ["queued", "sent", "failed", "manual_pending", "manual_sent", "opened", "expired"] as const;
export type OutboxStatus = (typeof outboxStatuses)[number];

export const portalOutboxTable = pgTable(
  "portal_outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id"),
    companyId: integer("company_id"),
    purpose: text("purpose").notNull(),
    channel: text("channel").notNull(),
    status: text("status").notNull().default("queued"),
    provider: text("provider"),
    errorCode: text("error_code"),
    attempts: integer("attempts").notNull().default(0),
    templateKey: text("template_key"),
    maskedDestination: text("masked_destination"),
    createdByStaffId: integer("created_by_staff_id"),
    createdByMemberId: integer("created_by_member_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => ({
    company: index("portal_outbox_company_idx").on(t.companyId, t.createdAt),
    user: index("portal_outbox_user_idx").on(t.userId, t.createdAt),
  }),
);

export const portalTelegramLinksTable = pgTable(
  "portal_telegram_links",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => portalUsersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ hashUnique: uniqueIndex("portal_telegram_links_hash_unique").on(t.tokenHash) }),
);
