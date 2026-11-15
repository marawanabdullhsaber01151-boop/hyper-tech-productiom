import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

/** كشف الحساب وأعمار الديون على PostgreSQL حقيقي (51): الأرقام لازم تطابق التحصيلات، والإلغاء يرجّع الدين. */
const enabled = Boolean(process.env.E2E_DATABASE_URL);
const suite = enabled ? describe : describe.skip;

suite("كشف الحساب والأعمار (PostgreSQL حقيقي)", () => {
  let pool: Pool;
  let db: any;
  let pay: typeof import("../src/lib/payments");
  let rec: typeof import("../src/lib/receivables");
  const stamp = String(Date.now()).slice(-8);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const actor = { userId: null as number | null, username: "e2e-rec" };
  const run = <T>(fn: (tx: any) => Promise<T>): Promise<T> => db.transaction(fn);
  const mkContact = async (suffix: string): Promise<number> => (await pool.query("insert into contacts(name,type) values ($1,'customer') returning id", [`REC-${stamp}-${suffix}`])).rows[0].id;
  const mkOrder = async (contactId: number, suffix: string, status: string, total: string, date: string): Promise<number> =>
    (await pool.query("insert into sales_orders(order_number,date,status,total,contact_id) values ($1,$2,$3,$4,$5) returning id", [`RECO-${stamp}-${suffix}`, date, status, total, contactId])).rows[0].id;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
    db = drizzle(pool);
    pay = await import("../src/lib/payments");
    rec = await import("../src/lib/receivables");
  });
  afterAll(async () => {
    await pool.end();
  });

  it("الأعمار: كل فاتورة في شريحتها بالمتبقي بعد التحصيل، وكشف الحساب بيقفل على نفس الرقم", async () => {
    const c = await mkContact("A");
    await mkOrder(c, "A1", "shipped", "100.00", daysAgo(100)); // +90
    await mkOrder(c, "A2", "confirmed", "200.00", daysAgo(45)); // 31-60
    await mkOrder(c, "A3", "confirmed", "50.00", daysAgo(5)); // 0-30
    await run((tx) => pay.createPayment(tx, { contactId: c, paymentDate: today, method: "cash", amountCents: 6000n }, actor)); // يسدّد 60 من الأقدم
    const a = await rec.agingReport(db, today);
    const row = a.rows.find((r) => r.contactId === c)!;
    expect(row.buckets).toEqual({ b0: 5000n, b30: 20000n, b60: 0n, b90: 4000n });
    expect(row.totalCents).toBe(29000n);
    const s = await rec.customerStatement(db, c, null, null);
    expect(s.closingCents).toBe(row.totalCents);
    expect(s.debitCents).toBe(35000n);
    expect(s.creditCents).toBe(6000n);
  });

  it("تحصيل ملغي مبيظهرش في الكشف، والدين بيرجع", async () => {
    const c = await mkContact("B");
    const o = await mkOrder(c, "B1", "confirmed", "80.00", daysAgo(3));
    const p = await run((tx) => pay.createPayment(tx, { contactId: c, paymentDate: today, method: "bank", amountCents: 8000n }, actor));
    expect((await rec.customerStatement(db, c, null, null)).closingCents).toBe(0n);
    await run((tx) => pay.voidPayment(tx, p.id, "اختبار", actor));
    const s = await rec.customerStatement(db, c, null, null);
    expect(s.closingCents).toBe(8000n);
    expect(s.lines.map((l) => l.kind)).toEqual(["invoice"]);
    const a = await rec.agingReport(db, today);
    expect(a.rows.find((r) => r.contactId === c)!.buckets.b0).toBe(8000n);
    expect(o).toBeGreaterThan(0);
  });

  it("دفعة مقدمة = رصيد سالب في الكشف، وبتظهر في عمود الدفعات المقدمة", async () => {
    const c = await mkContact("C");
    await mkOrder(c, "C1", "confirmed", "10.00", daysAgo(1));
    await run((tx) => pay.createPayment(tx, { contactId: c, paymentDate: today, method: "cash", amountCents: 2500n }, actor));
    const s = await rec.customerStatement(db, c, null, null);
    expect(s.closingCents).toBe(-1500n);
    expect((await rec.advancesByContact(db)).get(c)).toBe(1500n);
  });
});
