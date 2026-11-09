/** @format */
import { describe, expect, it } from "vitest";
import { EXTERNAL_NOTICE_TYPES, isExternalNotice, noticeRecipientIds } from "./portalNoticeCore";

describe("أنواع الإشعارات الخارجية", () => {
  it("أحداث الطلب المهمة بتتبعت برّه البوابة", () => {
    for (const t of ["portal_order_priced", "portal_order_rejected", "workflow_delivered", "workflow_cancelled"]) expect(isExternalNotice(t)).toBe(true);
  });
  it("المحادثة والاستعادة والجودة الداخلية تفضل جوه البوابة", () => {
    for (const t of ["portal_chat_message", "portal_chat_closed", "portal_member_reset_request", "workflow_quality_passed", "workflow_quality_failed", "workflow_delivered_warehouse", "حاجة_مجهولة"]) expect(isExternalNotice(t)).toBe(false);
  });
  it("القايمة بدون تكرار", () => {
    expect(new Set(EXTERNAL_NOTICE_TYPES).size).toBe(EXTERNAL_NOTICE_TYPES.length);
  });
});

describe("المستلمون", () => {
  it("صاحب الحدث أولًا ثم الملّاك، بدون تكرار", () => {
    expect(noticeRecipientIds({ memberUserId: 7, ownerUserIds: [3, 7, 3, 9] })).toEqual([7, 3, 9]);
  });
  it("من غير موظف معيّن: الملّاك بس", () => {
    expect(noticeRecipientIds({ memberUserId: null, ownerUserIds: [4] })).toEqual([4]);
    expect(noticeRecipientIds({ ownerUserIds: [] })).toEqual([]);
  });
  it("بيتجاهل القيم الغلط", () => {
    expect(noticeRecipientIds({ memberUserId: 0, ownerUserIds: [-1, 2.5, 6] })).toEqual([6]);
  });
});
