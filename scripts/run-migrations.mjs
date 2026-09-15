#!/usr/bin/env node
/**
 * Ordered SQL migration runner for the production portal.
 *
 * The runner keeps a checksum and execution duration for every migration,
 * refuses checksum drift, runs one migration per transaction, and emits a
 * machine-readable report. It does not silently skip a partial baseline.
 */
import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pkg from "pg";

const { Pool } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const migrationsDir = path.join(root, "migrations");
const baselineSchemaPath = path.join(
  root,
  "drizzle",
  "0000_0000_initial_schema.sql",
);
const runnerVersion = "phase1-1";
const runId = `migration-${new Date().toISOString()}-${randomUUID().slice(0, 8)}`;

function checksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

function migrationFiles() {
  return readdirSync(migrationsDir)
    .filter((file) => /^\d{4}.*\.sql$/.test(file))
    .sort();
}

function validateFiles(files) {
  const seen = new Set();
  for (const file of files) {
    const number = file.slice(0, 4);
    if (seen.has(number)) throw new Error(`تكرار رقم migration: ${number}`);
    seen.add(number);
    if (!readFileSync(path.join(migrationsDir, file), "utf8").trim()) {
      throw new Error(`ملف migration فارغ: ${file}`);
    }
  }
  if (!existsSync(baselineSchemaPath)) {
    throw new Error(`ملف baseline غير موجود: ${baselineSchemaPath}`);
  }
}

async function ensureLedger(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "_migrations_applied" (
      filename text PRIMARY KEY,
      checksum text,
      applied_at timestamptz NOT NULL DEFAULT now(),
      duration_ms integer,
      runner_version text
    )
  `);
  await pool.query(`
    ALTER TABLE "_migrations_applied"
      ADD COLUMN IF NOT EXISTS checksum text,
      ADD COLUMN IF NOT EXISTS duration_ms integer,
      ADD COLUMN IF NOT EXISTS runner_version text
  `);
}

async function ensureBaselineSchema(pool, report) {
  const { rows } = await pool.query(`
    SELECT
      to_regclass('public.system_users') AS system_users,
      to_regclass('public.inventory_items') AS inventory_items,
      to_regclass('public.contacts') AS contacts
  `);
  const baseline = rows[0];
  if (baseline.system_users && baseline.inventory_items && baseline.contacts) {
    report.checks.baseline = "present";
    return;
  }

  const present = [
    baseline.system_users,
    baseline.inventory_items,
    baseline.contacts,
  ].filter(Boolean).length;
  if (present > 0) {
    throw new Error(
      "قاعدة البيانات تحتوي جزءًا من baseline فقط؛ أوقف الترحيل وافحصها يدويًا.",
    );
  }

  const baselineSql = readFileSync(baselineSchemaPath, "utf8").replaceAll(
    /--> statement-breakpoint/g,
    "",
  );
  const started = Date.now();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(baselineSql);
    await client.query(
      `INSERT INTO "_migrations_applied"
       (filename, checksum, duration_ms, runner_version)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (filename) DO UPDATE SET
         checksum = EXCLUDED.checksum,
         duration_ms = EXCLUDED.duration_ms,
         runner_version = EXCLUDED.runner_version`,
      [
        "0000_0000_initial_schema.sql",
        checksum(baselineSql),
        Date.now() - started,
        runnerVersion,
      ],
    );
    await client.query("COMMIT");
    report.checks.baseline = "bootstrapped";
    report.applied.push({
      file: "0000_0000_initial_schema.sql",
      durationMs: Date.now() - started,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL is required. No migration was executed.");
    process.exit(1);
  }

  const files = migrationFiles();
  validateFiles(files);
  const report = {
    runId,
    runnerVersion,
    startedAt: new Date().toISOString(),
    checks: {
      fileOrder: "ok",
      baseline: "not_checked",
      checksumDrift: "not_checked",
    },
    pending: [],
    applied: [],
  };

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.PGSSL_STRICT === "true" ?
        true
      : { rejectUnauthorized: false },
  });

  try {
    await ensureLedger(pool);
    await ensureBaselineSchema(pool, report);

    const { rows: appliedRows } = await pool.query(
      `SELECT filename, checksum FROM "_migrations_applied"`,
    );
    const appliedByFile = new Map(
      appliedRows.map((row) => [row.filename, row]),
    );

    for (const file of files) {
      const sql = readFileSync(path.join(migrationsDir, file), "utf8");
      const currentChecksum = checksum(sql);
      const previous = appliedByFile.get(file);
      if (previous?.checksum && previous.checksum !== currentChecksum) {
        report.checks.checksumDrift = "blocked";
        throw new Error(`checksum drift detected for ${file}`);
      }
      if (previous) {
        if (!previous.checksum) {
          await pool.query(
            `UPDATE "_migrations_applied" SET checksum = $2, runner_version = COALESCE(runner_version, $3) WHERE filename = $1`,
            [file, currentChecksum, runnerVersion],
          );
        }
        report.pending.push({ file, state: "already_applied" });
        continue;
      }

      report.pending.push({ file, state: "pending" });
      const started = Date.now();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        const durationMs = Date.now() - started;
        await client.query(
          `INSERT INTO "_migrations_applied"
           (filename, checksum, duration_ms, runner_version)
           VALUES ($1, $2, $3, $4)`,
          [file, currentChecksum, durationMs, runnerVersion],
        );
        await client.query("COMMIT");
        report.applied.push({ file, durationMs });
        console.log(`✅ ${file} (${durationMs}ms)`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`${file} failed and was rolled back: ${error.message}`);
      } finally {
        client.release();
      }
    }

    report.checks.checksumDrift = "ok";
    report.finishedAt = new Date().toISOString();
    report.pendingCount = report.pending.filter(
      (entry) => entry.state === "pending",
    ).length;
    console.log(`MIGRATION_REPORT ${JSON.stringify(report)}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`❌ Migration preflight/runner stopped: ${error.message}`);
  process.exit(1);
});