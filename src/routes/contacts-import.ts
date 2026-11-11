/** @format */
// استيراد العملاء بالجملة (الخطوة 46): معاينة من غير حفظ، وبعدين حفظ بموافقة الموظف على المتشابه.
import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, contactsTable } from "../db";
import { egyptGovernorateSchema } from "../db/schema/contacts";
import { isSellerRole } from "../lib/contactsCore";
import { requireAuth, requirePermission } from "../middleware/auth";
import { writeAuditEvent } from "../lib/governance";
import {
  MAX_CELL,
  MAX_IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  analyzeRows,
  rowsFromTable,
  rowsToCreate,
  summarizeRows,
  type AnalyzedRow,
  type TableError,
} from "../lib/contactsImportCore";

const router = Router();

const tableSchema = z.object({
  table: z.array(z.array(z.string().max(2000)).max(MAX_IMPORT_COLUMNS)).max(MAX_IMPORT_ROWS + 1),
  type: z.enum(["customer", "supplier", "both"]).default("customer"),
});
const commitSchema = tableSchema.extend({ allowSimilarLines: z.array(z.number().int().positive()).max(MAX_IMPORT_ROWS).default([]) });

const TABLE_ERROR: Record<TableError, string> = {
  EMPTY: "الملف مفيهوش صفوف بيانات",
  NO_NAME_COLUMN: "مفيش عمود للاسم. أول صف لازم يكون عناوين الأعمدة وفيه عمود «الاسم»",
  TOO_MANY_ROWS: `الملف فيه أكتر من ${MAX_IMPORT_ROWS} صف. قسّمه على أكتر من ملف`,
  TOO_MANY_COLUMNS: `الملف فيه أكتر من ${MAX_IMPORT_COLUMNS} عمود`,
};

async function analyze(table: string[][]) {
  const parsed = rowsFromTable(table);
  if (parsed.error) return { error: parsed.error, parsed, rows: [] as AnalyzedRow[] };
  const existing = await db
    .select({ id: contactsTable.id, name: contactsTable.name, company: contactsTable.company, phone: contactsTable.phone, email: contactsTable.email })
    .from(contactsTable);
  return { error: null, parsed, rows: analyzeRows(parsed.rows, existing) };
}

/** البائع ما يشوفش بيانات عملاء زمايله: بنخفي الاسم والتليفون في المطابقات اللي مش بتاعته. */
async function ownIds(userId: number): Promise<Set<number>> {
  const rows = await db.select({ id: contactsTable.id }).from(contactsTable).where(eq(contactsTable.ownerUserId, userId));
  return new Set(rows.map((r) => r.id));
}

router.post("/contacts/import/preview", requireAuth, requirePermission("contacts.create"), async (req, res, next) => {
  try {
    const body = tableSchema.parse(req.body);
    const r = await analyze(body.table);
    if (r.error) {
      res.status(400).json({ error: { code: r.error, message: TABLE_ERROR[r.error] } });
      return;
    }
    let rows = r.rows;
    if (isSellerRole(req.user!.role)) {
      const mine = await ownIds(req.user!.userId);
      rows = rows.map((a) => ({
        ...a,
        matches: a.matches.map((m) => (mine.has(m.id) ? m : { ...m, name: "جهة اتصال موجودة", company: null, phone: null })),
      }));
    }
    res.json({ rows, summary: summarizeRows(rows), unknownColumns: r.parsed.headers.unknown });
  } catch (err) {
    next(err);
  }
});

router.post("/contacts/import/commit", requireAuth, requirePermission("contacts.create"), async (req, res, next) => {
  try {
    const body = commitSchema.parse(req.body);
    const r = await analyze(body.table);
    if (r.error) {
      res.status(400).json({ error: { code: r.error, message: TABLE_ERROR[r.error] } });
      return;
    }
    const toCreate = rowsToCreate(r.rows, body.allowSimilarLines);
    const owner = isSellerRole(req.user!.role) ? req.user!.userId : null;
    const created = await db.transaction(async (tx) => {
      const ids: number[] = [];
      for (const a of toCreate) {
        const cityOk = a.row.city ? egyptGovernorateSchema.safeParse(a.row.city).success : false;
        const address = [a.row.address, a.row.city && !cityOk ? a.row.city : ""].filter(Boolean).join(" - ").slice(0, MAX_CELL * 2);
        const [row] = await tx
          .insert(contactsTable)
          .values({
            type: body.type,
            ownerUserId: owner,
            name: a.row.name,
            company: a.row.company || null,
            phone: a.row.phone || null,
            email: a.row.email || null,
            address: address || null,
            city: cityOk ? a.row.city : null,
            notes: a.row.notes || null,
          })
          .returning({ id: contactsTable.id });
        if (row) ids.push(row.id);
      }
      await writeAuditEvent({
        executor: tx,
        actorUserId: req.user!.userId,
        actorName: req.user!.username,
        actionKey: "contacts.import",
        resourceType: "contact",
        resourceId: ids[0] ?? 0,
        afterData: { created: ids.length, skipped: r.rows.length - ids.length, ids },
        reason: "استيراد جهات اتصال بالجملة",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      return ids;
    });
    res.status(201).json({ created: created.length, skipped: r.rows.length - created.length });
  } catch (err) {
    next(err);
  }
});

export default router;
