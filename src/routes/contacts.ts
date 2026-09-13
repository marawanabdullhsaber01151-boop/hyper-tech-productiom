/** @format */

import { Router } from "express";
import { eq, and, inArray, ilike, or, ne } from "drizzle-orm";
import {
  db,
  contactsTable,
  createContactSchema,
  insertContactSchema,
  portalCustomersTable,
} from "../db";
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
      if (!phone && !company) {
        res.json({ matches: [] });
        return;
      }

      const filters = [];
      if (phone) filters.push(eq(contactsTable.phone, phone));
      if (company) filters.push(ilike(contactsTable.company, company));
      if (excludeId && Number.isInteger(excludeId)) {
        filters.push(ne(contactsTable.id, excludeId));
      }

      const matches = await db
        .select({
          id: contactsTable.id,
          name: contactsTable.name,
          company: contactsTable.company,
          phone: contactsTable.phone,
        })
        .from(contactsTable)
        .where(or(...filters))
        .limit(5);
      res.json({ matches });
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
      if (["online_seller", "offline_seller"].includes(req.user!.role)) {
        const orders = await db.select({ contactId: salesOrdersTable.contactId }).from(salesOrdersTable)
          .where(eq(salesOrdersTable.createdById, req.user!.userId));
        const ids = orders.flatMap((row) => row.contactId == null ? [] : [row.contactId]);
        filters.push(ids.length ? inArray(contactsTable.id, ids) : eq(contactsTable.id, -1));
      }
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
      if (["online_seller", "offline_seller"].includes(req.user!.role)) {
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
      if (["online_seller", "offline_seller"].includes(req.user!.role) &&
          contact.ownerUserId !== req.user!.userId) {
        const [ownedOrder] = await db.select({ id: salesOrdersTable.id }).from(salesOrdersTable)
          .where(and(eq(salesOrdersTable.contactId, id), eq(salesOrdersTable.createdById, req.user!.userId))).limit(1);
        if (!ownedOrder) {
          res.status(403).json({ error: { message: "لا يمكنك الوصول إلى هذا العميل" } });
          return;
        }
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
      const [updated] = await db
        .update(contactsTable)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(contactsTable.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: { message: "جهة الاتصال غير موجودة" } });
        return;
      }
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
