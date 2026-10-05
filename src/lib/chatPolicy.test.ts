/** @format */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAT_CONFIG,
  mergeChatConfig,
  validateChatConfig,
  businessMinutesBetween,
  chatPreview,
  deriveDeliveryStatus,
  detectImageMime,
  isEscalationDue,
  isWithinBusinessHours,
  parseChatImageDataUrl,
  resolveChatAccess,
  shouldSendAutoReply,
} from "./chatPolicy";

// أكتوبر 2026: القاهرة على التوقيت الصيفي (UTC+3) حتى آخر خميس في الشهر.
const cairo = (iso: string) => new Date(`${iso}+03:00`);

describe("business hours (Africa/Cairo, Sat–Thu 09:00–17:00)", () => {
  it("is open on a Sunday morning", () => {
    expect(isWithinBusinessHours(cairo("2026-10-04T10:00:00"))).toBe(true);
  });
  it("is closed on Friday all day", () => {
    expect(isWithinBusinessHours(cairo("2026-10-02T12:00:00"))).toBe(false);
  });
  it("is open on Saturday", () => {
    expect(isWithinBusinessHours(cairo("2026-10-03T09:00:00"))).toBe(true);
  });
  it("closes exactly at 17:00 and opens exactly at 09:00", () => {
    expect(isWithinBusinessHours(cairo("2026-10-04T16:59:00"))).toBe(true);
    expect(isWithinBusinessHours(cairo("2026-10-04T17:00:00"))).toBe(false);
    expect(isWithinBusinessHours(cairo("2026-10-04T08:59:00"))).toBe(false);
  });
  it("uses Cairo time, not UTC (winter, UTC+2)", () => {
    // 08:30 UTC = 10:30 Cairo in January → open
    expect(isWithinBusinessHours(new Date("2026-01-04T08:30:00Z"))).toBe(true);
    // 15:30 UTC = 17:30 Cairo in January → closed
    expect(isWithinBusinessHours(new Date("2026-01-04T15:30:00Z"))).toBe(false);
  });
});

describe("businessMinutesBetween", () => {
  it("counts plain minutes inside one working window", () => {
    expect(
      businessMinutesBetween(
        cairo("2026-10-04T10:00:00"),
        cairo("2026-10-04T10:20:00"),
      ),
    ).toBe(20);
  });
  it("skips the night: 16:50 → next day 09:10 = 20 business minutes", () => {
    expect(
      businessMinutesBetween(
        cairo("2026-10-04T16:50:00"),
        cairo("2026-10-05T09:10:00"),
      ),
    ).toBe(20);
  });
  it("skips Friday: Thu 16:55 → Sat 09:10 = 15 business minutes", () => {
    expect(
      businessMinutesBetween(
        cairo("2026-10-01T16:55:00"),
        cairo("2026-10-03T09:10:00"),
      ),
    ).toBe(15);
  });
  it("is zero when the whole span is outside business hours", () => {
    expect(
      businessMinutesBetween(
        cairo("2026-10-02T09:00:00"),
        cairo("2026-10-02T17:00:00"),
      ),
    ).toBe(0);
  });
  it("is zero for reversed or empty ranges", () => {
    const t = cairo("2026-10-04T10:00:00");
    expect(businessMinutesBetween(t, t)).toBe(0);
    expect(businessMinutesBetween(cairo("2026-10-04T11:00:00"), t)).toBe(0);
  });
});

describe("escalation", () => {
  const since = cairo("2026-10-04T10:00:00");
  it("is not due before the threshold", () => {
    expect(
      isEscalationDue({
        awaitingStaffSince: since,
        escalatedAt: null,
        now: cairo("2026-10-04T10:14:00"),
        thresholdBusinessMinutes: 15,
      }),
    ).toBe(false);
  });
  it("is due at the threshold", () => {
    expect(
      isEscalationDue({
        awaitingStaffSince: since,
        escalatedAt: null,
        now: cairo("2026-10-04T10:15:00"),
        thresholdBusinessMinutes: 15,
      }),
    ).toBe(true);
  });
  it("never escalates twice or when nobody is waiting", () => {
    expect(
      isEscalationDue({
        awaitingStaffSince: since,
        escalatedAt: cairo("2026-10-04T10:16:00"),
        now: cairo("2026-10-04T12:00:00"),
      }),
    ).toBe(false);
    expect(
      isEscalationDue({
        awaitingStaffSince: null,
        escalatedAt: null,
        now: cairo("2026-10-04T12:00:00"),
      }),
    ).toBe(false);
  });
  it("does not escalate a Friday-night message until business time passes", () => {
    expect(
      isEscalationDue({
        awaitingStaffSince: cairo("2026-10-02T21:00:00"),
        escalatedAt: null,
        now: cairo("2026-10-03T09:10:00"),
        thresholdBusinessMinutes: 15,
      }),
    ).toBe(false);
  });
});

describe("auto reply", () => {
  it("never replies inside working hours", () => {
    expect(
      shouldSendAutoReply({
        now: cairo("2026-10-04T10:00:00"),
        lastAutoReplyAt: null,
      }),
    ).toBe(false);
  });
  it("replies once outside hours then cools down", () => {
    const now = cairo("2026-10-04T20:00:00");
    expect(shouldSendAutoReply({ now, lastAutoReplyAt: null })).toBe(true);
    expect(
      shouldSendAutoReply({
        now,
        lastAutoReplyAt: cairo("2026-10-04T18:00:00"),
      }),
    ).toBe(false);
    expect(
      shouldSendAutoReply({
        now,
        lastAutoReplyAt: cairo("2026-10-04T10:00:00"),
      }),
    ).toBe(true);
  });
});

describe("staff access", () => {
  it("manager controls every conversation", () => {
    const a = resolveChatAccess("sales_manager", 1, 99);
    expect(a).toMatchObject({ canView: true, canReply: true, canManage: true });
  });
  it("chairman has full manager access", () => {
    expect(resolveChatAccess("chairman", 1, 5)).toMatchObject({
      canView: true,
      canReply: true,
      canManage: true,
    });
  });
  it("executive manager is read-only and audited by default", () => {
    expect(resolveChatAccess("executive_manager", 1, 5)).toMatchObject({
      canView: true,
      canReply: false,
      canManage: false,
      mustAudit: true,
    });
  });
  it("a manager override beats the role default", () => {
    expect(resolveChatAccess("buyer", 1, 1).canView).toBe(false);
    expect(resolveChatAccess("buyer", 1, 1, "agent").canReply).toBe(true);
    expect(resolveChatAccess("sales_manager", 1, 1, "none").canView).toBe(false);
    expect(resolveChatAccess("executive_manager", 1, 5, "manager").canManage).toBe(true);
  });
  it("seller sees own and unassigned, not someone else's", () => {
    expect(resolveChatAccess("online_seller", 7, 7).canReply).toBe(true);
    expect(resolveChatAccess("online_seller", 7, null)).toMatchObject({
      canView: true,
      canReply: true,
      replyClaims: true,
    });
    expect(resolveChatAccess("online_seller", 7, 8).canView).toBe(false);
  });
  it("unrelated roles get nothing", () => {
    expect(resolveChatAccess("storekeeper", 3, null).canView).toBe(false);
  });
});

describe("images", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  it("detects mime from magic bytes", () => {
    expect(detectImageMime(png)).toBe("image/png");
    expect(detectImageMime(jpg)).toBe("image/jpeg");
    expect(detectImageMime(Buffer.from("hello world!!"))).toBeNull();
  });
  it("rejects a fake image whose bytes are not an image", () => {
    const url = `data:image/png;base64,${Buffer.from("<script>alert(1)</script>").toString("base64")}`;
    expect(() => parseChatImageDataUrl(url)).toThrow(/ليس صورة/);
  });
  it("rejects non-image data URLs and oversize payloads", () => {
    expect(() =>
      parseChatImageDataUrl("data:text/html;base64,PGI+aGk8L2I+"),
    ).toThrow();
    const big = Buffer.concat([png, Buffer.alloc(700 * 1024)]);
    expect(() =>
      parseChatImageDataUrl(`data:image/png;base64,${big.toString("base64")}`),
    ).toThrow(/كبير/);
  });
  it("accepts a valid small image", () => {
    const parsed = parseChatImageDataUrl(
      `data:image/png;base64,${png.toString("base64")}`,
    );
    expect(parsed.mime).toBe("image/png");
  });
});

describe("misc", () => {
  it("derives delivery status from counterpart pointers", () => {
    expect(deriveDeliveryStatus(10, 5, 3)).toBe("sent");
    expect(deriveDeliveryStatus(4, 5, 3)).toBe("delivered");
    expect(deriveDeliveryStatus(3, 5, 3)).toBe("read");
  });
  it("builds previews", () => {
    expect(chatPreview("", true)).toBe("📷 صورة");
    expect(chatPreview("مرحبا\n\n بيك", false)).toBe("مرحبا بيك");
    expect(chatPreview("x".repeat(300), false).length).toBe(101);
  });
});

describe("manager-editable config", () => {
  const cfg = (patch: object) => mergeChatConfig(patch);
  it("custom hours change the open/closed answer", () => {
    const c = cfg({ openMinute: 10 * 60, closeMinute: 14 * 60 });
    expect(isWithinBusinessHours(cairo("2026-10-04T09:30:00"), c)).toBe(false);
    expect(isWithinBusinessHours(cairo("2026-10-04T13:59:00"), c)).toBe(true);
    expect(isWithinBusinessHours(cairo("2026-10-04T14:00:00"), c)).toBe(false);
  });
  it("a holiday is closed even on a working weekday", () => {
    const c = cfg({ holidays: ["2026-10-04"] });
    expect(isWithinBusinessHours(cairo("2026-10-04T11:00:00"), c)).toBe(false);
    expect(isWithinBusinessHours(cairo("2026-10-05T11:00:00"), c)).toBe(true);
  });
  it("holidays do not count as business minutes", () => {
    const c = cfg({ holidays: ["2026-10-04"] });
    // الأحد إجازة → من الأحد 16:00 إلى الاثنين 09:30 = 30 دقيقة فقط
    expect(businessMinutesBetween(cairo("2026-10-04T16:00:00"), cairo("2026-10-05T09:30:00"), c)).toBe(30);
  });
  it("escalation threshold comes from config", () => {
    const base = { awaitingStaffSince: cairo("2026-10-04T10:00:00"), escalatedAt: null, now: cairo("2026-10-04T10:20:00") };
    expect(isEscalationDue({ ...base, config: cfg({ escalationMinutes: 30 }) })).toBe(false);
    expect(isEscalationDue({ ...base, config: cfg({ escalationMinutes: 20 }) })).toBe(true);
  });
  it("auto-reply can be switched off", () => {
    const night = cairo("2026-10-04T22:00:00");
    expect(shouldSendAutoReply({ now: night, lastAutoReplyAt: null, config: cfg({ autoReplyEnabled: false }) })).toBe(false);
    expect(shouldSendAutoReply({ now: night, lastAutoReplyAt: null, config: DEFAULT_CHAT_CONFIG })).toBe(true);
  });
  it("validates bad configs", () => {
    expect(validateChatConfig(cfg({ openDays: [] }))).toBeTruthy();
    expect(validateChatConfig(cfg({ openMinute: 600, closeMinute: 500 }))).toBeTruthy();
    expect(validateChatConfig(cfg({ holidays: ["4/10/2026"] }))).toBeTruthy();
    expect(validateChatConfig(cfg({ whatsappNumber: "+201001234567" }))).toBeTruthy();
    expect(validateChatConfig(cfg({ whatsappNumber: "201001234567" }))).toBeNull();
    expect(validateChatConfig(DEFAULT_CHAT_CONFIG)).toBeNull();
  });
});
