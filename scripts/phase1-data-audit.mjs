#!/usr/bin/env node
/**
 * Phase 01 database audit.
 *
 * Read-only by default. It classifies legacy production rows, workflow rows,
 * open operations cases, active master data, and orphaned foreign keys. It
 * never deletes or updates business records. Findings are optionally copied
 * to data_audit_findings when migration 0054 is already applied.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import pkg from "pg";

const { Pool } = pkg;
const root = path.resolve(process.cwd());
const runId = `phase1-${new Date().toISOString().replaceAll(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is required. No database audit was executed.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.PGSSL_STRICT === "true" ?
      true
    : { rejectUnauthorized: false },
});

function quoteIdentifier(value) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe identifier returned by PostgreSQL: ${value}`);
  }
  return `"${value}"`;
}

async function tableExists(client, table) {
  const result = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${table}`],
  );
  return result.rows[0]?.exists === true;
}

async function countByStatus(client, table) {
  if (!(await tableExists(client, table))) {
    return { present: false, count: 0, byStatus: [] };
  }
  const columns = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  const hasStatus = columns.rows.some((row) => row.column_name === "status");
  const statusColumn = hasStatus ? "status" : "workflow_status";
  const hasStatusColumn = columns.rows.some(
    (row) => row.column_name === statusColumn,
  );
  const count = await client.query(
    `SELECT count(*)::int AS count FROM public.${quoteIdentifier(table)}`,
  );
  const byStatus = hasStatusColumn ?
    await client.query(
      `SELECT ${quoteIdentifier(statusColumn)} AS status, count(*)::int AS count
       FROM public.${quoteIdentifier(table)}
       GROUP BY ${quoteIdentifier(statusColumn)}
       ORDER BY count DESC`,
    )
  : { rows: [] };
  return {
    present: true,
    count: Number(count.rows[0]?.count ?? 0),
    byStatus: byStatus.rows,
  };
}

async function activeMasterData(client, table) {
  if (!(await tableExists(client, table))) {
    return { present: false };
  }
  const columns = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  const names = new Set(columns.rows.map((row) => row.column_name));
  const activePredicate =
    names.has("active") ? `${quoteIdentifier("active")} = true`
    : names.has("is_active") ? `${quoteIdentifier("is_active")} = true`
    : names.has("status") ? `${quoteIdentifier("status")} NOT IN ('inactive', 'archived', 'deleted')`
    : "TRUE";
  const result = await client.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE ${activePredicate})::int AS active
     FROM public.${quoteIdentifier(table)}`,
  );
  return {
    present: true,
    total: Number(result.rows[0]?.total ?? 0),
    active: Number(result.rows[0]?.active ?? 0),
    activitySource: names.has("active") ? "active"
      : names.has("is_active") ? "is_active"
      : names.has("status") ? "status"
      : "all rows",
  };
}

async function foreignKeyOrphans(client) {
  const constraints = await client.query(`
    SELECT
      tc.table_name AS child_table,
      kcu.column_name AS child_column,
      ccu.table_name AS parent_table,
      ccu.column_name AS parent_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name
  `);
  const findings = [];
  for (const fk of constraints.rows) {
    const child = quoteIdentifier(fk.child_table);
    const childColumn = quoteIdentifier(fk.child_column);
    const parent = quoteIdentifier(fk.parent_table);
    const parentColumn = quoteIdentifier(fk.parent_column);
    const result = await client.query(`
      SELECT count(*)::int AS count
      FROM public.${child} c
      LEFT JOIN public.${parent} p
        ON p.${parentColumn} = c.${childColumn}
      WHERE c.${childColumn} IS NOT NULL
        AND p.${parentColumn} IS NULL
    `);
    const count = Number(result.rows[0]?.count ?? 0);
    if (count) {
      findings.push({
        findingType: "orphan_reference",
        entityType: fk.child_table,
        severity: "error",
        title: `${fk.child_table}.${fk.child_column} references missing ${fk.parent_table}`,
        details: { ...fk, count },
      });
    }
  }
  return findings;
}

async function main() {
  const client = await pool.connect();
  try {
    const report = {
      runId,
      generatedAt: new Date().toISOString(),
      readOnly: true,
      legacyProductionOrders: await countByStatus(client, "production_orders"),
      workflowProductionOrders: await countByStatus(
        client,
        "production_workflow_orders",
      ),
      openOperationsCases: await countByStatus(client, "operations_cases"),
      activeMasterData: {},
      orphanedReferences: await foreignKeyOrphans(client),
      findings: [],
    };

    for (const table of [
      "inventory_items",
      "bom_recipes",
      "work_centers",
      "machines",
      "foundation_items",
      "contacts",
    ]) {
      report.activeMasterData[table] = await activeMasterData(client, table);
    }

    if (
      report.legacyProductionOrders.present &&
      report.legacyProductionOrders.count > 0
    ) {
      report.findings.push({
        findingType: "legacy_source_present",
        entityType: "production_orders",
        severity: "warning",
        title: "Legacy production_orders contains rows and requires reconciliation",
        details: report.legacyProductionOrders,
      });
    }
    if (report.orphanedReferences.length) {
      report.findings.push(...report.orphanedReferences);
    }

    const outputDir = path.join(root, "docs", "audits");
    mkdirSync(outputDir, { recursive: true });
    const jsonPath = path.join(outputDir, `${runId}.json`);
    const markdownPath = path.join(outputDir, `${runId}.md`);
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(
      markdownPath,
      [
        `# Phase 01 Database Audit — ${runId}`,
        "",
        "This report is read-only. No legacy or workflow business row was changed.",
        "",
        `- Legacy production_orders: ${report.legacyProductionOrders.present ? `${report.legacyProductionOrders.count} rows` : "table absent"}`,
        `- production_workflow_orders: ${report.workflowProductionOrders.present ? `${report.workflowProductionOrders.count} rows` : "table absent"}`,
        `- operations_cases: ${report.openOperationsCases.present ? `${report.openOperationsCases.count} rows` : "table absent"}`,
        `- Orphaned foreign-key relationships: ${report.orphanedReferences.length}`,
        `- Findings recorded: ${report.findings.length}`,
        "",
        "## Classification",
        "",
        "Rows are classified for review only. Migration or deletion requires a separate approved plan after backup and external-caller verification.",
        "",
        "Machine-readable output: `" + path.relative(root, jsonPath) + "`",
        "",
      ].join("\n"),
    );

    const findingsTable = await tableExists(client, "data_audit_findings");
    if (findingsTable && report.findings.length) {
      for (const finding of report.findings) {
        await client.query(
          `INSERT INTO data_audit_findings
             (audit_run_id, finding_type, entity_type, severity, title, details)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            runId,
            finding.findingType,
            finding.entityType,
            finding.severity,
            finding.title,
            JSON.stringify(finding.details),
          ],
        );
      }
    }

    console.log(
      JSON.stringify(
        {
          runId,
          json: path.relative(root, jsonPath),
          report: path.relative(root, markdownPath),
          legacyRows: report.legacyProductionOrders.count,
          workflowRows: report.workflowProductionOrders.count,
          orphanedReferences: report.orphanedReferences.length,
          findings: report.findings.length,
          findingsPersisted: findingsTable,
        },
        null,
        2,
      ),
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("❌ Phase 01 database audit failed:", error.message);
  await pool.end().catch(() => {});
  process.exit(1);
});