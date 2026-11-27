import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { axe } from "../test/axe";
import { InvoiceBox, type InvoiceInfo } from "./InvoiceBox";
import { InvoicesPanel } from "./InvoicesPanel";
import { SalesDetail } from "./SalesDetail";
import { Verify } from "./Verify";
import { officialInvoiceHtml } from "./invoicePrint";
import type { Invoice } from "./invoiceCore";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const INV: Invoice = {
  id: 7, invoiceNumber: "INV-000007", orderId: 1, orderNumber: "SO-0001", customerName: "شركة <النور>", issueDate: "2026-11-26",
  subtotal: "250.00", taxRate: "14.00", taxAmount: "30.70", total: "250.00", seal: "a".repeat(64), sealKeyId: "deadbeef", issuedByName: "رئيس", issuedAt: "2026-11-26T10:00:00Z",
  lines: [{ description: "علبة 500جم", qty: "10.000", unitPrice: "25.00", total: "250.00" }], verifyUrl: "https://h.example/v2/verify?n=INV-000007&t=aaaaaaaaaaaaaaaaaaaa",
};
const wrap = (ui: preact.ComponentChild) => render(<ToastProvider>{ui}</ToastProvider>);
function login(role: string) {
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "مستخدم", role } }));
}
beforeEach(() => { sessionStorage.clear(); login("chairman"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("صندوق الفاتورة", () => {
  it("الإدارة: من غير فاتورة بتشوف زرار الإصدار، والتأكيد بيبعت POST ويحدّث", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${(init?.method ?? "GET").toUpperCase()} ${new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://x").pathname}`);
      return json(INV, 201);
    }));
    const onIssued = vi.fn();
    const info: InvoiceInfo = { invoice: null, sealKeyConfigured: true };
    wrap(<InvoiceBox orderId={1} orderNumber="SO-0001" role="chairman" info={info} onIssued={onIssued} />);
    fireEvent.click(screen.getByRole("button", { name: "أصدر فاتورة" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText(/متتعدّلش بعد كده/)).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "أصدر فاتورة" }));
    await waitFor(() => expect(onIssued).toHaveBeenCalled());
    expect(calls).toEqual(["POST /api/v1/sales/1/invoice"]);
  });

  it("مفتاح الختم ناقص: تحذير والزرار مقفول", () => {
    wrap(<InvoiceBox orderId={1} orderNumber="SO-0001" role="chairman" info={{ invoice: null, sealKeyConfigured: false }} onIssued={() => {}} />);
    expect(screen.getByText(/مفتاح ختم الفاتورة مش متضبط/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "أصدر فاتورة" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("موظف المبيعات: مفيش زرار إصدار، وفيه توضيح إن الإصدار للإدارة", () => {
    wrap(<InvoiceBox orderId={1} orderNumber="SO-0001" role="offline_seller" info={{ invoice: null, sealKeyConfigured: true }} onIssued={() => {}} />);
    expect(screen.queryByRole("button", { name: "أصدر فاتورة" })).toBeNull();
    expect(screen.getByText(/بتتصدر من الإدارة/)).toBeTruthy();
  });

  it("فاتورة صادرة: الرقم والتاريخ ومختومة وملحوظة القفل وزرار الطباعة، ومفيش إصدار تاني", () => {
    wrap(<InvoiceBox orderId={1} orderNumber="SO-0001" role="chairman" info={{ invoice: INV, sealKeyConfigured: true }} onIssued={() => {}} />);
    expect(screen.getByText("INV-000007")).toBeTruthy();
    expect(screen.getByText("مختومة")).toBeTruthy();
    expect(screen.getByText(/الأمر مقفول لأن عليه فاتورة/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "اطبع الفاتورة الرسمية" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "أصدر فاتورة" })).toBeNull();
  });

  it("المتصفح مانع النافذة: تنبيه بدل ما يفشل في صمت", async () => {
    vi.stubGlobal("open", vi.fn(() => null));
    wrap(<InvoiceBox orderId={1} orderNumber="SO-0001" role="chairman" info={{ invoice: INV, sealKeyConfigured: true }} onIssued={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "اطبع الفاتورة الرسمية" }));
    expect(await screen.findByText(/المتصفح منع نافذة الطباعة/)).toBeTruthy();
  });

  it("من غير مخالفات a11y", async () => {
    const { container } = wrap(<InvoiceBox orderId={1} orderNumber="SO-0001" role="chairman" info={{ invoice: INV, sealKeyConfigured: true }} onIssued={() => {}} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe("طباعة الفاتورة الرسمية", () => {
  const html = officialInvoiceHtml(INV, "<svg id=\"qr\"></svg>");
  it("فيها الرقم والأصناف المختومة والـQR والرابط وأول 20 من الختم", () => {
    for (const s of ["INV-000007", "علبة 500جم", "<svg id=\"qr\"></svg>", INV.verifyUrl.replace(/&/g, "&amp;"), "a".repeat(20)]) expect(html, s).toContain(s);
    expect(html).not.toContain("a".repeat(21));
  });
  it("اسم العميل متهرّب (مفيش HTML بيتحقن)", () => {
    expect(html).toContain("شركة &lt;النور&gt;");
    expect(html).not.toContain("<النور>");
  });
  it("سطر الضريبة بيظهر لو فيه ضريبة بس", () => {
    expect(html).toContain("14");
    expect(officialInvoiceHtml({ ...INV, taxRate: "0.00", taxAmount: "0.00" }, "")).not.toContain('class="vat"');
  });
});

describe("صفحة التحقق العامة", () => {
  const open = (res: unknown) => {
    window.history.replaceState(null, "", "/v2/verify?n=INV-000007&t=aaaaaaaaaaaaaaaaaaaa");
    const f = vi.fn(async () => json(res));
    vi.stubGlobal("fetch", f);
    return f;
  };
  it("سليمة: بتوري الرقم والتاريخ والإجمالي، من غير اسم العميل", async () => {
    const f = open({ state: "valid", invoice: { invoiceNumber: "INV-000007", issueDate: "2026-11-26", total: "250.00", taxAmount: "30.70" } });
    wrap(<Verify />);
    expect(await screen.findByText("الفاتورة سليمة وصادرة من النظام.")).toBeTruthy();
    expect(screen.getByText("INV-000007")).toBeTruthy();
    expect(screen.queryByText(/النور/)).toBeNull();
    const url = String((f.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("/api/v1/public/invoices/verify");
    expect(url).toContain("n=INV-000007");
  });
  for (const [state, text] of [["tampered", /بياناتها اتغيّرت/], ["wrong_token", /مش مطابق/], ["unknown", /مفيش فاتورة بالرقم ده/], ["unverifiable", /منقدرش نتحقق/]] as const) {
    it(`حكم ${state}`, async () => {
      open({ state });
      wrap(<Verify />);
      expect(await screen.findByText(text)).toBeTruthy();
      expect(screen.queryByText("INV-000007")).toBeNull();
    });
  }
  it("فشل الاتصال: رسالة واضحة", async () => {
    window.history.replaceState(null, "", "/v2/verify?n=INV-000007&t=aaaaaaaaaaaaaaaaaaaa");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("net"); }));
    wrap(<Verify />);
    expect(await screen.findByText(/حصلت مشكلة في الاتصال/)).toBeTruthy();
  });
});

describe("تبويب الفواتير", () => {
  const ROW = { id: 7, invoiceNumber: "INV-000007", orderNumber: "SO-0001", customerName: "شركة النور", issueDate: "2026-11-26", total: "250.00", issuedByName: "رئيس" };
  const mock = (integrity: unknown, keyOk = true) => vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const p = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://x").pathname;
    if (p === "/api/v1/invoices/integrity") return json(integrity);
    if (p === "/api/v1/invoices") return json({ items: [ROW], sealKeyConfigured: keyOk });
    return json({ error: { message: "x" } }, 404);
  }));
  it("بيعرض الفواتير، والفحص السليم بيقول كله سليم", async () => {
    mock({ keyConfigured: true, keyId: "ab", total: 1, ok: true, badSeals: [], otherKey: [], gaps: { missing: [], duplicates: [], malformed: [] } });
    wrap(<InvoicesPanel />);
    expect(await screen.findByText("INV-000007")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "افحص السلامة" }));
    expect(await screen.findByText(/كله سليم/)).toBeTruthy();
  });
  it("الفحص بيبيّن الفجوات والأختام المتغيّرة", async () => {
    mock({ keyConfigured: true, keyId: "ab", total: 3, ok: false, badSeals: ["INV-000002"], otherKey: [], gaps: { missing: ["INV-000003"], duplicates: [], malformed: [] } });
    wrap(<InvoicesPanel />);
    await screen.findByText("INV-000007");
    fireEvent.click(screen.getByRole("button", { name: "افحص السلامة" }));
    expect(await screen.findByText(/أرقام ناقصة: INV-000003/)).toBeTruthy();
    expect(screen.getByText(/أختام مش مطابقة.*INV-000002/)).toBeTruthy();
  });
  it("المفتاح ناقص: تحذير فوق الجدول", async () => {
    mock({}, false);
    wrap(<InvoicesPanel />);
    expect(await screen.findByText(/مفتاح ختم الفاتورة مش متضبط على السيرفر: مفيش إصدار/)).toBeTruthy();
  });
});

describe("أمر البيع بفاتورة", () => {
  const order = (status: string) => ({ id: 1, orderNumber: "SO-0001", contactId: 5, channel: "direct", date: "2026-10-01", dueDate: null, status, notes: null, subtotal: "250.00", total: "250.00", createdAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-01T08:00:00Z", items: [{ id: 1, description: "علبة", qty: "10.000", unitPrice: "25.00", total: "250.00" }] });
  const mount = (status: string, invoice: Invoice | null) => {
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const p = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://x").pathname;
      paths.push(p);
      if (p === "/api/v1/sales/1") return json(order(status));
      if (p === "/api/v1/invoices/by-order/1") return json({ invoice, sealKeyConfigured: true });
      return json({ error: { message: "x" } }, 404);
    }));
    wrap(<SalesDetail id={1} role="chairman" customerName={() => "شركة النور"} onClose={() => {}} onChanged={() => {}} onEdit={() => {}} />);
    return paths;
  };
  it("بفاتورة: مفيش تعديل ولا إلغاء ولا مسح، وفيه صندوق الفاتورة", async () => {
    mount("confirmed", INV);
    expect(await screen.findByText("مختومة")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^عد/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^ألغ/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "امسح" })).toBeNull();
    expect(screen.getByRole("button", { name: "اطبع الفاتورة الرسمية" })).toBeTruthy();
  });
  it("من غير فاتورة وأمر معتمد: التعديل متاح وزرار الإصدار ظاهر", async () => {
    mount("confirmed", null);
    expect(await screen.findByRole("button", { name: "أصدر فاتورة" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^عد/ })).toBeTruthy();
  });
  it("المسودة: مفيش طلب فاتورة أصلًا ومفيش صندوق", async () => {
    const paths = mount("draft", null);
    await screen.findByText(/SO-0001/);
    expect(paths.some((p) => p.includes("/invoices/"))).toBe(false);
    expect(screen.queryByText("الفاتورة الرسمية")).toBeNull();
  });
});
