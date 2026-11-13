import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

/**
 * دفتر الأستاذ على PostgreSQL حقيقي (Q1). ده الاختبار اللي بيثبت إن ترجرات هجرة 0100/0101 شغّالة فعلًا
 * مش بس مكتوبة، وإن دالة الترحيل بتحترمها تحت ضغط متزامن.
 * القيود للكتابة بس (مفيش حذف)، فالاختبار بيشتغل في سنة 2001 معزولة عن أي بيانات حقيقية.
 */
const enabled = Boolean(process.env.E2E_DATABASE_URL);
const suite = enabled ? describe : describe.skip;

suite("الحسابات — ترجرات القاعدة والترحيل (PostgreSQL حقيقي)", () => {
  let pool: Pool;
  let db: any;
  let ledger: typeof import("../src/lib/ledger");
  let cash = 0;
  let sales = 0;
  const actor = { createdBy: null as number | null, createdByName: "e2e" };
  const stamp = String(Date.now()).slice(-8);

  const sqlFails = async (text: string, params: unknown[] = []): Promise<string> => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query(text, params);
      await c.query("commit");
      return "";
    } catch (e: any) {
      await c.query("rollback").catch(() => undefined);
      return String(e.message);
    } finally {
      c.release();
    }
  };
  /** قيد خام بالـSQL (بيتخطى كود التطبيق عمدًا عشان نختبر القاعدة نفسها). */
  const rawEntry = async (num: string, date: string, total: number, lines: Array<[number, number, number]>) => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      const per = await c.query("select id from gl_periods where year=$1 and month=$2", [Number(date.slice(0, 4)), Number(date.slice(5, 7))]);
      const e = await c.query("insert into gl_journal_entries(entry_number,entry_date,period_id,description,total) values ($1,$2,$3,'e2e',$4) returning id", [num, date, per.rows[0].id, total]);
      let n = 1;
      for (const [acc, d, cr] of lines) await c.query("insert into gl_journal_lines(entry_id,line_no,account_id,debit,credit) values ($1,$2,$3,$4,$5)", [e.rows[0].id, n++, acc, d, cr]);
      await c.query("commit");
      return "";
    } catch (e: any) {
      await c.query("rollback").catch(() => undefined);
      return String(e.message);
    } finally {
      c.release();
    }
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
    db = drizzle(pool);
    ledger = await import("../src/lib/ledger");
    cash = (await pool.query("select id from gl_accounts where code='1110'")).rows[0].id;
    sales = (await pool.query("select id from gl_accounts where code='4100'")).rows[0].id;
    for (const m of [1, 2, 3, 4, 5, 6]) {
      const last = new Date(Date.UTC(2001, m, 0)).getUTCDate();
      await pool.query("insert into gl_periods(year,month,starts_on,ends_on) values (2001,$1,$2,$3) on conflict do nothing", [m, `2001-${String(m).padStart(2, "0")}-01`, `2001-${String(m).padStart(2, "0")}-${last}`]);
    }
  });
  afterAll(async () => {
    await pool.end();
  });

  const post = (date: string, d: string, c: string, extra: Record<string, unknown> = {}) =>
    db.transaction((tx: any) => ledger.postJournalEntry(tx, { entryDate: date, description: "بيع نقدي e2e", lines: [{ accountId: cash, debit: d }, { accountId: sales, credit: c }], ...actor, ...extra }));
  const failure = async (p: Promise<unknown>): Promise<any> => {
    try { await p; return null; } catch (e) { return e; }
  };

  it("قيد متوازن بيتسجّل برقم JV-0101-… وبإجمالي صح", async () => {
    const r = await post("2001-01-10", "100.50", "100.50");
    expect(r.entryNumber.startsWith("JV-0101-")).toBe(true);
    expect(r.total).toBe("100.50");
  });

  it("القاعدة بترفض: غير متوازن بقرش، قيد من غير سطور، سطر واحد، إجمالي مش مطابق، سطر بالجانبين، سطر صفري", async () => {
    expect(await rawEntry(`U1-${stamp}`, "2001-01-11", 100, [[cash, 100, 0], [sales, 0, 99.99]])).toContain("GL_UNBALANCED");
    expect(await rawEntry(`U2-${stamp}`, "2001-01-11", 1, [])).toContain("GL_TOO_FEW_LINES");
    expect(await rawEntry(`U3-${stamp}`, "2001-01-11", 1, [[cash, 1, 0]])).toContain("GL_");
    expect(await rawEntry(`U4-${stamp}`, "2001-01-11", 999, [[cash, 100, 0], [sales, 0, 100]])).toContain("GL_TOTAL_MISMATCH");
    expect(await rawEntry(`U5-${stamp}`, "2001-01-11", 5, [[cash, 5, 5], [sales, 0, 0]])).toContain("check constraint");
    expect(await rawEntry(`U6-${stamp}`, "2001-01-11", 0, [[cash, 0, 0], [sales, 0, 0]])).toContain("check constraint");
  });

  it("القاعدة بترفض تاريخ برّه الفترة، وفترة مقفولة", async () => {
    const c = await pool.query("select id from gl_periods where year=2001 and month=1");
    expect(await sqlFails("insert into gl_journal_entries(entry_number,entry_date,period_id,description,total) values ($1,'2001-02-01',$2,'x',1)", [`U7-${stamp}`, c.rows[0].id])).toContain("GL_DATE_OUTSIDE_PERIOD");
    await pool.query("update gl_periods set status='closed' where year=2001 and month=6");
    expect(await rawEntry(`U8-${stamp}`, "2001-06-10", 1, [[cash, 1, 0], [sales, 0, 1]])).toContain("GL_PERIOD_CLOSED");
    const e = await failure(post("2001-06-10", "1", "1"));
    expect(e.code).toBe("PERIOD_CLOSED");
    await pool.query("update gl_periods set status='open' where year=2001 and month=6");
  });

  it("القيد المرحّل مبيتعدّلش ولا بيتمسح (قيد وسطور)، والاستثناء الوحيد posted ← reversed", async () => {
    const r = await post("2001-02-10", "10", "10");
    expect(await sqlFails("update gl_journal_lines set debit=1 where entry_id=$1", [r.id])).toContain("GL_IMMUTABLE");
    expect(await sqlFails("delete from gl_journal_lines where entry_id=$1", [r.id])).toContain("GL_IMMUTABLE");
    expect(await sqlFails("delete from gl_journal_entries where id=$1", [r.id])).toContain("GL_IMMUTABLE");
    expect(await sqlFails("update gl_journal_entries set description='hack' where id=$1", [r.id])).toContain("GL_IMMUTABLE");
    expect(await sqlFails("update gl_journal_entries set total=1 where id=$1", [r.id])).toContain("GL_IMMUTABLE");
    expect(await sqlFails("update gl_journal_entries set entry_date='2001-02-11' where id=$1", [r.id])).toContain("GL_IMMUTABLE");
    expect(await sqlFails("update gl_journal_entries set status='reversed' where id=$1", [r.id])).toBe("");
    expect(await sqlFails("update gl_journal_entries set status='posted' where id=$1", [r.id])).toContain("GL_IMMUTABLE");
  });

  it("دالة الترحيل بترفض كل المشاكل مرة واحدة برسالة عربي وكود، من غير ما تكتب حاجة", async () => {
    const e = await failure(post("2001-03-10", "5", "6"));
    expect(e.code).toBe("LEDGER_INVALID");
    expect(e.issues.includes("UNBALANCED")).toBe(true);
    const e2 = await failure(db.transaction((tx: any) => ledger.postJournalEntry(tx, { entryDate: "2001-03-10", description: " ", lines: [{ accountId: 99999999, debit: "1" }], ...actor })));
    expect(e2.issues.includes("ACCOUNT_UNKNOWN") && e2.issues.includes("NO_DESCRIPTION") && e2.issues.includes("TOO_FEW_LINES")).toBe(true);
    const n = await pool.query("select count(*)::int c from gl_journal_entries where entry_date between '2001-03-01' and '2001-03-31'");
    expect(n.rows[0].c).toBe(0);
  });

  it("فشل في نص المعاملة (بعد الترحيل) = الرجوع الكامل: لا قيد ولا سطور", async () => {
    const before = (await pool.query("select count(*)::int c from gl_journal_entries")).rows[0].c;
    const e = await failure(db.transaction(async (tx: any) => { await ledger.postJournalEntry(tx, { entryDate: "2001-03-12", description: "هيتلغي", lines: [{ accountId: cash, debit: "7" }, { accountId: sales, credit: "7" }], ...actor }); throw new Error("boom"); }));
    expect(e.message).toBe("boom");
    expect((await pool.query("select count(*)::int c from gl_journal_entries")).rows[0].c).toBe(before);
  });

  it("20 ترحيل متزامنين: كلهم ينجحوا بأرقام فريدة ومتسلسلة من غير فجوات", async () => {
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => post("2001-04-15", String(i + 1), String(i + 1))));
    const nums = rs.map((r: any) => Number(r.entryNumber.split("-")[2])).sort((a: number, b: number) => a - b);
    expect(new Set(nums).size).toBe(20);
    expect(nums[19] - nums[0]).toBe(19);
  });

  it("قيد المصدر مبيتكررش (عملية اتعادت = قيد واحد)", async () => {
    await post("2001-05-02", "3", "3", { sourceType: "e2e_invoice", sourceId: `INV-${stamp}` });
    const dup = await failure(post("2001-05-02", "3", "3", { sourceType: "e2e_invoice", sourceId: `INV-${stamp}` }));
    expect(`${dup?.message} ${dup?.cause?.message ?? ""} ${dup?.cause?.constraint ?? ""}`).toContain("gl_entries_source_unique");
    expect((await pool.query("select count(*)::int c from gl_journal_entries where source_id=$1", [`INV-${stamp}`])).rows[0].c).toBe(1);
  });

  it("ميزان المراجعة لفترة 2001: مجموع المدين = مجموع الدائن (من القاعدة مباشرة)", async () => {
    const r = await pool.query(
      `select coalesce(sum(l.debit),0)::numeric d, coalesce(sum(l.credit),0)::numeric c, count(*)::int n
       from gl_journal_lines l join gl_journal_entries e on e.id=l.entry_id where e.entry_date between '2001-01-01' and '2001-12-31'`,
    );
    expect(r.rows[0].n > 0).toBe(true);
    expect(r.rows[0].d).toBe(r.rows[0].c);
  });
});
