/** @format */
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { portalApplicationsTable, portalCustomersTable } from "../db/schema";
import { describeAudit, formatAuditTime, type AuditRowLike } from "./auditNarrative";

/** بيضيف لكل صف: sentence (إيه حصل) و whenText (امتى لحد الدقيقة). */
export async function enrichAuditRows<T extends AuditRowLike>(rows: T[]) {
  const companyIds = new Set<number>();
  const appIds = new Set<number>();
  for (const r of rows) {
    if (r.resourceId == null) continue;
    if (r.resourceType === "portal_customer" || /portal-(companies|customers)/.test(r.actionKey)) companyIds.add(r.resourceId);
    if (r.resourceType === "portal_application" || /applications/.test(r.actionKey)) appIds.add(r.resourceId);
  }
  const companies = new Map<number, string>();
  const applications = new Map<number, string>();
  if (companyIds.size) {
    for (const c of await db.select({ id: portalCustomersTable.id, name: portalCustomersTable.companyName }).from(portalCustomersTable).where(inArray(portalCustomersTable.id, [...companyIds]))) companies.set(c.id, c.name);
  }
  if (appIds.size) {
    for (const a of await db.select({ id: portalApplicationsTable.id, name: portalApplicationsTable.companyName }).from(portalApplicationsTable).where(inArray(portalApplicationsTable.id, [...appIds]))) applications.set(a.id, a.name);
  }
  return rows.map((r) => ({ ...r, sentence: describeAudit(r, { companies, applications }), whenText: formatAuditTime(r.createdAt) }));
}
