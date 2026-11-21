import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Guide } from "./Guide";
import type { GuideLive } from "./guideModel";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const LIVE: GuideLive = {
  roles: [
    { id: "chairman", label: "رئيس مجلس الإدارة", approver: true, exempt: true },
    { id: "sales_manager", label: "مدير المبيعات", approver: true, exempt: false },
    { id: "buyer", label: "المشتري", approver: false, exempt: false },
  ],
  permissions: [
    { resource: "sales", action: "view", roles: ["chairman", "sales_manager"] },
    { resource: "sales", action: "write", roles: ["chairman", "sales_manager"] },
    { resource: "purchases", action: "view", roles: ["chairman", "buyer"] },
  ],
  nav: [
    { id: "sales", label: "المبيعات", icon: "cart", roles: ["chairman", "sales_manager"], subFunctions: [{ id: "o", label: "الأوامر", pages: [{ id: "sales-orders", label: "أوامر البيع", href: "/v2/staff/sales", roles: ["chairman", "sales_manager"] }] }] },
  ],
  policies: [
    { actionKey: "sales.approve", tiers: [
      { minAmount: "0", steps: [{ sequence: 1, roles: ["sales_manager"], requiredApprovals: 1 }] },
      { minAmount: "100000", steps: [{ sequence: 1, roles: ["chairman"], requiredApprovals: 1 }] },
    ] },
  ],
  sla: { minutes: 240, soonAt: 0.75, hours: { start: 9, end: 17, offDay: 5 } },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (body: unknown = LIVE, status = 200) => {
  vi.stubGlobal("fetch", vi.fn(async () => json(body, status)));
  return render(<Guide />);
};

describe("دليل النظام", () => {
  it("بيعرض العنوان وخريطة الأقسام، والضغط على قسم بيوريه صفحاته", async () => {
    mount();
    expect(await screen.findByText("النظام كله في صورة واحدة")).toBeTruthy();
    expect(screen.getByText("اختار قسم من الخريطة")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "المبيعات" }));
    expect(await screen.findByText("صفحات القسم")).toBeTruthy();
    expect(screen.getByRole("button", { name: "أوامر البيع" })).toBeTruthy();
  });

  it("قسم مفيش فيه صفحات للدور بيقول كده بدل ما يفضل فاضي", async () => {
    mount();
    await screen.findByText("النظام كله في صورة واحدة");
    fireEvent.click(screen.getByRole("button", { name: "الجودة" }));
    expect(await screen.findByText(/مفيش صفحات ليك في القسم ده/)).toBeTruthy();
  });

  it("تبويب الأدوار: المصفوفة بتعرض كل دور، واختيار دور بيوريه المعتمد/المعفي", async () => {
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "الأدوار والصلاحيات" }));
    expect(await screen.findByText("مين يقدر يعمل إيه")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "المشتري" }));
    expect(await screen.findByText(/مش معتمد/)).toBeTruthy();
    expect(screen.getByText(/مينفعش يعتمد طلب هو اللي أنشأه/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "رئيس مجلس الإدارة" }));
    expect(await screen.findByText(/معفي من منع اعتماد النفس/)).toBeTruthy();
  });

  it("تبويب الاعتمادات: السياسات الحية والمهلة، والمحاكي بيختار الشريحة بالمبلغ", async () => {
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "الاعتمادات والتصعيد" }));
    expect(await screen.findByText("سياسات الاعتماد الحالية")).toBeTruthy();
    expect(screen.getByText(/مهلة الرد: 4 ساعات عمل/)).toBeTruthy();
    expect(screen.getAllByText("اعتماد أمر بيع").length).toBeGreaterThan(0);
    // 120000 افتراضيًا ← شريحة الرئيس
    const result = screen.getByText("الطلب ده هيعدّي على:").parentElement!.nextElementSibling!;
    expect(result.textContent).toContain("رئيس مجلس الإدارة");
    fireEvent.input(screen.getByLabelText("المبلغ بالجنيه"), { target: { value: "500" } });
    expect((screen.getByText("الطلب ده هيعدّي على:").parentElement!.nextElementSibling as HTMLElement).textContent).toContain("مدير المبيعات");
  });

  it("مفيش سياسات ← رسالة واضحة ومفيش محاكي", async () => {
    mount({ ...LIVE, policies: [] });
    fireEvent.click(await screen.findByRole("tab", { name: "الاعتمادات والتصعيد" }));
    expect(await screen.findByText("مفيش سياسات اعتماد متسجلة.")).toBeTruthy();
    expect(screen.queryByText("جرّب بنفسك")).toBeNull();
  });

  it("تبويب رحلة الأمر: الضغط على حالة بيعرض أثرها على المخزن والحسابات", async () => {
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "رحلة أمر البيع" }));
    fireEvent.click(await screen.findByRole("button", { name: "تم الشحن" }));
    expect(await screen.findByText("أثره على المخزن")).toBeTruthy();
    expect(screen.getByText(/الكمية بتتخصم فعليًا من المخزون/)).toBeTruthy();
  });

  it("فشل التحميل ← رسالة وزر محاولة تانية", async () => {
    mount({ error: { code: "X", message: "عطل" } }, 500);
    expect(await screen.findByText("مقدرناش نحمّل بيانات الدليل")).toBeTruthy();
    expect(screen.getByRole("button", { name: "جرّب تاني" })).toBeTruthy();
  });
  it("تبويب التصنيع: خريطتين، والضغط على خطوة بيعرض مين بيعملها", async () => {
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "التصنيع والجودة" }));
    expect(await screen.findByText("طلب خامات للإنتاج")).toBeTruthy();
    expect(screen.getByText("أمر الإنتاج")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "قرار المخزن" }));
    expect(await screen.findByText(/مدير المخازن أو أمين المخزن/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "فحص الجودة" }));
    expect(await screen.findByText(/المشرف لا/)).toBeTruthy();
    expect(screen.getByText(/أقل من 95%/)).toBeTruthy();
  });

  it("تبويب المشتريات: فحص الخامات فيه فصل المهام ودخول المخزون بعد الفحص بس", async () => {
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "المشتريات والمخزن" }));
    fireEvent.click(await screen.findByRole("button", { name: "فحص الخامات" }));
    expect(await screen.findByText(/فصل المهام/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "دخول المخزون" }));
    expect(await screen.findByText(/المقبول بس بيدخل/)).toBeTruthy();
  });

  it("تبويب البوابة: كلمة سر العميل 6 حروف", async () => {
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "بوابة العملاء" }));
    fireEvent.click(await screen.findByRole("button", { name: "حساب العميل" }));
    expect(await screen.findByText(/6 حروف على الأقل/)).toBeTruthy();
  });

  it("تبويب الحسابات: المفاهيم وجدول القيود التلقائية", async () => {
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "الحسابات" }));
    expect(await screen.findByText("الحسابات بالبلدي")).toBeTruthy();
    expect(screen.getByText("التصحيح بالعكس")).toBeTruthy();
    expect(screen.getByText("تحصيل من عميل")).toBeTruthy();
    expect(screen.getAllByText(/مدينون العملاء \(1130\)/).length).toBeGreaterThan(1);
  });
});
