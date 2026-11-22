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

const openMap = async () => { fireEvent.click(await screen.findByRole("tab", { name: "خريطة النظام" })); };

const mount = (body: unknown = LIVE, status = 200) => {
  vi.stubGlobal("fetch", vi.fn(async () => json(body, status)));
  return render(<Guide />);
};

describe("دليل النظام", () => {
  it("بيعرض العنوان وخريطة الأقسام، والضغط على قسم بيوريه صفحاته", async () => {
    mount();
    await openMap();
    expect(await screen.findByText("النظام كله في صورة واحدة")).toBeTruthy();
    expect(screen.getByText("اختار قسم من الخريطة")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "المبيعات" }));
    expect(await screen.findByText("صفحات القسم")).toBeTruthy();
    expect(screen.getByRole("button", { name: "أوامر البيع" })).toBeTruthy();
  });

  it("قسم مفيش فيه صفحات للدور بيقول كده بدل ما يفضل فاضي", async () => {
    mount();
    await openMap();
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
    expect(await screen.findByText(/كلمة سر العميل 6 حروف على الأقل/)).toBeTruthy();
  });

  it("تبويب الحسابات: المفاهيم وجدول القيود التلقائية", async () => {
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "الحسابات" }));
    expect(await screen.findByText("الحسابات بالبلدي")).toBeTruthy();
    expect(screen.getByText("التصحيح بالعكس")).toBeTruthy();
    expect(screen.getByText("تحصيل من عميل")).toBeTruthy();
    expect(screen.getAllByText(/مدينون العملاء \(1130\)/).length).toBeGreaterThan(1);
  });
  it("فهرس الشاشات: بيعرض الشاشات والأزرار وشرحها، والبحث بيفلتر، ومفيش نتايج بيقول كده", async () => {
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "فهرس الشاشات والأزرار" }));
    expect(await screen.findByText("كل شاشة وكل زرار")).toBeTruthy();
    expect(screen.getByText("فواتير المبيعات")).toBeTruthy();
    expect(screen.getByText("شاشات العميل (البوابة)")).toBeTruthy();
    expect(screen.getAllByText("رحّل القيد").length).toBe(1);
    fireEvent.input(screen.getByLabelText("ابحث باسم شاشة أو زرار"), { target: { value: "تحصيل جديد" } });
    expect(await screen.findByText("الحسابات والقيود")).toBeTruthy();
    expect(screen.queryByText("فواتير المبيعات")).toBeNull();
    fireEvent.input(screen.getByLabelText("ابحث باسم شاشة أو زرار"), { target: { value: "زززززز" } });
    expect(await screen.findByText("مفيش نتايج للبحث ده.")).toBeTruthy();
  });

  it("السيناريوهات والقاموس", async () => {
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "سيناريوهات وقاموس" }));
    expect(await screen.findByText("عميل هيعدّي حد الائتمان")).toBeTruthy();
    expect(screen.getByText("القيد العكسي")).toBeTruthy();
    expect(screen.getByText(/مهلة الرد \(SLA\)/)).toBeTruthy();
  });
});

describe("دليل النظام على الموبايل", () => {
  it("الخريطة بتتحول لقائمة بتتفتح كروت، والضغط بيفتح التفاصيل", async () => {
    const old = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
    try {
      mount();
      await openMap();
      await screen.findByText("النظام كله في صورة واحدة");
      expect(document.querySelector("svg.gd-svg")).toBeNull();
      const head = screen.getByRole("button", { name: "المبيعات" });
      expect(head.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(head);
      expect(head.getAttribute("aria-expanded")).toBe("true");
      expect(await screen.findByText("صفحات القسم")).toBeTruthy();
      fireEvent.click(head);
      expect(head.getAttribute("aria-expanded")).toBe("false");
    } finally {
      window.matchMedia = old;
    }
  });
});

const LIVE4: GuideLive = {
  ...LIVE,
  nav: [
    { id: "x", label: "قسم", icon: "i", roles: ["chairman", "buyer"], subFunctions: [{ id: "s", label: "س", pages: [
      { id: "approvals", label: "صندوق الاعتمادات", href: "/v2/staff/approvals", roles: ["chairman"] },
      { id: "system-health", label: "صحة النظام", href: "/v2/staff/health", roles: ["chairman"] },
      { id: "purchases", label: "المشتريات", href: "/v2/staff/purchases", roles: ["chairman", "buyer"] },
    ] }] },
  ],
};

describe("دليل النظام: ابدأ من هنا والأمان والأسئلة", () => {
  it("ابدأ من هنا هو التبويب الأول، وبيعرض خطوات الدور بشاشاته المتاحة بس", async () => {
    mount(LIVE4);
    expect(await screen.findByText("ابدأ من هنا: يومك في النظام")).toBeTruthy();
    expect(screen.getByText("الإدارة العليا: القرارات والرقابة")).toBeTruthy();
    expect(screen.getAllByText(/صندوق الاعتمادات والإدارة|صندوق الاعتمادات وإدارتها/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/الحسابات والقيود/)).toBeNull();
  });

  it("تغيير الدور بيغيّر المجموعة والخطوات", async () => {
    mount(LIVE4);
    await screen.findByText("ابدأ من هنا: يومك في النظام");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "buyer" } });
    expect(await screen.findByText("المشتريات")).toBeTruthy();
    expect(screen.getByText(/الشرح بيبدأ|ابدأ من الاحتياجات/)).toBeTruthy();
    expect(screen.queryByText("الإدارة العليا: القرارات والرقابة")).toBeNull();
  });

  it("تبويب الأمان بيعرض الضوابط ومكان التحقق، والأسئلة الشائعة بتتفتح", async () => {
    mount(LIVE4);
    fireEvent.click(await screen.findByRole("tab", { name: "الأمان والضوابط" }));
    expect(await screen.findByText("ليه النظام آمن؟ ضوابط تطمّنك")).toBeTruthy();
    expect(screen.getByText("مفيش حد يعتمد طلب هو اللي عمله")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "سيناريوهات وقاموس" }));
    expect(await screen.findByText("أسئلة بتتسأل كتير")).toBeTruthy();
    expect(screen.getByText("تايه ومش عارف أفتح إيه؟")).toBeTruthy();
  });

  it("فصل العميل بيظهر تحت بوابة العملاء", async () => {
    mount(LIVE4);
    fireEvent.click(await screen.findByRole("tab", { name: "بوابة العملاء" }));
    expect(await screen.findByText("للعميل على البوابة: خطوة بخطوة")).toBeTruthy();
  });
});
