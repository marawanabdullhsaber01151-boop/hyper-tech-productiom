import { describe, expect, it } from "vitest";
import {
  MAX_TRANSFER_AGE_DAYS, REVIEW_SLA_MINUTES, canDecide, checkReport, confirmBodySchema, customerNotice, decideConfirm, defaultPaymentMethod,
  referenceKey, rejectBodySchema, reportBodySchema, reviewDueAt, taskDedupeKey, toPortalView, type TransferReportRow,
} from "./transferReportsCore";

const base = { amount: "1500", transferDate: "2026-11-10", method: "bank" as const, reference: "TRX-123" };
const TODAY = "2026-11-12";

describe("البلاغ: التحقق من البيانات", () => {
  it("بلاغ سليم بيعدّي ومبلغه بالقرش", () => {
    const r = checkReport(base, TODAY);
    expect(r).toEqual({ ok: true, cents: 150000n });
  });
  it("المبلغ: صفر وسالب وحروف وأكتر من خانتين وفاضي كله مرفوض", () => {
    for (const amount of ["0", "0.00", "-5", "abc", "10.999", "", " ", "1e3", "1,000"]) {
      const r = checkReport({ ...base, amount }, TODAY);
      expect(r.ok, amount).toBe(false);
      if (!r.ok) expect(r.code).toBe("BAD_AMOUNT");
    }
  });
  it("المبلغ بمسافات حوالين الرقم بيتقبل", () => {
    expect(checkReport({ ...base, amount: " 99.5 " }, TODAY)).toEqual({ ok: true, cents: 9950n });
  });
  it("تاريخ في المستقبل مرفوض، وتاريخ النهارده مقبول", () => {
    const f = checkReport({ ...base, transferDate: "2026-11-13" }, TODAY);
    expect(f.ok).toBe(false);
    if (!f.ok) expect(f.code).toBe("FUTURE_DATE");
    expect(checkReport({ ...base, transferDate: TODAY }, TODAY).ok).toBe(true);
  });
  it("أقدم من 90 يوم مرفوض، وبالظبط 90 يوم مقبول (حد الحدود)", () => {
    expect(MAX_TRANSFER_AGE_DAYS).toBe(90);
    expect(checkReport({ ...base, transferDate: "2026-08-14" }, TODAY).ok).toBe(true); // 90 يوم
    const old = checkReport({ ...base, transferDate: "2026-08-13" }, TODAY); // 91 يوم
    expect(old.ok).toBe(false);
    if (!old.ok) expect(old.code).toBe("TOO_OLD");
  });
  it("رقم العملية: أقل من 3 حروف مرفوض، والمسافات بتتشال قبل العد", () => {
    expect(reportBodySchema.safeParse({ ...base, reference: "ab" }).success).toBe(false);
    expect(reportBodySchema.safeParse({ ...base, reference: "  a  " }).success).toBe(false);
    expect(reportBodySchema.safeParse({ ...base, reference: "abc" }).success).toBe(true);
    expect(reportBodySchema.safeParse({ ...base, reference: "x".repeat(121) }).success).toBe(false);
  });
  it("الطريقة: من القايمة بس، والتاريخ لازم يكون تاريخ حقيقي", () => {
    expect(reportBodySchema.safeParse({ ...base, method: "cash" }).success).toBe(false);
    expect(reportBodySchema.safeParse({ ...base, transferDate: "2026-02-30" }).success).toBe(false);
    expect(reportBodySchema.safeParse({ ...base, transferDate: "10/11/2026" }).success).toBe(false);
  });
  it("الملاحظة اختيارية وبحد أقصى 500", () => {
    expect(reportBodySchema.safeParse({ ...base, note: null }).success).toBe(true);
    expect(reportBodySchema.safeParse({ ...base, note: "x".repeat(501) }).success).toBe(false);
  });
  it("مفتاح التكرار مبيفرّقش بين حروف كبيرة وصغيرة ولا مسافات", () => {
    expect(referenceKey("  TRX-9 ")).toBe(referenceKey("trx-9"));
  });
});

describe("مهلة المالية: 240 دقيقة عمل (9 إلى 5 بتوقيت القاهرة، الجمعة إجازة)", () => {
  it("المهلة هي نفس مهلة الاعتمادات", () => expect(REVIEW_SLA_MINUTES).toBe(240));
  it("بلاغ الساعة 9 الصبح (الأحد) ميعاده 1 الضهر نفس اليوم", () => {
    expect(reviewDueAt(new Date("2026-11-01T07:00:00Z")).toISOString()).toBe("2026-11-01T11:00:00.000Z");
  });
  it("بلاغ الخميس 4 العصر: ساعة اليوم، والجمعة إجازة، والباقي السبت (12 الضهر)", () => {
    expect(reviewDueAt(new Date("2026-11-05T14:00:00Z")).toISOString()).toBe("2026-11-07T10:00:00.000Z");
  });
  it("بلاغ الجمعة بيتحسب من السبت 9 الصبح", () => {
    expect(reviewDueAt(new Date("2026-11-06T09:00:00Z")).toISOString()).toBe("2026-11-07T11:00:00.000Z");
  });
  it("بلاغ بعد الساعة 5 بيتحسب من تاني يوم عمل", () => {
    expect(reviewDueAt(new Date("2026-11-01T16:00:00Z")).toISOString()).toBe("2026-11-02T11:00:00.000Z");
  });
  it("الموعد دايمًا بعد وقت الإبلاغ", () => {
    for (const d of ["2026-11-01T00:00:00Z", "2026-11-06T12:00:00Z", "2026-11-07T20:00:00Z"]) {
      expect(reviewDueAt(new Date(d)).getTime()).toBeGreaterThan(new Date(d).getTime());
    }
  });
});

describe("قرار التأكيد", () => {
  it("من غير تعديل: بياخد المبلغ المُبلَّغ ومش محتاج ملاحظة", () => {
    expect(decideConfirm(150000n, {})).toEqual({ ok: true, cents: 150000n, differs: false });
    expect(decideConfirm(150000n, { amount: "1500.00" })).toEqual({ ok: true, cents: 150000n, differs: false });
  });
  it("مبلغ مختلف من غير ملاحظة مرفوض، ومعاها مقبول", () => {
    const no = decideConfirm(150000n, { amount: "1490" });
    expect(no.ok).toBe(false);
    if (!no.ok) expect(no.code).toBe("NOTE_REQUIRED");
    expect(decideConfirm(150000n, { amount: "1490", note: "  ab " }).ok).toBe(false);
    expect(decideConfirm(150000n, { amount: "1490", note: "خصم عمولة البنك" })).toEqual({ ok: true, cents: 149000n, differs: true });
  });
  it("مبلغ مؤكَّد غلط (صفر أو حروف) مرفوض", () => {
    for (const amount of ["0", "x", "-1", "1.234"]) {
      const r = decideConfirm(150000n, { amount, note: "سبب" });
      expect(r.ok, amount).toBe(false);
      if (!r.ok) expect(r.code).toBe("BAD_AMOUNT");
    }
  });
  it("الرفض لازم سبب 3 حروف على الأقل", () => {
    expect(rejectBodySchema.safeParse({ reason: "  " }).success).toBe(false);
    expect(rejectBodySchema.safeParse({ reason: "ab" }).success).toBe(false);
    expect(rejectBodySchema.safeParse({ reason: "مش واصل" }).success).toBe(true);
  });
  it("جسم التأكيد: الطريقة نقدي أو بنك بس، والتاريخ حقيقي", () => {
    expect(confirmBodySchema.safeParse({ method: "wallet" }).success).toBe(false);
    expect(confirmBodySchema.safeParse({ method: "bank", paymentDate: "2026-13-01" }).success).toBe(false);
    expect(confirmBodySchema.safeParse({}).success).toBe(true);
  });
  it("القرار مرة واحدة: المعلّق بس هو اللي يتقرر فيه", () => {
    expect(canDecide("pending")).toBe(true);
    expect(canDecide("confirmed")).toBe(false);
    expect(canDecide("rejected")).toBe(false);
  });
  it("المحفظة نقدي، والبنك وإنستاباي بنك", () => {
    expect(defaultPaymentMethod("wallet")).toBe("cash");
    expect(defaultPaymentMethod("bank")).toBe("bank");
    expect(defaultPaymentMethod("instapay")).toBe("bank");
  });
  it("مفتاح منع تكرار المهمة ثابت لكل بلاغ ومختلف بين البلاغات", () => {
    expect(taskDedupeKey(7)).toBe(taskDedupeKey(7));
    expect(taskDedupeKey(7)).not.toBe(taskDedupeKey(8));
  });
});

const row: TransferReportRow = {
  id: 1, reportNumber: "TR-00001", contactId: 5, portalCustomerId: 9, reportedByName: "أحمد", amount: "1500.00", transferDate: "2026-11-10", method: "bank",
  reference: "TRX-123", note: "دفعة الأوردر", status: "pending", taskId: 77, paymentId: null, paymentNumber: null, confirmedAmount: null, reviewNote: "داخلي: عميل متأخر",
  rejectReason: null, reviewedByName: "مدير المالية", reviewedAt: null, createdAt: "2026-11-10T08:00:00.000Z",
};

describe("اللي العميل بيشوفه وإشعاراته", () => {
  it("عرض البوابة مفيهوش مهمة داخلية ولا ملاحظة المالية ولا اسم المراجع ولا رقم التحصيل ولا رقم العميل الداخلي", () => {
    const v = toPortalView(row) as Record<string, unknown>;
    for (const k of ["taskId", "reviewNote", "reviewedByName", "paymentId", "paymentNumber", "contactId", "portalCustomerId"]) expect(k in v, k).toBe(false);
    expect(JSON.stringify(v)).not.toContain("داخلي");
  });
  it("سبب الرفض بيظهر للعميل في المرفوض بس، والمبلغ المؤكَّد في المؤكَّد بس", () => {
    expect(toPortalView({ ...row, status: "rejected", rejectReason: "مش واصل" }).rejectReason).toBe("مش واصل");
    expect(toPortalView({ ...row, status: "pending", rejectReason: "x" }).rejectReason).toBeNull();
    expect(toPortalView({ ...row, status: "confirmed", confirmedAmount: "1490.00" }).confirmedAmount).toBe("1490.00");
    expect(toPortalView({ ...row, status: "pending", confirmedAmount: "1490.00" }).confirmedAmount).toBeNull();
  });
  it("إشعار التأكيد فيه المبلغ المؤكَّد، وإشعار الرفض فيه السبب", () => {
    expect(customerNotice({ ...row, status: "confirmed", confirmedAmount: "1490.00" }).body).toContain("1490.00");
    const rej = customerNotice({ ...row, status: "rejected", rejectReason: "مش واصل" });
    expect(rej.body).toContain("مش واصل");
    expect(rej.body).toContain("TR-00001");
  });
});
