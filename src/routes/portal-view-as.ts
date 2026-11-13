/** @format */
// «شاهد كما يراه العميل» (الخطوة 47): نسخة قراءة فقط من اللي العميل بيشوفه، للإدارة والمبيعات.
// كل فتح بيتسجّل في سجل النشاط باسم الموظف وسببه، ومفيش أي مسار كتابة هنا.
import { Router } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, contactsTable } from "../db";
import {
  portalCustomersTable,
  portalMembersTable,
  portalNotificationsTable,
  portalOrderReviewsTable,
  portalRolesTable,
  portalUsersTable,
  productionWorkflowOrdersTable,
} from "../db/schema";
import { inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { PERMISSIONS } from "../lib/permissions";
import { writeAuditEvent } from "../lib/governance";
import { parseIdParam } from "../lib/validate";
import { computeBatchRollupStatus, toPortalOrderItem } from "../domain/portal-orders";
import { portalQuoteItems } from "./price-quotes";
import { portalAgreementItems } from "./price-agreements";

const router = Router();
const body = z.object({ reason: z.string().trim().min(3, "اكتب سبب الفتح (3 حروف على الأقل)").max(300) });

router.post("/portal-companies/:id/view-as", requireAuth, requireRole(...PERMISSIONS.portalCompanies.view), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const { reason } = body.parse(req.body ?? {});
    const [row] = await db
      .select({ portal: portalCustomersTable, contact: contactsTable })
      .from(portalCustomersTable)
      .innerJoin(contactsTable, eq(portalCustomersTable.contactId, contactsTable.id))
      .where(eq(portalCustomersTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: { code: "PORTAL_CUSTOMER_NOT_FOUND", message: "الشركة مش موجودة" } });
      return;
    }

    // التسجيل الأول: لو فشل ما نعرضش حاجة. الدخول لازم يبقى مسجّل قبل ما البيانات تطلع.
    await writeAuditEvent({
      actorUserId: req.user!.userId,
      actorName: req.user!.username,
      actionKey: "portal.customer_view",
      resourceType: "portal_company",
      resourceId: id,
      afterData: { company: row.contact.company || row.portal.companyName, sections: ["profile", "orders", "quotes", "agreements", "team", "notices"] },
      reason,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    const rawOrders = await db
      .select()
      .from(productionWorkflowOrdersTable)
      .where(eq(productionWorkflowOrdersTable.portalCustomerId, id))
      .orderBy(desc(productionWorkflowOrdersTable.createdAt))
      .limit(30);
    const refs = [...new Set(rawOrders.map((o) => o.salesOrderRef || o.orderNumber))];
    const reviews = refs.length ? await db.select().from(portalOrderReviewsTable).where(inArray(portalOrderReviewsTable.batchRef, refs)) : [];
    const reviewed = new Set(reviews.map((r) => r.batchRef));
    const batches = new Map<string, { batchRef: string; createdAt: Date; items: ReturnType<typeof toPortalOrderItem>[]; statuses: string[] }>();
    for (const o of rawOrders) {
      const ref = o.salesOrderRef || o.orderNumber;
      const b = batches.get(ref) ?? { batchRef: ref, createdAt: o.createdAt, items: [], statuses: [] };
      b.items.push(toPortalOrderItem(o as never));
      b.statuses.push(o.workflowStatus);
      batches.set(ref, b);
    }
    const orders = [...batches.values()].map((b) => ({
      batchRef: b.batchRef,
      createdAt: b.createdAt,
      overallStatus: computeBatchRollupStatus({ itemStatuses: b.statuses, hasReview: reviewed.has(b.batchRef) }),
      items: b.items,
    }));

    const team = await db
      .select({ id: portalMembersTable.id, fullName: portalUsersTable.fullName, roleName: portalRolesTable.name, status: portalMembersTable.status, isOwner: portalMembersTable.isOwner })
      .from(portalMembersTable)
      .innerJoin(portalUsersTable, eq(portalUsersTable.id, portalMembersTable.userId))
      .innerJoin(portalRolesTable, eq(portalRolesTable.id, portalMembersTable.roleId))
      .where(and(eq(portalMembersTable.companyId, id), eq(portalMembersTable.status, "active")));

    const notices = await db
      .select({ id: portalNotificationsTable.id, title: portalNotificationsTable.title, body: portalNotificationsTable.body, createdAt: portalNotificationsTable.createdAt, isRead: portalNotificationsTable.isRead })
      .from(portalNotificationsTable)
      .where(and(eq(portalNotificationsTable.portalCustomerId, id), isNull(portalNotificationsTable.memberId)))
      .orderBy(desc(portalNotificationsTable.createdAt))
      .limit(10);

    res.json({
      profile: {
        id: row.portal.id,
        companyName: row.contact.company || row.portal.companyName,
        fullName: row.contact.name,
        phone: row.contact.phone || row.portal.phone,
        email: row.contact.email || row.portal.email,
        address: row.contact.address,
        city: row.contact.city || row.portal.city,
      },
      orders,
      quotes: await portalQuoteItems(id),
      agreements: await portalAgreementItems(id),
      team,
      notices,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
