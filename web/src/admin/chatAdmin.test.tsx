import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import type { ComponentChildren } from "preact";
import { ToastProvider } from "../design/components";
import { ChatReports, formatMinutes } from "./screens/chat/ChatReports";
import { ChatAccess } from "./screens/chat/ChatAccess";
import { ChatQuick } from "./screens/chat/ChatQuick";
import { ChatSettings, validateSettings, type ChatSettingsData } from "./screens/chat/ChatSettings";
import { b64ToU8 } from "./screens/chat/ChatPush";
import { ChatConsolePage } from "./screens/ChatConsole";

const get = vi.fn();
const post = vi.fn(async (_p: string, _b?: unknown) => ({}));
const put = vi.fn(async (_p: string, b?: unknown) => b);
const patch = vi.fn(async (_p: string, _b?: unknown) => ({}));
vi.mock("./api", () => ({
  api: {
    get: (p: string, o?: unknown) => get(p, o),
    post: (p: string, b?: unknown) => post(p, b),
    put: (p: string, b?: unknown) => put(p, b),
    patch: (p: string, b?: unknown) => patch(p, b),
  },
  downloadCsv: vi.fn(),
}));
vi.mock("./session", async (orig) => ({ ...(await orig<typeof import("./session")>()), staffUser: () => ({ id: 1, username: "boss", fullName: "الرئيس", role: "chairman" }) }));

const ui = (node: ComponentChildren) => render(<ToastProvider>{node}</ToastProvider>);
beforeEach(() => {
  get.mockReset();
  post.mockClear();
  put.mockClear();
  patch.mockClear();
});
afterEach(() => cleanup());

describe("أدوات الشات", () => {
  it("formatMinutes: دقايق وساعات وفاضي", () => {
    expect(formatMinutes(null)).toBe("—");
    expect(formatMinutes("abc")).toBe("—");
    expect(formatMinutes("4.26")).toBe("4.3 د");
    expect(formatMinutes(30)).toBe("30 د");
    expect(formatMinutes("90")).toBe("1.5 س");
  });
  it("validateSettings بنفس قواعد السيرفر", () => {
    const ok: ChatSettingsData = { openDays: [0, 1], openMinute: 540, closeMinute: 1020, escalationMinutes: 30, autoReplyEnabled: true, autoReplyText: "x", holidays: [], whatsappNumber: null };
    expect(validateSettings(ok, "")).toEqual({});
    expect(validateSettings({ ...ok, openDays: [] }, "").days).toBeTruthy();
    expect(validateSettings({ ...ok, closeMinute: 540 }, "").hours).toBeTruthy();
    expect(validateSettings({ ...ok, escalationMinutes: 0 }, "").esc).toBeTruthy();
    expect(validateSettings({ ...ok, escalationMinutes: 1441 }, "").esc).toBeTruthy();
    expect(validateSettings(ok, "123").wa).toBeTruthy();
    expect(validateSettings(ok, "201001234567").wa).toBeUndefined();
  });
  it("b64ToU8 بيفك مفتاح VAPID (base64url)", () => {
    expect(Array.from(b64ToU8("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(b64ToU8("-_8"))).toEqual([251, 255]);
  });
});

describe("تقارير الشات", () => {
  it("بيعرض الأرقام والموظفين", async () => {
    get.mockResolvedValue({
      days: 30,
      totals: { open_conversations: 4, closed_conversations: 9, escalations: 2, customer_messages: 50, staff_messages: 41, avg_stars: "4.50", ratings_count: 6 },
      ratingDistribution: [{ stars: 5, n: 3 }, { stars: "4", n: 3 }],
      responseTime: { overall: { avg_minutes: "12.0", median_minutes: "5.5" }, perAgent: [{ name: "منى", answered: 7, avg_minutes: "12.0", median_minutes: "5.5" }] },
    });
    ui(<ChatReports />);
    expect(await screen.findByText("منى")).toBeTruthy();
    expect(screen.getByText("4.5")).toBeTruthy();
    expect(get).toHaveBeenCalledWith("/chat/reports", expect.objectContaining({ query: { days: 30 } }));
    fireEvent.change(screen.getByRole("combobox", { name: "الفترة" }), { target: { value: "7" } });
    await waitFor(() => expect(get).toHaveBeenCalledWith("/chat/reports", expect.objectContaining({ query: { days: 7 } })));
  });
});

describe("من يرد؟", () => {
  const users = [
    { id: 1, name: "الرئيس", role: "chairman", defaultMode: "manager", override: null, effectiveMode: "manager" },
    { id: 2, name: "منى", role: "online_seller", defaultMode: "agent", override: null, effectiveMode: "agent" },
  ];
  it("صلاحيتك إنت مقفولة، وتغيير موظف تاني بيتبعت للسيرفر", async () => {
    get.mockResolvedValue({ modes: ["manager", "agent", "observer", "none"], users });
    ui(<ChatAccess />);
    const mine = (await screen.findByLabelText("الصلاحية في الشات: الرئيس")) as HTMLSelectElement;
    expect(mine.disabled).toBe(true);
    const other = screen.getByLabelText("الصلاحية في الشات: منى") as HTMLSelectElement;
    fireEvent.change(other, { target: { value: "observer" } });
    await waitFor(() => expect(put).toHaveBeenCalledWith("/chat/staff-access/2", { mode: "observer" }));
  });
  it("«افتراضي» بيبعت null", async () => {
    get.mockResolvedValue({ modes: ["manager", "agent", "observer", "none"], users: [{ ...users[1], override: "observer" }] });
    ui(<ChatAccess />);
    const sel = (await screen.findByLabelText("الصلاحية في الشات: منى")) as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "" } });
    await waitFor(() => expect(put).toHaveBeenCalledWith("/chat/staff-access/2", { mode: null }));
  });
});

describe("الردود الجاهزة", () => {
  it("الإضافة مقفولة لحد ما البيانات تصح، وبتتبعت مقصوصة", async () => {
    get.mockResolvedValue([]);
    ui(<ChatQuick />);
    const add = (await screen.findByRole("button", { name: "ضيف الرد" })) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.input(screen.getByLabelText("العنوان"), { target: { value: " ساعات العمل " } });
    fireEvent.input(screen.getByLabelText("نص الرد"), { target: { value: "من 9 لـ 5" } });
    await waitFor(() => expect(add.disabled).toBe(false));
    fireEvent.click(add);
    await waitFor(() => expect(post).toHaveBeenCalledWith("/chat/quick-replies", { title: "ساعات العمل", body: "من 9 لـ 5" }));
  });
  it("المسح بيعمل تعطيل (isActive:false) بعد التأكيد", async () => {
    get.mockResolvedValue([{ id: 5, title: "شكر", body: "شكرًا لتواصلك" }]);
    ui(<ChatQuick />);
    fireEvent.click(await screen.findByRole("button", { name: "امسح" }));
    const confirm = (await screen.findAllByRole("button", { name: "امسح" })).pop()!;
    fireEvent.click(confirm);
    await waitFor(() => expect(patch).toHaveBeenCalledWith("/chat/quick-replies/5", { isActive: false }));
  });
});

describe("إعدادات الشات", () => {
  const base: ChatSettingsData = { openDays: [0, 1, 2], openMinute: 540, closeMinute: 1020, escalationMinutes: 30, autoReplyEnabled: true, autoReplyText: "هنرد عليك", holidays: ["2026-10-06"], whatsappNumber: null };
  it("من غير أيام شغل ما بيحفظش ويوضّح السبب", async () => {
    get.mockResolvedValue({ ...base, openDays: [] });
    ui(<ChatSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "احفظ الإعدادات" }));
    expect(await screen.findByText("اختار يوم شغل واحد على الأقل")).toBeTruthy();
    expect(put).not.toHaveBeenCalled();
  });
  it("بيحفظ بعد تنضيف رقم واتساب وبيشيل الإجازة", async () => {
    get.mockResolvedValue(base);
    ui(<ChatSettings />);
    const wa = await screen.findByLabelText("رقم واتساب");
    fireEvent.input(wa, { target: { value: "+٢٠ ١٠٠ ١٢٣ ٤٥٦٧" } });
    fireEvent.click(screen.getByRole("button", { name: "شيل إجازة 2026-10-06" }));
    fireEvent.click(screen.getByRole("button", { name: "احفظ الإعدادات" }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const [path, body] = put.mock.calls[0] as [string, ChatSettingsData];
    expect(path).toBe("/chat/settings");
    expect(body.whatsappNumber).toBe("201001234567");
    expect(body.holidays).toEqual([]);
  });
});

describe("صفحة شات الإدارة: الأقسام حسب الصلاحية", () => {
  const route = (mode: string) =>
    get.mockImplementation(async (p: string) => {
      if (p === "/chat/summary") return { mode, unreadConversations: 3 };
      if (p === "/chat/inbox") return { items: [], hasMore: false, page: 1 };
      if (p === "/chat/push-key") return { publicKey: null };
      return [];
    });
  it("المدير: كل الأقسام + عدّاد غير المقروء", async () => {
    route("manager");
    ui(<ChatConsolePage />);
    for (const name of ["التقارير", "مين يرد؟", "ردود جاهزة", "الإعدادات"]) expect(await screen.findByRole("tab", { name })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /المحادثات/ }).textContent).toContain("3");
  });
  it("المراقب: المحادثات والتقارير بس", async () => {
    route("observer");
    ui(<ChatConsolePage />);
    expect(await screen.findByRole("tab", { name: "التقارير" })).toBeTruthy();
    await screen.findByText(/وضعك/);
    expect(screen.queryByRole("tab", { name: "مين يرد؟" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "الإعدادات" })).toBeNull();
  });
  it("اللي بيرد: صندوق المحادثات بس", async () => {
    route("agent");
    ui(<ChatConsolePage />);
    await screen.findByText(/وضعك/);
    expect(screen.getByRole("tab", { name: /المحادثات/ })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "التقارير" })).toBeNull();
  });
});
