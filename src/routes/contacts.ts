/** @format */

import { Router } from "express";
import { eq, and, desc, ilike, or, ne, sql } from "drizzle-orm";
import {
  db,
  contactsTable,
  createContactSchema,
  insertContactSchema,
  portalCustomersTable,
  inventoryItemsTable,
} from "../db";
import { purchaseOrdersTable } from "../db/schema";
import { deleteBlocker, isSellerRole, phoneKey } from "../lib/contactsCore";
import {
  requireAuth,
  requireRole,
  requirePermission,
} from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { moveToTrash } from "../lib/trash";
import { PERMISSIONS } from "../lib/permissions";
import { salesOrdersTable } from "../db";
import { writeAuditEvent } from "../lib/governance";
import { z } from "zod";

const router = Router();

/** البائع يشوف جهات الاتصال اللي هو أضافها، أو اللي عملها فواتير بنفسه. */
const sellerScope = (userId: number) =>
  sql`(${contactsTable.ownerUserId} = ${userId} or ${contactsTable.id} in (select contact_id from sales_orders where created_by_id = ${userId} and contact_id is not null))`;

async function canAccessContact(contact: { id: number; ownerUserId: number | null }, user: { userId: number; role: string }) {
  if (!isSellerRole(user.role) || contact.ownerUserId === user.userId) return true;
  const [ownedOrder] = await db.select({ id: salesOrdersTable.id }).from(salesOrdersTable)
    .where(and(eq(salesOrdersTable.contactId, contact.id), eq(salesOrdersTable.createdById, user.userId))).limit(1);
  return !!ownedOrder;
}

const FORBIDDEN = { error: { message: "لا يمكنك الوصول إلى هذا العميل" } };

// GET /api/v1/contacts/search — بحث صغير للربط اليدوي بطلبات تفعيل البوابة
router.get(
  "/contacts/search",
  requireAuth,
  requireRole(...PERMISSIONS.contacts.view),
  async (req, res, next) => {
    try {
      const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
      if (query.length < 2) {
        res.status(400).json({ error: { code: "INVALID_SEARCH", message: "اكتب حرفين على الأقل للبحث" } });
        return;
      }

      const pattern = `%${query}%`;
      const contacts = await db
        .select({
          id: contactsTable.id,
          name: contactsTable.name,
          company: contactsTable.company,
          phone: contactsTable.phone,
          email: contactsTable.email,
          type: contactsTable.type,
        })
        .from(contactsTable)
        .where(or(
          ilike(contactsTable.name, pattern),
          ilike(contactsTable.company, pattern),
          ilike(contactsTable.phone, pattern),
        ))
        .orderBy(contactsTable.name)
        .limit(25);
      res.json(contacts);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/contacts/duplicate-check",
  requireAuth,
  requireRole(...PERMISSIONS.contacts.view),
  async (req, res, next) => {
    try {
      const phone = typeof req.query.phone === "string" ? req.query.phone.trim() : "";
      const company = typeof req.query.company === "string" ? req.query.company.trim() : "";
      const excludeId = typeof req.query.excludeId === "string" ? Number(req.query.excludeId) : null;
      if (!phoneKey(phone) && !company) {
        res.json({ matches: [] });
        return;
      }

      const filters = [];
      const key = phoneKey(phone);
      if (key) {
        filters.push(
          key.length === 10
            ? sql`right(regexp_replace(coalesce(${contactsTable.phone}, ''), '[^0-9]', '', 'g'), 10) = ${key}`
            : sql`regexp_replace(coalesce(${contactsTable.phone}, ''), '[^0-9]', '', 'g') = ${key}`,
        );
      }
      if (company) filters.push(ilike(contactsTable.company, company));
      const exclude = excludeId && Number.isInteger(excludeId) ? ne(contactsTable.id, excludeId) : undefined;

      const matches = await db
        .select({
          id: contactsTable.id,
          name: contactsTable.name,
          company: contactsTable.company,
          phone: contactsTable.phone,
        })
        .from(contactsTable)
        .where(exclude ? and(or(...filters), exclude) : or(...filters))
        .limit(5);
      res.json({ matches });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/contacts/overview — قايمة جهات الاتصال مع عدّادات النشاط (فواتير مبيعات / أوامر شراء)
router.get(
  "/contacts/overview",
  requireAuth,
  requireRole(...PERMISSIONS.contacts.view),
  async (req, res, next) => {
    try {
      const seller = isSellerRole(req.user!.role);
      const uid = req.user!.userId;
      const salesCount = seller
        ? sql<number>`(select count(*)::int from sales_orders so where so.contact_id = ${contactsTable.id} and so.created_by_id = ${uid})`
        : sql<number>`(select count(*)::int from sales_orders so where so.contact_id = ${contactsTable.id})`;
      // أوامر الشراء مش شغل البائع، فمش بنبعتها له.
      const poCount = seller ? sql<number>`0` : sql<number>`(select count(*)::int from purchase_orders po where po.supplier_id = ${contactsTable.id})`;
      const rows = await db
        .select({
          id: contactsTable.id,
          type: contactsTable.type,
          name: contactsTable.name,
          company: contactsTable.company,
          phone: contactsTable.phone,
          email: contactsTable.email,
          address: contactsTable.address,
          city: contactsTable.city,
          segment: contactsTable.segment,
          notes: contactsTable.notes,
          ownerUserId: contactsTable.ownerUserId,
          createdAt: contactsTable.createdAt,
          salesCount,
          poCount,
        })
        .from(contactsTable)
        .where(seller ? sellerScope(uid) : undefined)
        .orderBy(contactsTable.name);
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/contacts
router.get(
  "/contacts",
  requireAuth,
  requireRole(...PERMISSIONS.contacts.view),
  async (req, res, next) => {
    try {
      const { type } = req.query as { type?: string };
      let query = db.select().from(contactsTable).$dynamic();
      const filters = [];
      if (type) filters.push(eq(contactsTable.type, type));
      if (isSellerRole(req.user!.role)) filters.push(sellerScope(req.user!.userId));
      if (filters.length) query = query.where(and(...filters));
      const contacts = await query.orderBy(contactsTable.name);
      res.json(contacts);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/contacts
router.post(
  "/contacts",
  requireAuth,
  requirePermission("contacts.create"),
  async (req, res, next) => {
    try {
      const data = createContactSchema.parse(req.body);
      if (isSellerRole(req.user!.role)) {
        data.ownerUserId = req.user!.userId;
      }

      const created = await db.transaction(async (tx) => {
        const [inserted] = await tx.insert(contactsTable).values(data).returning();
        if (!inserted) throw new Error("تعذر إنشاء جهة الاتصال");

        await writeAuditEvent({
          executor: tx,
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: "contacts.create",
          resourceType: "contact",
          resourceId: inserted.id,
          afterData: inserted,
          reason: "إنشاء جهة اتصال",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        return inserted;
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/contacts/:id/activity — آخر الفواتير وأوامر الشراء المرتبطة بجهة الاتصال
router.get(
  "/contacts/:id/activity",
  requireAuth,
  requireRole(...PERMISSIONS.contacts.view),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const [contact] = await db.select({ id: contactsTable.id, ownerUserId: contactsTable.ownerUserId }).from(contactsTable).where(eq(contactsTable.id, id)).limit(1);
      if (!contact) {
        res.status(404).json({ error: { message: "جهة الاتصال غير موجودة" } });
        return;
      }
      if (!(await canAccessContact(contact, req.user!))) {
        res.status(403).json(FORBIDDEN);
        return;
      }
      const seller = isSellerRole(req.user!.role);
      const sales = await db
        .select({ id: salesOrdersTable.id, orderNumber: salesOrdersTable.orderNumber, status: salesOrdersTable.status, total: salesOrdersTable.total, date: salesOrdersTable.date })
        .from(salesOrdersTable)
        .where(seller ? and(eq(salesOrdersTable.contactId, id), eq(salesOrdersTable.createdById, req.user!.userId)) : eq(salesOrdersTable.contactId, id))
        .orderBy(desc(salesOrdersTable.createdAt))
        .limit(6);
      // أوامر الشراء من غير أسعار: السعر ليه أدواره الخاصة في صفحة المشتريات.
      const purchases = seller
        ? []
        : await db
            .select({ id: purchaseOrdersTable.id, poNumber: purchaseOrdersTable.poNumber, status: purchaseOrdersTable.status, createdAt: purchaseOrdersTable.createdAt })
            .from(purchaseOrdersTable)
            .where(eq(purchaseOrdersTable.supplierId, id))
            .orderBy(desc(purchaseOrdersTable.createdAt))
            .limit(6);
      res.json({ sales, purchases });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/contacts/:id
router.get(
  "/contacts/:id",
  requireAuth,
  requireRole(...PERMISSIONS.contacts.view),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const [contact] = await db
        .select()
        .from(contactsTable)
        .where(eq(contactsTable.id, id))
        .limit(1);

      if (!contact) {
        res.status(404).json({ error: { message: "جهة الاتصال غير موجودة" } });
        return;
      }
      if (!(await canAccessContact(contact, req.user!))) {
        res.status(403).json(FORBIDDEN);
        return;
      }
      res.json(contact);
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/contacts/:id
router.patch(
  "/contacts/:id",
  requireAuth,
  requirePermission("contacts.edit"),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const data = insertContactSchema.partial().parse(req.body);
      const [existing] = await db.select().from(contactsTable).where(eq(contactsTable.id, id)).limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "جهة الاتصال غير موجودة" } });
        return;
      }
      if (!(await canAccessContact(existing, req.user!))) {
        res.status(403).json(FORBIDDEN);
        return;
      }
      // البائع ما ينقلش ملكية جهة الاتصال لحد تاني.
      if (isSellerRole(req.user!.role)) delete data.ownerUserId;
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(contactsTable)
          .set({ ...data, updatedAt: new Date() })
          .where(eq(contactsTable.id, id))
          .returning();
        await writeAuditEvent({
          executor: tx,
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: "contacts.edit",
          resourceType: "contact",
          resourceId: id,
          beforeData: existing,
          afterData: row,
          reason: "تعديل جهة اتصال",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        return row;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// Phase 2: POST /contacts/:id/balance-adjustment removed along with the
// contact-balance/credit-ledger feature (no accounting logic in this
// system).

// DELETE /api/v1/contacts/:id
router.delete(
  "/contacts/:id",
  requireAuth,
  requirePermission("contacts.delete"),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;

      const [existing] = await db
        .select()
        .from(contactsTable)
        .where(eq(contactsTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "جهة الاتصال غير موجودة" } });
        return;
      }
      if (!(await canAccessContact(existing, req.user!))) {
        res.status(403).json(FORBIDDEN);
        return;
      }
      const countOf = async (q: Promise<Array<{ n: number }>>) => (await q)[0]?.n ?? 0;
      const blocker = deleteBlocker({
        sales: await countOf(db.select({ n: sql<number>`count(*)::int` }).from(salesOrdersTable).where(eq(salesOrdersTable.contactId, id))),
        purchases: await countOf(db.select({ n: sql<number>`count(*)::int` }).from(purchaseOrdersTable).where(eq(purchaseOrdersTable.supplierId, id))),
        stockItems: await countOf(db.select({ n: sql<number>`count(*)::int` }).from(inventoryItemsTable).where(eq(inventoryItemsTable.supplierId, id))),
      });
      if (blocker) {
        throw Object.assign(new Error(blocker), { status: 409, code: "CONTACT_IN_USE" });
      }
      const [linkedPortalCustomer] = await db
        .select({ id: portalCustomersTable.id, isActive: portalCustomersTable.isActive })
        .from(portalCustomersTable)
        .where(eq(portalCustomersTable.contactId, id))
        .limit(1);
      if (linkedPortalCustomer) {
        throw Object.assign(
          new Error(
            linkedPortalCustomer.isActive
              ? "لا يمكن حذف جهة اتصال مرتبطة بحساب بوابة نشط. أوقف حساب البوابة أولًا."
              : "لا يمكن حذف جهة اتصال مرتبطة بحساب بوابة. احذف حساب البوابة أولًا.",
          ),
          { status: 409, code: "CONTACT_HAS_PORTAL_ACCOUNT" },
        );
      }

      await db.transaction(async (tx) => {
        await moveToTrash(
          tx,
          "contacts",
          existing,
          req.user!.userId,
          req.user!.username,
          existing.name,
        );
        await tx.delete(contactsTable).where(eq(contactsTable.id, id));
        await writeAuditEvent({
          executor: tx,
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: "contacts.delete",
          resourceType: "contact",
          resourceId: id,
          beforeData: existing,
          reason: "حذف جهة اتصال",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
      });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// Phase 2: GET /contacts/:id/ledger removed along with the contact-balance/
// credit-ledger feature (no accounting logic in this system).

export default router;
