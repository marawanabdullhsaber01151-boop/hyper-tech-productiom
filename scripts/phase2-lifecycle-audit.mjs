#!/usr/bin/env node
/**
 * Phase 02 legacy reconciliation.
 *
 * Default mode is read-only and writes a JSON report. --apply creates one
 * quarantined mapping row per legacy production_orders row, with the complete
 * source row as evidence. It never creates a canonical order automatically:
 * ambiguous historical status/recipe mappings require a human decision.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required for the legacy audit.");
  process.exit(2);
}

const apply = process.argv.includes("--apply");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL_STRICT === "true" ? true : { rejectUnauthorized: false },
});

try {
  const client = await pool.connect();
  try {
    const legacy = await client.query("SELECT * FROM production_orders ORDER BY id");
    const canonical = await client.query(`
      SELECT id, order_number, workflow_status, canonical_source_type,
             canonical_source_id, snapshot_hash
      FROM production_workflow_orders
      ORDER BY id
    `);
    const report = {
      generatedAt: new Date().toISOString(),
      mode: apply ? "apply-quarantine" : "report-only",
      legacyCount: legacy.rowCount,
      canonicalCount: canonical.rowCount,
      rows: legacy.rows.map((row) => ({
        legacyId: row.id,
        orderNumber: row.order_number,
        status: row.status,
        productName: row.product_name,
        bomRecipeId: row.bom_recipe_id,
        mapping: "quarantined",
        reason: "Historical production_orders row requires reviewed mapping evidence",
        evidenceHash: createHash("sha256")
          .update(JSON.stringify(row))
          .digest("hex"),
      })),
    };

    if (apply) {
      await client.query("BEGIN");
      for (const row of legacy.rows) {
        await client.query(
          `INSERT INTO production_legacy_order_mappings
             (legacy_production_order_id, mapping_status, evidence,
              legacy_snapshot, review_reason)
           VALUES ($1, 'quarantined', $2::jsonb, $3::jsonb, $4)
           ON CONFLICT (legacy_production_order_id) DO UPDATE SET
             evidence = EXCLUDED.evidence,
             legacy_snapshot = EXCLUDED.legacy_snapshot,
             review_reason = EXCLUDED.review_reason`,
          [
            row.id,
            JSON.stringify({
              source: "scripts/phase2-lifecycle-audit.mjs",
              evidenceHash: createHash("sha256")
                .update(JSON.stringify(row))
                .digest("hex"),
              capturedAt: report.generatedAt,
            }),
            JSON.stringify(row),
            "Quarantined by Phase 02 audit; manual mapping is required",
          ],
        );
      }
      await client.query("COMMIT");
    }

    const outDir = path.resolve("docs/reports");
    mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, "phase-02-legacy-audit.json");
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, reportFile: out }, null, 2));
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}