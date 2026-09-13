#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const permissionsSource = readFileSync(
  resolve(projectRoot, "src/lib/permissions.ts"),
  "utf8",
);
const departmentsSource = readFileSync(
  resolve(projectRoot, "src/lib/departments.ts"),
  "utf8",
);

const pageRules = [
  {
    page: "portal.html",
    backend: null,
    permission: "public portal/customer session",
  },
  {
    page: "portal-login.html",
    backend: null,
    permission: "public portal authentication",
  },
  {
    page: "portal-orders.html",
    backend: ["sales", "write"],
    permission: "PERMISSIONS.sales.write",
  },
  {
    page: "portal-customers-admin.html",
    backend: ["portalCustomers", "write"],
    permission: "PERMISSIONS.portalCustomers.write",
  },
  {
    page: "portal-applications-admin.html",
    backend: ["portalCustomers", "write"],
    permission: "PERMISSIONS.portalCustomers.write",
  },
  {
    page: "portal-activation-requests-admin.html",
    backend: ["portalCustomers", "write"],
    permission: "PERMISSIONS.portalCustomers.write",
  },
];

function extractPermissionRoles(group, key) {
  if (!group) return [];
  const groupStart = permissionsSource.indexOf(`${group}: {`);
  if (groupStart < 0) {
    throw new Error(`Could not find PERMISSIONS.${group}`);
  }
  const groupEnd = permissionsSource.indexOf("\n  },", groupStart);
  const groupSource = permissionsSource.slice(
    groupStart,
    groupEnd < 0 ? permissionsSource.length : groupEnd,
  );
  const match = groupSource.match(
    new RegExp(`${key}:\\s*\\[([\\s\\S]*?)\\]`),
  );
  if (!match) {
    throw new Error(`Could not find PERMISSIONS.${group}.${key}`);
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function extractHtmlRoles(page) {
  const source = readFileSync(resolve(projectRoot, "public", page), "utf8");
  const match = source.match(/data-allowed-roles="([^"]*)"/);
  return match
    ? match[1].split(",").map((role) => role.trim()).filter(Boolean)
    : [];
}

function extractNavRoles(page) {
  const escapedPage = page.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = departmentsSource.match(
    new RegExp(
      `href:\\s*"${escapedPage}",\\s*roles:\\s*\\[([^\\]]*)\\]`,
    ),
  );
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function sortedRoles(roles) {
  return [...new Set(roles)].sort();
}

function sameRoles(left, right) {
  return JSON.stringify(sortedRoles(left)) === JSON.stringify(sortedRoles(right));
}

const failures = [];
const rows = [];

for (const rule of pageRules) {
  const frontendRoles = extractHtmlRoles(rule.page);
  const navRoles = extractNavRoles(rule.page);
  const backendRoles = rule.backend
    ? extractPermissionRoles(rule.backend[0], rule.backend[1])
    : [];

  if (!rule.backend) {
    if (frontendRoles.length || navRoles.length) {
      failures.push(
        `${rule.page}: public page must not declare employee roles in HTML or nav`,
      );
    }
    rows.push({
      page: rule.page,
      frontend: "عام / عميل بوابة",
      nav: "غير موجود",
      backend: rule.permission,
      status: "OK",
    });
    continue;
  }

  if (!sameRoles(frontendRoles, backendRoles)) {
    failures.push(
      `${rule.page}: HTML roles do not match ${rule.permission}`,
    );
  }
  if (!sameRoles(navRoles, backendRoles)) {
    failures.push(
      `${rule.page}: nav roles do not match ${rule.permission}`,
    );
  }

  rows.push({
    page: rule.page,
    frontend: sortedRoles(frontendRoles).join(", "),
    nav: sortedRoles(navRoles).join(", "),
    backend: sortedRoles(backendRoles).join(", "),
    status:
      sameRoles(frontendRoles, backendRoles) &&
      sameRoles(navRoles, backendRoles)
        ? "OK"
        : "MISMATCH",
  });
}

for (const row of rows) {
  console.log(
    `${row.status.padEnd(8)} ${row.page}\n` +
      `  frontend: ${row.frontend}\n` +
      `  nav:      ${row.nav}\n` +
      `  backend:  ${row.backend}`,
  );
}

if (failures.length) {
  console.error("\nRole consistency check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nRole consistency check passed.");
}