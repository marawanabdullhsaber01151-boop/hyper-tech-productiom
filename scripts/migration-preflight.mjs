#!/usr/bin/env node
/**
 * Safe, dependency-light migration preflight.
 * It reports blockers before db:migrate mutates a database.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pkg from "pg";

const { Pool } = pkg;
const root = path.resolve(process.cwd());
const migrationsDir = path.join(root, "migrations");
const files = existsSync(migrationsDir) ?
  readdirSync(migrationsDir)
    .filter((file) => /^\d{4}.*\.sql$/.test(file))
    .sort()
: [];
const blockers = [];
const warnings = [];
const seenNumbers = new Set();

for (const file of files) {
  const number = file.slice(0, 4);
  if (seenNumbers.has(number)) blockers.push(`duplicate migration number: ${number}`);
  seenNumbers.add(number);
  const content = readFileSync(path.join(migrationsDir, file), "utf8");
  if (!content.trim()) blockers.push(`empty migration: ${file}`);
  if (/\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(content)) {
    warnings.push(`destructive SQL requires review: ${file}`);
  }
  if (/\bTRUNCATE\b/i.test(content)) {
    warnings.push(`TRUNCATE requires review: ${file}`);
  }
}

if (!existsSync(path.join(root, "drizzle", "0000_0000_initial_schema.sql"))) {
  blockers.push("missing canonical baseline: drizzle/0000_0000_initial_schema.sql");
}
if (!files.length) blockers.push("no numbered migrations found");

const report = {
  checkedAt: new Date().toISOString(),
  migrationCount: files.length,
  first: files[0] ?? null,
  last: files.at(-1) ?? null,
  blockers,
  warnings,
  checks: {
    contiguousNaming: blockers.every((entry) => !entry.startsWith("duplicate migration number")),
    baselinePresent: existsSync(
      path.join(root, "drizzle", "0000_0000_initial_schema.sql"),
    ),
    checksums: Object.fromEntries(
      files.map((file) => [
        file,
        createHash("sha256")
          .update(readFileSync(path.join(migrationsDir, file)))
          .digest("hex"),
      ]),
    ),
  },
  database: { configured: Boolean(process.env.DATABASE_URL), applied: null },
};

if (process.env.DATABASE_URL && blockers.length === 0) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.PGSSL_STRICT === "true" ?
        true
      : { rejectUnauthorized: false },
  });
  try {
    const result = await pool.query(`
      SELECT filename, checksum, applied_at
      FROM "_migrations_applied"
      ORDER BY filename
    `);
    report.database.applied = result.rows.map((row) => ({
      ...row,
      drift:
        row.checksum &&
        report.checks.checksums[row.filename] &&
        row.checksum !== report.checks.checksums[row.filename],
    }));
    if (report.database.applied.some((row) => row.drift)) {
      blockers.push("database migration checksum drift detected");
    }
  } catch (error) {
    warnings.push(
      `database ledger could not be read (migration 0054 may not be applied): ${error.message}`,
    );
  } finally {
    await pool.end();
  }
}

console.log(JSON.stringify(report, null, 2));
if (blockers.length) process.exit(1);