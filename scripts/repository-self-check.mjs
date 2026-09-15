#!/usr/bin/env node
/**
 * Safe repository self-check. It only reads the working tree.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const requiredFiles = [
  "src/main.ts",
  "src/routes/health.ts",
  "drizzle/0000_0000_initial_schema.sql",
  "migrations/0054_phase1_baseline_metadata.sql",
  "public/login.html",
  "public/index.html",
];
const blockers = requiredFiles
  .filter((file) => !existsSync(path.join(root, file)))
  .map((file) => `missing required file: ${file}`);
const warnings = [];
const migrations = readdirSync(path.join(root, "migrations"))
  .filter((file) => /^\d{4}.*\.sql$/.test(file))
  .sort();
const numbers = new Set();
for (const file of migrations) {
  const number = file.slice(0, 4);
  if (numbers.has(number)) blockers.push(`duplicate migration number: ${number}`);
  numbers.add(number);
}
for (const script of ["build", "db:migrate", "db:preflight", "audit:phase1", "test"]) {
  if (!packageJson.scripts?.[script]) warnings.push(`missing package script: ${script}`);
}

const report = {
  checkedAt: new Date().toISOString(),
  status: blockers.length ? "blocked" : "ok",
  filesChecked: requiredFiles.length,
  migrationCount: migrations.length,
  blockers,
  warnings,
  commands: {
    build: packageJson.scripts?.build ?? null,
    migrate: packageJson.scripts?.["db:migrate"] ?? null,
    test: packageJson.scripts?.test ?? null,
  },
};
console.log(JSON.stringify(report, null, 2));
if (blockers.length) process.exit(1);