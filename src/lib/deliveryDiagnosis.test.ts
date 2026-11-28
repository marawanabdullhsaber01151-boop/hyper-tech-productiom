/** @format */
import { describe, expect, it } from "vitest";
import { channelText, configHint, errorCodeText, summarizeDead, summarizeFailures } from "./deliveryDiagnosis";

describe("errorCodeText", () => {
  it("أكواد المزوّدين", () => {
    expect(errorCodeText("http_401")).toMatch(/مفتاح/);
    expect(errorCodeText("http_403")).toMatch(/مفتاح/);
    expect(errorCodeText("http_429")).toMatch(/الحد/);
    expect(errorCodeText("http_503")).toMatch(/واقع/);
    expect(errorCodeText("http_422")).toMatch(/رفض/);
    expect(errorCodeText("request_failed")).toMatch(/ما ردّش/);
    expect(errorCodeText("provider_failed")).toMatch(/رفض/);
    expect(errorCodeText("exception")).toMatch(/غير متوقع/);
  });
  it("فاضي أو مجهول", () => {
    expect(errorCodeText(null)).toMatch(/بدون سبب/);
    expect(errorCodeText("")).toMatch(/بدون سبب/);
    expect(errorCodeText("zzz")).toContain("zzz");
  });
});

describe("summarizeFailures", () => {
  it("بيجمّع نفس القناة والسبب ويرتّب بالأكتر", () => {
    const out = summarizeFailures([
      { channel: "email", error_code: "http_401", n: 1 },
      { channel: "email", error_code: "http_401", n: 1 },
      { channel: "sms", error_code: "provider_failed", n: 1 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("الإيميل");
    expect(out[0]).toContain("×2");
    expect(out[1]).toContain("الرسائل النصية");
    expect(out[1]).not.toContain("×");
  });
  it("حد أقصى 5 وقناة مجهولة", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ channel: `c${i}`, error_code: "failed", n: 1 }));
    expect(summarizeFailures(rows)).toHaveLength(5);
    expect(channelText(null)).toBe("قناة غير معروفة");
    expect(channelText("telegram")).toBe("تيليجرام");
  });
});

describe("summarizeDead + configHint", () => {
  it("بيقصّ الخطأ الطويل ويشيل الأسطر", () => {
    const out = summarizeDead([{ event_type: "notify", last_error: "x\n".repeat(200), n: 3 }]);
    expect(out[0]!.length).toBeLessThan(130);
    expect(out[0]).toContain("(×3)");
    expect(out[0]).not.toContain("\n");
    expect(summarizeDead([{ event_type: "a", last_error: null, n: 1 }])[0]).toContain("من غير رسالة خطأ");
  });
  it("تلميح الإعداد", () => {
    expect(configHint({ sms: false, email: false })).toMatch(/مش|ولا/);
    expect(configHint({ sms: true, email: false })).toBeNull();
  });
});
