#!/usr/bin/env node
/**
 * Phase 00 baseline audit.
 *
 * This is intentionally dependency-free and reads the repository itself.
 * It does not trust PROJECT_STATUS.md or any previous manifest as evidence.
 * The generated JSON is the machine-readable baseline inventory required by
 * the Phase 00 prompt.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(process.cwd());
const sourceRoots = ["src", "public", "migrations", "e2e", "scripts"];
const ignored = new Set(["node_modules", ".git", "dist", ".cache"]);

function walk(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(absolute));
    else result.push(absolute);
  }
  return result;
}

function rel(path) {
  return relative(root, path).replaceAll("\\", "/");
}

function text(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function unique(values) {
  return [...new Set(values)].sort();
}

function extractStrings(value) {
  return [...value.matchAll(/["'`]([^"'`]+)["'`]/g)].map((match) => match[1]);
}

function lineNumber(value, index) {
  return value.slice(0, index).split("\n").length;
}

const files = sourceRoots.flatMap((directory) => walk(join(root, directory)));
const sourceFiles = files.filter((file) => /\.(?:ts|mjs|js)$/.test(file));
const schemaFiles = sourceFiles.filter((file) => file.includes("/src/db/schema/"));
const routeFiles = sourceFiles.filter((file) => file.includes("/src/routes/"));
const migrationFiles = files.filter((file) => /\/migrations\/\d+.*\.sql$/.test(file));
const publicPages = files.filter((file) => /\/public\/[^/]+\.html$/.test(file));
const testFiles = files.filter((file) => /\.(?:test|e2e\.test)\.(?:ts|js|mjs)$/.test(file));

const routes = [];
for (const file of [...routeFiles, join(root, "src/main.ts")].filter(existsSync)) {
  const contents = text(file);
  for (const match of contents.matchAll(/\b(router|app)\.(get|post|put|patch|delete|options)\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
    const start = match.index ?? 0;
    const context = contents.slice(start, start + 700);
    routes.push({
      file: rel(file),
      line: lineNumber(contents, start),
      owner: match[1],
      method: match[2].toUpperCase(),
      path: match[3],
      apiPath: match[3].startsWith("/api/") ? match[3] : `/api/v1${match[3]}`,
      protectedByAuth: /requireAuth|requirePortalAuth|requireCustomerAuth/.test(context),
      protectedByRole: /requireRole|requirePermission|requirePermissions|requireSettings/.test(context),
    });
  }
}

const tableDefinitions = [];
for (const file of schemaFiles) {
  const contents = text(file);
  for (const match of contents.matchAll(/\b(?:pgTable|mysqlTable|sqliteTable)\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
    tableDefinitions.push({
      table: match[1],
      file: rel(file),
      line: lineNumber(contents, match.index ?? 0),
    });
  }
}

const migrationInventory = migrationFiles.map((file) => {
  const contents = text(file);
  return {
    file: rel(file),
    sha256: createHash("sha256").update(contents).digest("hex"),
    bytes: Buffer.byteLength(contents),
    createsTables: unique([...contents.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["']?([a-zA-Z0-9_]+)/gi)].map((match) => match[1])),
    altersTables: unique([...contents.matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?["']?([a-zA-Z0-9_]+)/gi)].map((match) => match[1])),
  };
});
const baselineSchemaFile = join(root, "drizzle/0000_0000_initial_schema.sql");
const baselineSchemaTables = existsSync(baselineSchemaFile)
  ? unique([...text(baselineSchemaFile).matchAll(/CREATE TABLE\s+["']?([a-zA-Z0-9_]+)/gi)].map((match) => match[1]))
  : [];

const rolesFile = join(root, "src/lib/roles.ts");
const rolesContents = text(rolesFile);
const rolesMatch = rolesContents.match(/export\s+const\s+USER_ROLES\s*=\s*\[([\s\S]*?)\]\s+as\s+const/);
const declaredRoles = unique(
  rolesMatch ? extractStrings(rolesMatch[1]) : [],
);
const frontendRoles = publicPages.flatMap((file) => {
  const contents = text(file);
  const roleMatch = contents.match(/data-allowed-roles\s*=\s*["']([^"']+)["']/);
  return roleMatch
    ? roleMatch[1].split(",").map((role) => role.trim()).filter(Boolean).map((role) => ({ role, file: rel(file) }))
    : [];
});
const codeRoleCandidates = [];
for (const file of sourceFiles) {
  const contents = text(file);
  for (const match of contents.matchAll(/["']([a-z][a-z0-9_]{2,40})["']/g)) {
    const candidate = match[1];
    if (declaredRoles.includes(candidate)) codeRoleCandidates.push(candidate);
  }
}

const actionRegistry = [];
const actionFile = join(root, "src/lib/actionRegistry.ts");
const actionContents = text(actionFile);
for (const match of actionContents.matchAll(/\{\s*key:\s*["'`]([^"'`]+)["'`][\s\S]*?defaultRoles:\s*([A-Z0-9_]+)/g)) {
  actionRegistry.push({ key: match[1], rolesConstant: match[2] });
}
const permissionKeys = [];
for (const file of sourceFiles) {
  const contents = text(file);
  for (const match of contents.matchAll(/requirePermission(?:s)?\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
    permissionKeys.push({ key: match[1], file: rel(file), line: lineNumber(contents, match.index ?? 0) });
  }
}

const settingKeys = [];
const notificationTypes = [];
for (const file of sourceFiles) {
  const contents = text(file);
  for (const match of contents.matchAll(/(?:getSystemSetting|setSystemSetting|getSetting|key)\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
    settingKeys.push({ key: match[1], file: rel(file), line: lineNumber(contents, match.index ?? 0) });
  }
  if (/notification/i.test(file)) {
    for (const match of contents.matchAll(/\btype\s*:\s*["'`]([^"'`]+)["'`]/g)) {
      notificationTypes.push({ type: match[1], file: rel(file), line: lineNumber(contents, match.index ?? 0) });
    }
  }
}

const statusSources = [
  "src/domain/production-status.ts",
  "src/domain/production-cycle.ts",
  "src/db/schema/production-workflow.ts",
  "src/db/schema/sales.ts",
  "src/db/schema/operations.ts",
  "src/db/schema/operations-control.ts",
  "src/db/schema/planning.ts",
].filter((file) => existsSync(join(root, file)));
const statuses = statusSources.map((file) => {
  const contents = text(join(root, file));
  const values = unique(
    [...contents.matchAll(/["'`]([a-z][a-z0-9_]{2,80})["'`]/g)]
      .map((match) => match[1])
      .filter((value) => value.includes("_") || ["new", "draft", "active", "inactive", "approved", "cancelled", "completed"].includes(value)),
  );
  return { file, values };
});

const pageInventory = publicPages.map((file) => {
  const contents = text(file);
  return {
    file: rel(file),
    lang: contents.match(/<html[^>]*\blang=["']([^"']+)/i)?.[1] ?? null,
    dir: contents.match(/<html[^>]*\bdir=["']([^"']+)/i)?.[1] ?? null,
    allowedRoles: contents.match(/data-allowed-roles=["']([^"']+)/i)?.[1]?.split(",").map((item) => item.trim()).filter(Boolean) ?? [],
    scripts: [...contents.matchAll(/<script[^>]+src=["']([^"']+)/gi)].map((match) => match[1]),
    styles: [...contents.matchAll(/<link[^>]+href=["']([^"']+\.css[^"']*)/gi)].map((match) => match[1]),
  };
});

const duplicateRoutes = Object.entries(
  routes.reduce((map, route) => {
    const key = `${route.method} ${route.apiPath}`;
    (map[key] ??= []).push(route);
    return map;
  }, {}),
).filter(([, matches]) => matches.length > 1).map(([key, matches]) => ({ key, matches }));

const duplicateTables = Object.entries(
  tableDefinitions.reduce((map, table) => {
    (map[table.table] ??= []).push(table);
    return map;
  }, {}),
).filter(([, matches]) => matches.length > 1).map(([table, matches]) => ({ table, matches }));

const migrationTables = unique(migrationInventory.flatMap((migration) => migration.createsTables));
const schemaTables = unique(tableDefinitions.map((table) => table.table));
const schemaTablesWithoutAnyDeliverySource = schemaTables.filter(
  (table) => !migrationTables.includes(table) && !baselineSchemaTables.includes(table),
);
const frontendRoleDrift = frontendRoles.filter((entry) => !declaredRoles.includes(entry.role));
const unmountedRouteModules = routeFiles
  .map((file) => rel(file))
  .filter((file) => !file.endsWith(".test.ts"))
  .filter((file) => {
    const base = file.split("/").pop().replace(/\.(ts|mjs)$/, "");
    return !new RegExp(`from\\s+["']\\.\\/routes\\/${base}["']`).test(text(join(root, "src/main.ts")));
  });
const intentionalLegacyModules = ["src/routes/production.ts"];
const unexpectedUnmountedRouteModules = unmountedRouteModules.filter(
  (file) => !intentionalLegacyModules.includes(file),
);

const databaseVerified = Boolean(process.env.DATABASE_URL);
const inventory = {
  generatedAt: new Date().toISOString(),
  repository: {
    root: rel(root) || ".",
    packageManager: existsSync(join(root, "package-lock.json")) ? "npm" : "unknown",
    nodeEngine: JSON.parse(text(join(root, "package.json")) || "{}").engines?.node ?? null,
  },
  counts: {
    routes: routes.length,
    pages: pageInventory.length,
    schemaTables: schemaTables.length,
    migrationFiles: migrationInventory.length,
    declaredRoles: declaredRoles.length,
    actionRegistryEntries: actionRegistry.length,
    testFiles: testFiles.length,
  },
  routes,
  pages: pageInventory,
  tables: { schemaDefinitions: tableDefinitions, migrationTables, schemaTables },
  migrations: migrationInventory,
  roles: {
    declared: declaredRoles,
    frontendRoleDrift,
    referencedDeclaredRoles: unique(codeRoleCandidates),
  },
  permissions: { actionRegistry, explicitPermissionCalls: permissionKeys },
  statuses,
  settings: { literalCandidates: settingKeys },
  notifications: { literalTypes: notificationTypes },
  tests: testFiles.map((file) => rel(file)).sort(),
  findings: {
    duplicateRoutes,
    duplicateTables,
    frontendRoleDrift,
    unmountedRouteModules,
    intentionalLegacyModules,
    unexpectedUnmountedRouteModules,
    schemaTablesWithoutMigrationCreate: schemaTables.filter((table) => !migrationTables.includes(table)),
    baselineSchemaTables,
    schemaTablesWithoutAnyDeliverySource,
    migrationTablesWithoutSchemaDefinition: migrationTables.filter((table) => !schemaTables.includes(table)),
    databaseVerified,
  },
  sourcesOfTruth: {
    roles: "src/lib/roles.ts",
    fineGrainedPermissions: "src/lib/actionRegistry.ts",
    productionLifecycle: "src/domain/production-status.ts",
    productionStageProjection: "src/domain/production-cycle.ts",
    databaseDelivery: "migrations/*.sql via scripts/run-migrations.mjs",
    apiMount: "src/main.ts",
    notificationPersistence: "src/lib/notifications.ts and src/lib/portalNotifications.ts",
  },
};

const outputDir = join(root, "docs/audits");
mkdirSync(outputDir, { recursive: true });
const jsonPath = join(outputDir, "phase-00-baseline-inventory.json");
const reportPath = join(outputDir, "phase-00-baseline-report.md");
writeFileSync(jsonPath, `${JSON.stringify(inventory, null, 2)}\n`);
const report = `# Phase 00 Baseline Audit

Generated from repository inspection by \`scripts/phase0-baseline-audit.mjs\`.

## Verification boundary

- Static repository audit: **complete**
- PostgreSQL schema/data verification: **${databaseVerified ? "configured and ready to run" : "not verified — DATABASE_URL is absent"}**
- Authenticated end-to-end verification: **${databaseVerified ? "requires an explicit test database/session run" : "blocked until DATABASE_URL is configured"}**
- Overall Phase 00 closure: **${databaseVerified ? "static audit complete; live checks still required" : "not closable as 100% because live checks are unavailable"}**

## Inventory counts

| Surface | Count |
|---|---:|
| API route declarations | ${routes.length} |
| Public HTML pages | ${pageInventory.length} |
| Drizzle schema tables | ${schemaTables.length} |
| Ordered SQL migrations | ${migrationInventory.length} |
| Declared roles | ${declaredRoles.length} |
| Fine-grained action definitions | ${actionRegistry.length} |
| Test files | ${testFiles.length} |

## Static findings

- Duplicate route declarations: **${duplicateRoutes.length}**
- Duplicate schema table definitions: **${duplicateTables.length}**
- Frontend roles not present in \`USER_ROLES\`: **${frontendRoleDrift.length}**
- Route modules not directly detected as mounted in \`src/main.ts\`: **${unmountedRouteModules.length}**
- Intentional legacy/unmounted route modules: **${intentionalLegacyModules.length}**
- Unexpected unmounted route modules: **${unexpectedUnmountedRouteModules.length}**
- Schema tables without a migration CREATE match: **${inventory.findings.schemaTablesWithoutMigrationCreate.length}**
- Those tables are supplied by the canonical drizzle baseline and bootstrapped by the migration runner: **${baselineSchemaTables.length}**
- Schema tables without any baseline or migration delivery source: **${schemaTablesWithoutAnyDeliverySource.length}**
- Migration-created tables without a Drizzle schema definition: **${inventory.findings.migrationTablesWithoutSchemaDefinition.length}**

The complete machine-readable inventory, including file/line evidence, is in
\`docs/audits/phase-00-baseline-inventory.json\`.
`;
writeFileSync(reportPath, report);
console.log(JSON.stringify({
  json: rel(jsonPath),
  report: rel(reportPath),
  counts: inventory.counts,
  findings: inventory.findings,
}, null, 2));