/** @format */
// الفاتورة الإلكترونية الداخلية (56).
//   GET  /invoices                      قائمة (بحث + حد)                    مبيعات أو مالية
//   GET  /invoices/integrity            فحص الفجوات والأختام                   مالية
//   GET  /invoices/by-order/:orderId    فاتورة أمر (أو null)                  مبيعات أو مالية
//   POST /sales/:id/invoice             إصدار فاتورة لأمر                     مالية بس
//   GET  /public/invoices/verify?n=&t=  تحقق عام (من الـQR) من غير تسجيل دخول
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { PERMISSIONS } from "../lib/permissions";
import { parseIdParam } from "../lib/validate";
import { portalPublicBaseUrl } from "../lib/portalConfig";
import { numberShape, tokenShape, verifyUrl } from "../lib/invoiceSealCore";
import { integrityReport, invoiceByOrder, issueInvoice, listInvoices, optionalSealKey, requireSealKey, verifyPublic, type InvoiceRow } from "../lib/salesInvoices";

const router = Router();
const readers = [...new Set([...PERMISSIONS.sales.view, ...PERMISSIONS.finance.view])];
const read = [requireAuth, requireRole(...readers)];
const finance = [requireAuth, requireRole(...PERMISSIONS.finance.write)];
const financeView = [requireAuth, requireRole(...PERMISSIONS.finance.view)];

const withUrl = (req: Parameters<typeof portalPublicBaseUrl>[0], inv: InvoiceRow) => ({ ...inv, verifyUrl: verifyUrl(portalPublicBaseUrl(req), inv.invoiceNumber, inv.seal) });

const listQuery = z.object({ q: z.string().trim().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });

router.get("/invoices", ...read, async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query);
    res.json({ items: await listInvoices(db, { q: q.q || undefined, limit: q.limit }), sealKeyConfigured: !!optionalSealKey() });
  } catch (err) {
    next(err);
  }
});

router.get("/invoices/integrity", ...financeView, async (_req, res, next) => {
  try {
    res.json(await integrityReport(db, optionalSealKey()));
  } catch (err) {
    next(err);
  }
});

router.get("/invoices/by-order/:orderId", ...read, async (req, res, next) => {
  try {
    const orderId = parseIdParam(req.params.orderId, res);
    if (orderId === null) return;
    const inv = await invoiceByOrder(db, orderId);
    res.json({ invoice: inv ? withUrl(req, inv) : null, sealKeyConfigured: !!optionalSealKey() });
  } catch (err) {
    next(err);
  }
});

router.post("/sales/:id/invoice", ...finance, async (req, res, next) => {
  try {
    const orderId = parseIdParam(req.params.id, res);
    if (orderId === null) return;
    const key = requireSealKey();
    const actor = { userId: req.user!.userId, username: req.user!.username, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
    const inv = await db.transaction((tx) => issueInvoice(tx, orderId, actor, key));
    res.status(201).json(withUrl(req, inv));
  } catch (err) {
    next(err);
  }
});

const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMIT_EXCEEDED", message: "طلبات كثيرة، حاول بعد شوية" } },
});
const verifyQuery = z.object({ n: z.string().regex(numberShape), t: z.string().regex(tokenShape) });

router.get("/public/invoices/verify", verifyLimiter, async (req, res, next) => {
  try {
    const parsed = verifyQuery.safeParse(req.query);
    if (!parsed.success) {
      res.json({ state: "unknown" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(await verifyPublic(db, parsed.data.n, parsed.data.t, optionalSealKey()));
  } catch (err) {
    next(err);
  }
});

export default router;
