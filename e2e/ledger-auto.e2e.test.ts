import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

/**
 * الترحيل التلقائي للمبيعات على PostgreSQL حقيقي (49أ): قيد بالفرق بس، مفيش تكرار، والتزامن آمن.
 * الاختبار بيشغّل الإعداد مؤقتًا وبيرجّعه مقفول في الآخر.
 */
const enabled = Boolean(process.env.E2E_DATABASE_URL);
const suite = enabled ? describe : describe.skip;

suite("الترحيل التلقائي للمبيعات (PostgreSQL حقيقي)", () => {
  let pool: Pool;
  let db: any;
  let auto: typeof import("../src/lib/ledgerAuto");
  let core: typeof import("../src/lib/ledgerAutoCore");
  const actor = { userId: null as number | null, username: "e2e-auto" };
  const stamp = String(Date.now()).slice(-8);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());

  const sync = (id: number, opts: { forceStatus?: string } = {}) => db.transaction((tx: any) => auto.syncSalesOrderLedger(tx, id, actor, opts));
  const mkOrder = async (suffix: string, status: string, total: string, date = today): Promise<number> =>
    (await pool.query("insert into sales_orders(order_number,date,status,total) values ($1,$2,$3,$4) returning id", [`AUTO-${stamp}-${suffix}`, date, status, total])).rows[0].id;
  const setOrder = (id: number, status: string, total: string) => pool.query("update sales_orders set status=$2,total=$3 where id=$1", [id, status, total]);
  const net = async (id: number) =>
    Number((await pool.query("select coalesce(sum(l.credit-l.debit),0)::text as n from gl_journal_lines l join gl_journal_entries e on e.id=l.entry_id join gl_accounts a on a.id=l.account_id where a.code='4100' and e.source_type='sales_invoice' and e.source_id like $1", [`${id}:%`])).rows[0].n);
  const count = async (id: number) => Number((await pool.query("select count(*)::int as n from gl_journal_entries where source_type='sales_invoice' and source_id like $1", [`${id}:%`])).rows[0].n);
  const setting = (v: string) => pool.query("insert into system_settings(key,value) values ($1,$2) on conflict (key) do update set value=excluded.value", [core.AUTO_SETTING_KEY, v]);

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
    db = drizzle(pool);
    auto = await import("../src/lib/ledgerAuto");
    core = await import("../src/lib/ledgerAutoCore");
    await setting("");
  });
  afterAll(async () => {
    await setting("");
    await pool.end();
  });

  it("مقفول: مفيش أي قيد", async () => {
    const id = await mkOrder("OFF", "confirmed", "100.00");
    expect((await sync(id)).posted).toBe(false);
    expect(await count(id)).toBe(0);
  });

  it("شغّال: مسودة مفيهاش قيد، التأكيد بيسجّل، التكرار مبيعملش حاجة، والتعديل بالفرق", async () => {
    await setting(today);
    const id = await mkOrder("A", "draft", "100.00");
    expect((await sync(id)).posted).toBe(false);
    await setOrder(id, "confirmed", "100.00");
    expect((await sync(id)).posted).toBe(true);
    expect(await net(id)).toBe(100);
    expect((await sync(id)).posted).toBe(false);
    expect(await count(id)).toBe(1);
    await setOrder(id, "confirmed", "150.00");
    await sync(id);
    expect(await net(id)).toBe(150);
    await setOrder(id, "shipped", "120.00");
    await sync(id);
    expect(await net(id)).toBe(120);
  });

  it("الإلغاء بيعكس، وإعادة التأكيد بتسجّل تاني بمفتاح جديد بدون تعارض", async () => {
    const id = await mkOrder("B", "confirmed", "80.00");
    await sync(id);
    await setOrder(id, "cancelled", "80.00");
    await sync(id);
    expect(await net(id)).toBe(0);
    await setOrder(id, "confirmed", "80.00");
    await sync(id);
    expect(await net(id)).toBe(80);
    expect(await count(id)).toBe(3);
  });

  it("الحذف (forceStatus=cancelled) بيرجّع الصافي صفر", async () => {
    const id = await mkOrder("C", "paid", "55.50");
    await sync(id);
    expect(await net(id)).toBe(55.5);
    await sync(id, { forceStatus: "cancelled" });
    expect(await net(id)).toBe(0);
  });

  it("أمر قديم قبل تاريخ البداية مبيتسجّلش", async () => {
    const id = await mkOrder("OLD", "confirmed", "70.00", "2001-01-01");
    expect((await sync(id)).posted).toBe(false);
    expect(await count(id)).toBe(0);
  });

  it("تزامن: نداءين في نفس اللحظة مبيعملوش قيد مكرر", async () => {
    const id = await mkOrder("RACE", "confirmed", "100.00");
    await Promise.all([sync(id), sync(id), sync(id)]);
    expect(await net(id)).toBe(100);
    expect(await count(id)).toBe(1);
  });
});
