import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

/** حدود الائتمان على PostgreSQL حقيقي (52): الفحص، السياسات، الاستثناء، الدفعات المقدمة، والتزامن (أمرين لنفس العميل ما يعدّوش الحد سوا). */
const enabled = Boolean(process.env.E2E_DATABASE_URL);
const suite = enabled ? describe : describe.skip;

suite("حدود الائتمان (PostgreSQL حقيقي)", () => {
  let pool: Pool;
  let db: any;
  let credit: typeof import("../src/lib/credit");
  let pay: typeof import("../src/lib/payments");
  const stamp = String(Date.now()).slice(-8);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const actor = { userId: null as number | null, username: "e2e-credit" };
  const run = <T>(fn: (tx: any) => Promise<T>): Promise<T> => db.transaction(fn);
  const mkContact = async (suffix: string, limit: string | null): Promise<number> => (await pool.query("insert into contacts(name,type,credit_limit) values ($1,'customer',$2) returning id", [`CR-${stamp}-${suffix}`, limit])).rows[0].id;
  const mkOrder = async (contactId: number | null, suffix: string, status: string, total: string): Promise<number> =>
    (await pool.query("insert into sales_orders(order_number,date,status,total,contact_id) values ($1,$2,$3,$4,$5) returning id", [`CRO-${stamp}-${suffix}`, today, status, total, contactId])).rows[0].id;
  const policy = (v: string | null) => (v === null
    ? pool.query("delete from system_settings where key='credit.policy'")
    : pool.query("insert into system_settings(key,value) values ('credit.policy',$1) on conflict (key) do update set value=excluded.value", [v]));
  const assess = (contactId: number | null, orderId: number, total: bigint, from = "draft", to = "confirmed") =>
    run((tx) => credit.assessOrderCredit(tx, { contactId, orderId, totalCents: total, fromStatus: from, toStatus: to }));

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
    db = drizzle(pool);
    credit = await import("../src/lib/credit");
    pay = await import("../src/lib/payments");
  });
  afterAll(async () => {
    await policy(null);
    await pool.end();
  });

  it("سياسة اعتماد التجاوز موجودة من الهجرة: المدير التنفيذي ورئيس المجلس بس", async () => {
    const r = (await pool.query("select approver_roles as roles, min_amount::text as m from approval_policies where action_key='sales.credit_override' and active")).rows;
    expect(r).toHaveLength(1);
    expect([...r[0].roles].sort()).toEqual(["chairman", "executive_manager"]);
    expect(Number(r[0].m)).toBe(0);
  });

  it("تحت الحد: مسموح. فوق الحد والسياسة منع: اعتماد. تحذير: مسموح بعلامة", async () => {
    await policy("block");
    const c = await mkContact("A", "1000.00");
    await mkOrder(c, "A1", "confirmed", "600.00");
    const o2 = await mkOrder(c, "A2", "draft", "300.00");
    expect((await assess(c, o2, 30_000n))!.verdict).toMatchObject({ status: "ok", action: "allow", exposureCents: 90_000n, availableCents: 10_000n });
    const o3 = await mkOrder(c, "A3", "draft", "500.00");
    const over = (await assess(c, o3, 50_000n))!;
    expect(over.verdict).toMatchObject({ status: "over", action: "approval", overByCents: 10_000n });
    await policy("warn");
    expect((await assess(c, o3, 50_000n))!.verdict.action).toBe("warn");
  });

  it("السياسة مقفولة، أو مفيش حد، أو عميل مجهول، أو انتقال مش مديونية جديدة: الفحص مش بيحصل (null)", async () => {
    const c = await mkContact("B", "100.00");
    const o = await mkOrder(c, "B1", "draft", "500.00");
    await policy("off");
    expect(await assess(c, o, 50_000n)).toBeNull();
    await policy("block");
    const free = await mkContact("B2", null);
    expect(await assess(free, await mkOrder(free, "B2", "draft", "9999.00"), 999_900n)).toBeNull();
    expect(await assess(null, o, 50_000n)).toBeNull();
    expect(await assess(c, o, 50_000n, "confirmed", "shipped")).toBeNull();
    expect(await assess(c, o, 50_000n, "draft", "cancelled")).toBeNull();
  });

  it("الأمر نفسه مش بيتحسب مرتين لو كان مؤكد أصلًا", async () => {
    await policy("block");
    const c = await mkContact("C", "500.00");
    const o = await mkOrder(c, "C1", "confirmed", "500.00");
    const v = (await assess(c, o, 50_000n, "pending_approval", "confirmed"))!.verdict;
    expect(v).toMatchObject({ status: "ok", exposureCents: 50_000n });
  });

  it("الدفعة المقدمة بتخصم من المديونية، والتحصيل بيقلّل الدين", async () => {
    await policy("block");
    const c = await mkContact("D", "1000.00");
    await mkOrder(c, "D1", "shipped", "900.00");
    const o = await mkOrder(c, "D2", "draft", "300.00");
    expect((await assess(c, o, 30_000n))!.verdict.action).toBe("approval");
    await run((tx) => pay.createPayment(tx, { contactId: c, paymentDate: today, method: "cash", amountCents: 40_000n }, actor)); // يسدّد جزء من D1
    const v = (await assess(c, o, 30_000n))!.verdict;
    expect(v).toMatchObject({ status: "ok", exposureCents: 80_000n });
  });

  it("التزامن: أمرين متزامنين لنفس العميل، واحد بس يعدّي والتاني يتحوّل للاعتماد", async () => {
    await policy("block");
    const c = await mkContact("E", "100.00");
    const a = await mkOrder(c, "E1", "draft", "80.00");
    const b = await mkOrder(c, "E2", "draft", "80.00");
    const confirm = (orderId: number) =>
      run(async (tx) => {
        const r = await credit.assessOrderCredit(tx, { contactId: c, orderId, totalCents: 8000n, fromStatus: "draft", toStatus: "confirmed" });
        if (r!.verdict.action === "allow") {
          await tx.execute(sql`update sales_orders set status='confirmed' where id=${orderId}`);
          await new Promise((res) => setTimeout(res, 150)); // نخلّي المعاملة مفتوحة وقت كفاية عشان التانية تستنى القفل
        }
        return r!.verdict.action;
      });
    const results = await Promise.all([confirm(a), confirm(b)]);
    expect([...results].sort()).toEqual(["allow", "approval"]);
  });

  it("النظرة العامة: المتجاوز الأول بالمتاح صفر، والعميل من غير حد ومن غير دين مش ظاهر", async () => {
    await policy("block");
    const c = await mkContact("F", "100.00");
    await mkOrder(c, "F1", "confirmed", "250.00");
    const none = await mkContact("F2", null);
    const rows = await credit.creditOverviewData(db);
    const mine = rows.find((r) => r.contactId === c)!;
    expect(mine).toMatchObject({ over: true, debtCents: 25_000n, overByCents: 15_000n, availableCents: 0n });
    const firstNonOver = rows.findIndex((r) => !r.over);
    if (firstNonOver !== -1) expect(rows.findIndex((r) => r.contactId === c)).toBeLessThan(firstNonOver);
    expect(rows.some((r) => r.contactId === none)).toBe(false);
  });

  it("قراية الحد المخزّن: القيمة بتتحوّل لسنت، والصفر معناه مفيش حد", async () => {
    const c = await mkContact("G", null);
    await pool.query("update contacts set credit_limit = 750.50 where id=$1", [c]);
    expect(await run((tx) => credit.contactCreditLimit(tx, c))).toBe(75_050n);
    await pool.query("update contacts set credit_limit = 0 where id=$1", [c]);
    expect(await run((tx) => credit.contactCreditLimit(tx, c))).toBeNull();
  });
});
