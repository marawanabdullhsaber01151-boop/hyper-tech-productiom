import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Phase 01 operational metadata.
 *
 * These tables deliberately contain no business data. They make deployment,
 * diagnostics, retries, and data reconciliation observable without changing
 * the legacy production tables.
 */
export const migrationLedgerTable = pgTable("_migrations_applied", {
  filename: text("filename").primaryKey(),
  checksum: text("checksum"),
  appliedAt: timestamp("applied_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  durationMs: integer("duration_ms"),
  runnerVersion: text("runner_version"),
});

export const systemHealthChecksTable = pgTable(
  "system_health_checks",
  {
    id: serial("id").primaryKey(),
    checkKey: text("check_key").notNull(),
    status: text("status").notNull(),
    summary: text("summary").notNull(),
    details: jsonb("details"),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    keyUnique: uniqueIndex("system_health_checks_key_unique").on(
      table.checkKey,
    ),
    statusIdx: index("system_health_checks_status_idx").on(table.status),
    checkedAtIdx: index("system_health_checks_checked_at_idx").on(
      table.checkedAt,
    ),
  }),
);

export const commandIdempotencyTable = pgTable(
  "command_idempotency",
  {
    id: serial("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    commandName: text("command_name").notNull(),
    requestHash: text("request_hash").notNull(),
    correlationId: text("correlation_id").notNull(),
    actorUserId: integer("actor_user_id"),
    status: text("status").notNull().default("processing"),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    commandKeyUnique: uniqueIndex("command_idempotency_key_unique").on(
      table.commandName,
      table.idempotencyKey,
    ),
    actorIdx: index("command_idempotency_actor_idx").on(
      table.actorUserId,
      table.createdAt,
    ),
  }),
);

export const dataAuditFindingsTable = pgTable(
  "data_audit_findings",
  {
    id: serial("id").primaryKey(),
    auditRunId: text("audit_run_id").notNull(),
    findingType: text("finding_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    severity: text("severity").notNull().default("warning"),
    title: text("title").notNull(),
    details: jsonb("details"),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    runIdx: index("data_audit_findings_run_idx").on(table.auditRunId),
    statusIdx: index("data_audit_findings_status_idx").on(
      table.status,
      table.severity,
    ),
    entityIdx: index("data_audit_findings_entity_idx").on(
      table.entityType,
      table.entityId,
    ),
  }),
);

export type CommandIdempotency = typeof commandIdempotencyTable.$inferSelect;
export type DataAuditFinding = typeof dataAuditFindingsTable.$inferSelect;