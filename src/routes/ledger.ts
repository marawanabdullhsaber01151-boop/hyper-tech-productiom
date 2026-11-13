/** @format */
// دفتر الأستاذ (48): دليل الحسابات، الفترات، قيود اليومية (يدوي وعكسي)، وميزان المراجعة.
// مفيش تعديل ولا حذف لقيد مرحّل: التصحيح بقيد عكسي. الضمانات الأساسية في ترجرات القاعدة (هجرة 0100).
import { Router } from "express";
import { and, asc, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { glAccountsTable, glJournalEntriesTable, glJournalLinesTable, glPeriodsTable } from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { PERMISSIONS } from "../lib/permissions";
import { writeAuditEvent } from "../lib/governance";
import { parseIdParam } from "../lib/validate";
import { loadSettingValues } from "../lib/settingsStore";
import { todayCairo } from "../lib/operationsCapacityCore";
import { postJournalEntry } from "../lib/ledger";
import {
  ACCOUNT_ISSUE_TEXT, ACCOUNT_TYPES, accountIssues, fiscalYearLabel, isIsoDate, normalSideOf, reverseLines, trialBalance,
  type AccountType,
} from "../lib/ledgerCore";

const router = Router();
const view = [requireAuth, requireRole(...PERMISSIONS.finance.view)];
const write = [requireAuth, requireRole(...PERMISSIONS.finance.write)];
const fail = (status: number, message: string, code?: string) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

const isoDate = z.string().refine(isIsoDate, "تاريخ غير صحيح");

/* ---------------- دليل الحسابات ---------------- */
router.get("/ledger/accounts", ...view, async (_req, res, next) => {
  try {
    const rows = await db.select().from(glAccountsTable).orderBy(asc(glAccountsTable.code));
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

const accountBody = z.object({
  code: z.string().trim(),
  name: z.string().trim().max(120),
  type: z.enum(ACCOUNT_TYPES),
  parentId: z.number().int().positive().nullable().optional(),
  isPostable: z.boolean().default(true),
});

router.post("/ledger/accounts", ...write, async (req, res, next) => {
  try {
    const body = accountBody.parse(req.body);
    const created = await db.transaction(async (tx) => {
      const [parent] = body.parentId ? await tx.select().from(glAccountsTable).where(eq(glAccountsTable.id, body.parentId)).limit(1) : [];
      if (body.parentId && !parent) throw fail(404, "الحساب الرئيسي مش موجود", "PARENT_NOT_FOUND");
      const issues = accountIssues(body, parent ? { type: parent.type as AccountType, isPostable: parent.isPostable } : null);
      if (issues.length) throw fail(422, issues.map((i) => ACCOUNT_ISSUE_TEXT[i]).join(" | "), "ACCOUNT_INVALID");
      const [dup] = await tx.select({ id: glAccountsTable.id }).from(glAccountsTable).where(eq(glAccountsTable.code, body.code)).limit(1);
      if (dup) throw fail(409, "الكود ده مستخدم قبل كده", "ACCOUNT_CODE_TAKEN");
      const [row] = await tx
        .insert(glAccountsTable)
        .values({ code: body.code, name: body.name, type: body.type, normalSide: normalSideOf(body.type), parentId: body.parentId ?? null, isPostable: body.isPostable })
        .returning();
      await writeAuditEvent({ executor: tx, actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "ledger.account_created", resourceType: "gl_account", resourceId: row!.id, afterData: { code: row!.code, name: row!.name, type: row!.type }, ipAddress: req.ip, userAgent: req.get("user-agent") });
      return row!;
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

const accountPatch = z.object({ name: z.string().trim().min(2).max(120).optional(), isActive: z.boolean().optional() });

router.patch("/ledger/accounts/:id", ...write, async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const body = accountPatch.parse(req.body ?? {});
    const saved = await db.transaction(async (tx) => {
      const [acc] = await tx.select().from(glAccountsTable).where(eq(glAccountsTable.id, id)).for("update").limit(1);
      if (!acc) throw fail(404, "الحساب مش موجود", "ACCOUNT_NOT_FOUND");
      if (body.isActive === false && acc.isActive) {
        const [bal] = await tx
          .select({ net: sql<string>`coalesce(sum(${glJournalLinesTable.debit} - ${glJournalLinesTable.credit}), 0)` })
          .from(glJournalLinesTable)
          .where(eq(glJournalLinesTable.accountId, id));
        if (Number(bal?.net ?? 0) !== 0) throw fail(409, "الحساب عليه رصيد. صفّره الأول بقيد وبعدين أوقفه", "ACCOUNT_HAS_BALANCE");
      }
      const [row] = await tx.update(glAccountsTable).set({ ...(body.name ? { name: body.name } : {}), ...(body.isActive !== undefined ? { isActive: body.isActive } : {}) }).where(eq(glAccountsTable.id, id)).returning();
      await writeAuditEvent({ executor: tx, actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "ledger.account_updated", resourceType: "gl_account", resourceId: id, beforeData: { name: acc.name, isActive: acc.isActive }, afterData: { name: row!.name, isActive: row!.isActive }, ipAddress: req.ip, userAgent: req.get("user-agent") });
      return row!;
    });
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

/* ---------------- الفترات ---------------- */
router.get("/ledger/periods", ...view, async (_req, res, next) => {
  try {
    const rows = await db.select().from(glPeriodsTable).orderBy(desc(glPeriodsTable.year), desc(glPeriodsTable.month));
    const values = await loadSettingValues();
    const startMonth = Number(String(values["fiscal_year_start"] ?? "01-01").slice(0, 2)) || 1;
    const today = todayCairo(new Date());
    res.json({
      items: rows.map((p) => ({ ...p, fiscalYear: fiscalYearLabel(p.startsOn, startMonth) })),
      fiscalStartMonth: startMonth,
      currentFiscalYear: fiscalYearLabel(today, startMonth),
    });
  } catch (err) {
    next(err);
  }
});

/* ---------------- القيود ---------------- */
const listQuery = z.object({ from: isoDate.optional(), to: isoDate.optional(), q: z.string().trim().max(80).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });

router.get("/ledger/entries", ...view, async (req, res, next) => {
  try {
    const f = listQuery.parse(req.query);
    const rows = await db
      .select()
      .from(glJournalEntriesTable)
      .where(and(f.from ? gte(glJournalEntriesTable.entryDate, f.from) : undefined, f.to ? lte(glJournalEntriesTable.entryDate, f.to) : undefined, f.q ? ilike(glJournalEntriesTable.description, `%${f.q}%`) : undefined))
      .orderBy(desc(glJournalEntriesTable.entryDate), desc(glJournalEntriesTable.id))
      .limit(f.limit);
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

async function loadEntry(id: number) {
  const [entry] = await db.select().from(glJournalEntriesTable).where(eq(glJournalEntriesTable.id, id)).limit(1);
  if (!entry) return null;
  const lines = await db
    .select({ id: glJournalLinesTable.id, lineNo: glJournalLinesTable.lineNo, accountId: glJournalLinesTable.accountId, code: glAccountsTable.code, accountName: glAccountsTable.name, debit: glJournalLinesTable.debit, credit: glJournalLinesTable.credit, memo: glJournalLinesTable.memo })
    .from(glJournalLinesTable)
    .innerJoin(glAccountsTable, eq(glAccountsTable.id, glJournalLinesTable.accountId))
    .where(eq(glJournalLinesTable.entryId, id))
    .orderBy(asc(glJournalLinesTable.lineNo));
  return { ...entry, lines };
}

router.get("/ledger/entries/:id", ...view, async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const entry = await loadEntry(id);
    if (!entry) throw fail(404, "القيد مش موجود", "ENTRY_NOT_FOUND");
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

const entryBody = z.object({
  entryDate: isoDate,
  description: z.string().trim().min(3).max(500),
  lines: z.array(z.object({ accountId: z.number().int().positive(), debit: z.string().max(20).optional().nullable(), credit: z.string().max(20).optional().nullable(), memo: z.string().max(300).optional().nullable() })).min(2).max(200),
});

/** رسايل الترجرات بتتحوّل لرسالة مفهومة (خط الدفاع التاني لو الكود فاته حاجة). */
function dbGuard(err: unknown): never {
  const msg = String((err as { message?: string })?.message ?? "");
  if (msg.includes("GL_UNBALANCED")) throw fail(422, "القيد غير متوازن", "UNBALANCED");
  if (msg.includes("GL_PERIOD_CLOSED")) throw fail(422, "الفترة دي مقفولة ومينفعش يتسجّل عليها قيد", "PERIOD_CLOSED");
  throw err;
}

router.post("/ledger/entries", ...write, async (req, res, next) => {
  try {
    const body = entryBody.parse(req.body);
    const posted = await db
      .transaction(async (tx) => {
        const r = await postJournalEntry(tx, { ...body, sourceType: "manual", createdBy: req.user!.userId, createdByName: req.user!.username });
        await writeAuditEvent({ executor: tx, actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "ledger.entry_posted", resourceType: "gl_entry", resourceId: r.id, afterData: { entryNumber: r.entryNumber, total: r.total, entryDate: body.entryDate }, reason: body.description, ipAddress: req.ip, userAgent: req.get("user-agent") });
        return r;
      })
      .catch(dbGuard);
    res.status(201).json(posted);
  } catch (err) {
    next(err);
  }
});

const reverseBody = z.object({ reason: z.string().trim().min(3, "اكتب سبب العكس").max(300), entryDate: isoDate.optional() });

router.post("/ledger/entries/:id/reverse", ...write, async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const body = reverseBody.parse(req.body ?? {});
    const result = await db
      .transaction(async (tx) => {
        const [orig] = await tx.select().from(glJournalEntriesTable).where(eq(glJournalEntriesTable.id, id)).for("update").limit(1);
        if (!orig) throw fail(404, "القيد مش موجود", "ENTRY_NOT_FOUND");
        if (orig.status !== "posted") throw fail(409, "القيد ده اتعكس قبل كده", "ALREADY_REVERSED");
        if (orig.reversalOf) throw fail(409, "ده قيد عكسي ومينفعش يتعكس تاني", "IS_REVERSAL");
        const lines = await tx.select().from(glJournalLinesTable).where(eq(glJournalLinesTable.entryId, id)).orderBy(asc(glJournalLinesTable.lineNo));
        const flipped = reverseLines(lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo })));
        const r = await postJournalEntry(tx, {
          entryDate: body.entryDate ?? todayCairo(new Date()),
          description: `عكس القيد ${orig.entryNumber}: ${body.reason}`,
          lines: flipped,
          sourceType: "reversal",
          sourceId: String(orig.id),
          reversalOf: orig.id,
          createdBy: req.user!.userId,
          createdByName: req.user!.username,
        });
        await tx.update(glJournalEntriesTable).set({ status: "reversed" }).where(eq(glJournalEntriesTable.id, orig.id));
        await writeAuditEvent({ executor: tx, actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "ledger.entry_reversed", resourceType: "gl_entry", resourceId: orig.id, afterData: { reversalNumber: r.entryNumber, original: orig.entryNumber }, reason: body.reason, ipAddress: req.ip, userAgent: req.get("user-agent") });
        return r;
      })
      .catch(dbGuard);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/* ---------------- ميزان المراجعة ---------------- */
router.get("/ledger/trial-balance", ...view, async (req, res, next) => {
  try {
    const f = z.object({ from: isoDate.optional(), to: isoDate.optional() }).parse(req.query);
    const rows = await db
      .select({
        accountId: glAccountsTable.id, code: glAccountsTable.code, name: glAccountsTable.name, type: glAccountsTable.type, normalSide: glAccountsTable.normalSide,
        debit: sql<string>`coalesce(sum(${glJournalLinesTable.debit}), 0)::text`,
        credit: sql<string>`coalesce(sum(${glJournalLinesTable.credit}), 0)::text`,
      })
      .from(glAccountsTable)
      .innerJoin(glJournalLinesTable, eq(glJournalLinesTable.accountId, glAccountsTable.id))
      .innerJoin(glJournalEntriesTable, eq(glJournalEntriesTable.id, glJournalLinesTable.entryId))
      .where(and(f.from ? gte(glJournalEntriesTable.entryDate, f.from) : undefined, f.to ? lte(glJournalEntriesTable.entryDate, f.to) : undefined))
      .groupBy(glAccountsTable.id);
    res.json(trialBalance(rows.map((r) => ({ ...r, type: r.type as AccountType, normalSide: r.normalSide as "debit" | "credit" }))));
  } catch (err) {
    next(err);
  }
});

export default router;
