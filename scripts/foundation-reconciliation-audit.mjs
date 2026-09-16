#!/usr/bin/env node
/**
 * Phase 03 Foundation reconciliation.
 *
 * Default mode is report-only. It never updates data. --apply performs only
 * the conservative exact-code backfill for inventory rows whose foundation
 * link is NULL; it never overwrites an existing link and never deletes rows.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
const apply = process.argv.includes("--apply");
const sampleLimit = Math.min(
  Math.max(Number(process.env.FOUNDATION_AUDIT_SAMPLE_LIMIT ?? 100), 1),
  500,
);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required for the Foundation reconciliation audit.");
  process.exit(2);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL_STRICT === "true" ? true : { rejectUnauthorized: false },
});

function number(value) {
  return Number(value ?? 0);
}

function detectLocationCycles(locations) {
  const parentById = new Map(locations.map((row) => [row.id, row.parent_id]));
  const issues = [];
  for (const location of locations) {
    if (location.parent_id !== null && !parentById.has(location.parent_id)) {
      issues.push({
        code: "location_parent_missing",
        severity: "blocker",
        entityType: "location",
        entityId: location.id,
        message: "Location points to a missing parent",
        details: { parentId: location.parent_id },
      });
      continue;
    }
    const visited = new Set();
    let cursor = location.id;
    while (cursor !== null) {
      if (visited.has(cursor)) {
        issues.push({
          code: "location_cycle",
          severity: "blocker",
          entityType: "location",
          entityId: location.id,
          message: "Location hierarchy contains a cycle",
          details: { cycleAt: cursor },
        });
        break;
      }
      visited.add(cursor);
      cursor = parentById.get(cursor) ?? null;
    }
  }
  return issues;
}

try {
  const client = await pool.connect();
  try {
    const presence = await client.query(`
      SELECT
        to_regclass('public.foundation_items') AS foundation_items,
        to_regclass('public.inventory_items') AS inventory_items,
        to_regclass('public.foundation_unit_conversions') AS conversions,
        to_regclass('public.foundation_locations') AS locations,
        to_regclass('public.foundation_work_centers') AS work_centers,
        to_regclass('public.foundation_machines') AS machines
    `);
    const missing = Object.entries(presence.rows[0])
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (missing.length) {
      throw new Error(
        `Foundation tables are missing: ${missing.join(", ")}. Run migrations first.`,
      );
    }

    const inventoryCounts = await client.query(`
      SELECT
        count(*) FILTER (
          WHERE i.foundation_item_id IS NULL AND i.code IS NOT NULL
        ) AS missing_link,
        count(*) FILTER (
          WHERE i.foundation_item_id IS NOT NULL AND f.id IS NULL
        ) AS missing_foundation,
        count(*) FILTER (
          WHERE i.foundation_item_id IS NOT NULL
            AND i.code IS NOT NULL
            AND f.code IS NOT NULL
            AND i.code <> f.code
        ) AS code_mismatch
      FROM inventory_items i
      LEFT JOIN foundation_items f ON f.id = i.foundation_item_id
    `);
    const inventorySamples = await client.query(
      `
      SELECT
        i.id,
        i.code,
        i.foundation_item_id,
        f.id IS NOT NULL AS foundation_item_exists,
        f.code AS foundation_code
      FROM inventory_items i
      LEFT JOIN foundation_items f ON f.id = i.foundation_item_id
      WHERE
        (i.foundation_item_id IS NULL AND i.code IS NOT NULL)
        OR (i.foundation_item_id IS NOT NULL AND f.id IS NULL)
        OR (
          i.foundation_item_id IS NOT NULL
          AND i.code IS NOT NULL
          AND f.code IS NOT NULL
          AND i.code <> f.code
        )
      ORDER BY i.id
      LIMIT $1
    `,
      [sampleLimit],
    );
    const conversions = await client.query(`
      SELECT id, item_id, from_unit, to_unit, factor
      FROM foundation_unit_conversions
      ORDER BY id
    `);
    const locations = await client.query(`
      SELECT id, parent_id
      FROM foundation_locations
      ORDER BY id
    `);
    const workCenters = await client.query(`
      SELECT wc.id, wc.location_id, l.id IS NOT NULL AS location_exists
      FROM foundation_work_centers wc
      LEFT JOIN foundation_locations l ON l.id = wc.location_id
      ORDER BY wc.id
    `);
    const machines = await client.query(`
      SELECT m.id, m.work_center_id, wc.id IS NOT NULL AS work_center_exists
      FROM foundation_machines m
      LEFT JOIN foundation_work_centers wc ON wc.id = m.work_center_id
      ORDER BY m.id
    `);

    const issues = [];
    for (const row of inventorySamples.rows) {
      if (row.foundation_item_id === null) {
        issues.push({
          code: "inventory_missing_foundation_link",
          severity: "warning",
          entityType: "inventory_item",
          entityId: row.id,
          message: "Inventory item has a code but no Foundation link",
          details: { code: row.code },
        });
      } else if (!row.foundation_item_exists) {
        issues.push({
          code: "inventory_foundation_missing",
          severity: "blocker",
          entityType: "inventory_item",
          entityId: row.id,
          message: "Inventory item points to a missing Foundation item",
          details: { foundationItemId: row.foundation_item_id },
        });
      } else if (row.code && row.foundation_code && row.code !== row.foundation_code) {
        issues.push({
          code: "inventory_foundation_code_mismatch",
          severity: "blocker",
          entityType: "inventory_item",
          entityId: row.id,
          message: "Inventory code differs from its Foundation code",
          details: { inventoryCode: row.code, foundationCode: row.foundation_code },
        });
      }
    }

    for (const row of conversions.rows) {
      const factor = Number(row.factor);
      if (!Number.isFinite(factor) || factor <= 0 || row.from_unit.trim() === row.to_unit.trim()) {
        issues.push({
          code: "conversion_invalid",
          severity: "blocker",
          entityType: "unit_conversion",
          entityId: row.id,
          message: "Unit conversion has an invalid factor or identical units",
          details: { itemId: row.item_id, fromUnit: row.from_unit, toUnit: row.to_unit, factor: row.factor },
        });
      }
    }

    for (const row of workCenters.rows) {
      if (row.location_id !== null && !row.location_exists) {
        issues.push({
          code: "work_center_location_missing",
          severity: "blocker",
          entityType: "work_center",
          entityId: row.id,
          message: "Work center points to a missing location",
          details: { locationId: row.location_id },
        });
      }
    }
    for (const row of machines.rows) {
      if (!row.work_center_exists) {
        issues.push({
          code: "machine_work_center_missing",
          severity: "blocker",
          entityType: "machine",
          entityId: row.id,
          message: "Machine points to a missing work center",
          details: { workCenterId: row.work_center_id },
        });
      }
    }
    issues.push(...detectLocationCycles(locations.rows));

    let appliedBackfill = 0;
    if (apply) {
      await client.query("BEGIN");
      const result = await client.query(`
        UPDATE inventory_items i
        SET foundation_item_id = f.id,
            updated_at = now()
        FROM foundation_items f
        WHERE i.foundation_item_id IS NULL
          AND i.code IS NOT NULL
          AND i.code = f.code
      `);
      appliedBackfill = result.rowCount ?? 0;
      await client.query("COMMIT");
    }

    const summary = {
      missingInventoryLinks: number(inventoryCounts.rows[0].missing_link),
      missingFoundationReferences: number(inventoryCounts.rows[0].missing_foundation),
      inventoryCodeMismatches: number(inventoryCounts.rows[0].code_mismatch),
      sampledIssueCount: issues.length,
      sampledIssueLimit: sampleLimit,
      blockersInSample: issues.filter((item) => item.severity === "blocker").length,
      warningsInSample: issues.filter((item) => item.severity === "warning").length,
    };
    const report = {
      generatedAt: new Date().toISOString(),
      mode: apply ? "apply-exact-code-backfill" : "report-only",
      summary,
      appliedBackfill,
      issues,
      note:
        "Issue samples are bounded. Aggregate inventory counts are complete; review all rows before any broader remediation.",
    };
    const outDir = path.resolve("docs/reports");
    mkdirSync(outDir, { recursive: true });
    const reportFile = path.join(outDir, "phase-03-foundation-reconciliation.json");
    writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, reportFile }, null, 2));
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // No transaction was open for report-only mode.
    }
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error(`Foundation reconciliation failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}