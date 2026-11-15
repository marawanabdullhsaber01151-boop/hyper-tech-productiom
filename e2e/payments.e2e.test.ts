import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

/**
 * التحصيلات على PostgreSQL حقيقي (50): التوزيع، القيد المحاسبي، التحويل لمدفوع، الإلغاء بالعكس، وترجرات الحماية.
 * بيشغّل الترحيل التلقائي مؤقتًا وبيرجّعه مقفول في الآخر.
 */
const enabled = Boolean(process.env.E2E_DATABASE_URL);
const suite = enabled ? describe : describe.skip;

suite("التحصيلات (PostgreSQL حقيقي)", () => {
  let pool: Pool;
  let db: any;
  let pay: typeof import("../src/lib/payments");
  let core: typeof import("../src/lib/ledgerAutoCore");
  const stamp = String(Date.now()).slice(-8);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const actor = { userId: null as number | null, username: "e2e-pay" };
  const run = <T>(fn: (tx: any) => Promise<T>): Promise<T> => db.transaction(fn);
  const mkContact = async (suffix: string): Promise<number> => (await pool.query("insert into contacts(name,type) values ($1,'customer') returning id", [`PAY-${stamp}-${suffix}`])).rows[0].id;
  const mkOrder = async (contactId: number, suffix: string, status: string, total: string, date: string): Promise<number> =>
    (await pool.query("insert into sales_orders(order_number,date,status,total,contact_id) values ($1,$2,$3,$4,$5) returning id", [`PAYO-${stamp}-${suffix}`, date, status, total, contactId])).rows[0].id;
  const statusOf = async (id: number) => (await pool.query("select status from sales_orders where id=$1", [id])).rows[0].status as string;
  const allocOf = async (paymentId: number) => (await pool.query("select sales_order_id as o, amount::text as a from payment_allocations where payment_id=$1 order by sales_order_id", [paymentId])).rows as Array<{ o: number; a: string }>;
  const glNet = async (code: string, sourceType: string, sourceLike: string) =>
    Number((await pool.query("select coalesce(sum(l.debit-l.credit),0)::text as n from gl_journal_lines l join gl_journal_entries e on e.id=l.entry_id join gl_accounts a on a.id=l.account_id where a.code=$1 and e.source_type=$2 and e.source_id like $3", [code, sourceType, sourceLike])).rows[0].n);
  const setting = (v: string) => pool.query("insert into system_settings(key,value) values ($1,$2) on conflict (key) do update set value=excluded.value", [core.AUTO_SETTING_KEY, v]);

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
    db = drizzle(pool);
    pay = await import("../src/lib/payments");
    core = await import("../src/lib/ledgerAutoCore");
    await setting(today);
    // حسابات التحصيل لازم تكون موجودة (من هجرة 0100)
    const have = (await pool.query("select count(*)::int as n from gl_accounts where code in ('1110','1120','1130','2160')")).rows[0].n;
    expect(have).toBe(4);
  });
  afterAll(async () => {
    await setting("");
    await pool.end();
  });

  it("توزيع تلقائي الأقدم الأول، والقيد متوازن، والمسدّد بالكامل المشحون يتحوّل مدفوع", async () => {
    const c = await mkContact("A");
    const o1 = await mkOrder(c, "A1", "shipped", "100.00", "2026-01-01");
    const o2 = await mkOrder(c, "A2", "shipped", "200.00", "2026-01-02");
    const r = await run((tx) => pay.createPayment(tx, { contactId: c, paymentDate: today, method: "cash", amountCents: 15000n }, actor));
    expect(await allocOf(r.id)).toEqual([{ o: o1, a: "100.00" }, { o: o2, a: "50.00" }]);
    expect(await statusOf(o1)).toBe("paid");
    expect(await statusOf(o2)).toBe("shipped");
    expect(r.unallocatedCents).toBe(0n);
    expect(await glNet("1110", "customer_payment", String(r.id))).toBe(150);
    expect(await glNet("1130", "customer_payment", String(r.id))).toBe(-150);
    const bal = (await pool.query("select coalesce(sum(debit),0)::text as d, coalesce(sum(credit),0)::text as c from gl_journal_lines")).rows[0];
    expect(bal.d).toBe(bal.c);
  });

  it("المبلغ الزيادة دفعة مقدمة (2160) وبيتوزّع بعدين بقيد تحويل", async () => {
    const c = await mkContact("B");
    const r = await run((tx) => pay.createPayment(tx, { contactId: c, paymentDate: today, method: "bank", amountCents: 30000n }, actor));
    expect(r.unallocatedCents).toBe(30000n);
    expect(await glNet("1120", "customer_payment", String(r.id))).toBe(300);
    expect(await glNet("2160", "customer_payment", String(r.id))).toBe(-300);
    const o = await mkOrder(c, "B1", "confirmed", "120.00", today);
    const a = await run((tx) => pay.allocatePayment(tx, r.id, [{ orderId: o, cents: 12000n }], actor));
    expect(a.remainingCents).toBe(18000n);
    expect(await glNet("2160", "payment_allocation", `${r.id}:%`)).toBe(120);
    expect(await glNet("1130", "payment_allocation", `${r.id}:%`)).toBe(-120);
    expect(await statusOf(o)).toBe("confirmed");
  });

  it("إلغاء التحصيل: القيود بتتعكس، والمدفوع بيرجع مشحون، والتخصيصات بتفضل في السجل", async () => {
    const c = await mkContact("C");
    const o = await mkOrder(c, "C1", "shipped", "80.00", "2026-02-01");
    const r = await run((tx) => pay.createPayment(tx, { contactId: c, paymentDate: today, method: "cash", amountCents: 8000n }, actor));
    expect(await statusOf(o)).toBe("paid");
    await run((tx) => pay.voidPayment(tx, r.id, "اتسجّل بالغلط", actor));
    expect(await statusOf(o)).toBe("shipped");
    expect(await glNet("1110", "customer_payment", String(r.id))).toBe(80);
    const rev = (await pool.query("select coalesce(sum(l.debit-l.credit),0)::text as n from gl_journal_lines l join gl_journal_entries e on e.id=l.entry_id join gl_accounts a on a.id=l.account_id where a.code='1110' and e.reversal_of in (select id from gl_journal_entries where source_type='customer_payment' and source_id=$1)", [String(r.id)])).rows[0].n;
    expect(Number(rev)).toBe(-80);
    expect((await allocOf(r.id)).length).toBe(1);
    await expect(run((tx) => pay.voidPayment(tx, r.id, "تاني", actor))).rejects.toMatchObject({ code: "PAYMENT_VOIDED" });
    // الفاتورة رجعت مفتوحة: تحصيل جديد بيسدّدها
    const r2 = await run((tx) => pay.createPayment(tx, { contactId: c, paymentDate: today, method: "cash", amountCents: 8000n }, actor));
    expect(r2.unallocatedCents).toBe(0n);
    expect(await statusOf(o)).toBe("paid");
  });

  it("تحقق: توزيع زيادة عن الفاتورة أو عن التحصيل أو فاتورة عميل تاني، ومورّد، وتاريخ مستقبلي كلها بتترفض", async () => {
    const c = await mkContact("D");
    const other = await mkContact("D2");
    const mine = await mkOrder(c, "D1", "confirmed", "50.00", today);
    const theirs = await mkOrder(other, "D2", "confirmed", "50.00", today);
    const bad = (alloc: Array<{ orderId: number; cents: bigint }>, amount = 10000n) => run((tx) => pay.createPayment(tx, { contactId: c, paymentDate: today, method: "cash", amountCents: amount, allocations: alloc }, actor));
    await expect(bad([{ orderId: mine, cents: 5001n }])).rejects.toMatchObject({ status: 422 });
    await expect(bad([{ orderId: mine, cents: 5000n }], 4000n)).rejects.toMatchObject({ status: 422 });
    await expect(bad([{ orderId: theirs, cents: 100n }])).rejects.toMatchObject({ status: 422 });
    const sup = (await pool.query("insert into contacts(name,type) values ($1,'supplier') returning id", [`PAY-${stamp}-SUP`])).rows[0].id;
    await expect(run((tx) => pay.createPayment(tx, { contactId: sup, paymentDate: today, method: "cash", amountCents: 100n }, actor))).rejects.toMatchObject({ code: "NOT_A_CUSTOMER" });
    await expect(run((tx) => pay.createPayment(tx, { contactId: c, paymentDate: "2999-01-01", method: "cash", amountCents: 100n }, actor))).rejects.toMatchObject({ code: "FUTURE_DATE" });
  });

  it("ترجر القاعدة: مجموع التخصيص ما يزيدش، والتخصيصات مبتتعدّلش ولا بتتمسح", async () => {
    const c = await mkContact("E");
    const o = await mkOrder(c, "E1", "confirmed", "500.00", today);
    const r = await run((tx) => pay.createPayment(tx, { contactId: c, paymentDate: today, method: "cash", amountCents: 10000n, allocations: [{ orderId: o, cents: 10000n }] }, actor));
    await expect(pool.query("insert into payment_allocations(payment_id,sales_order_id,amount) values ($1,$2,'0.01')", [r.id, o])).rejects.toThrow(/PAY_ALLOCATION_EXCEEDS/);
    await expect(pool.query("update payment_allocations set amount='1.00' where payment_id=$1", [r.id])).rejects.toThrow(/PAY_ALLOCATION_IMMUTABLE/);
    await expect(pool.query("delete from payment_allocations where payment_id=$1", [r.id])).rejects.toThrow(/PAY_ALLOCATION_IMMUTABLE/);
  });

  it("تحصيلان متزامنان على نفس الفاتورة مبيدفعوش أكتر من المتبقي", async () => {
    const c = await mkContact("F");
    const o = await mkOrder(c, "F1", "shipped", "100.00", "2026-03-01");
    const a = run((tx) => pay.createPayment(tx, { contactId: c, paymentDate: today, method: "cash", amountCents: 8000n }, actor));
    const b = run((tx) => pay.createPayment(tx, { contactId: c, paymentDate: today, method: "cash", amountCents: 8000n }, actor));
    const [ra, rb] = await Promise.all([a, b]);
    const paid = Number((await pool.query("select coalesce(sum(a.amount),0)::text as s from payment_allocations a where a.sales_order_id=$1", [o])).rows[0].s);
    expect(paid).toBe(100);
    expect(Number(ra.unallocatedCents + rb.unallocatedCents)).toBe(6000);
    expect(await statusOf(o)).toBe("paid");
  });

  it("قبل تاريخ بداية الترحيل: التحصيل بيتسجّل من غير قيد محاسبي", async () => {
    const c = await mkContact("G");
    await mkOrder(c, "G1", "confirmed", "10.00", today);
    await setting("2999-01-01");
    try {
      const r = await run((tx) => pay.createPayment(tx, { contactId: c, paymentDate: today, method: "cash", amountCents: 1000n }, actor));
      expect(r.entryNumber).toBeNull();
    } finally {
      await setting(today);
    }
  });
});
