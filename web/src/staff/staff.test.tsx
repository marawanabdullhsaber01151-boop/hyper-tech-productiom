import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "../test/axe";
import { ToastProvider } from "../design/components";
import { Login, formatCountdown } from "./Login";
import { Sidebar } from "./Sidebar";
import { StaffShell } from "./StaffShell";
import { activeDeptId, currentTitle, iconFor, isActiveHref, resolveHref, safeNext, type NavResponse } from "./nav";
import { Circle, Factory, Landmark } from "../design/icons";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const NAV: NavResponse = {
  role: "chairman",
  user: { name: "منى أحمد", role: "chairman", roleLabel: "رئيس مجلس الإدارة" },
  singleDepartment: false,
  homeHref: null,
  departments: [
    {
      id: "top",
      label: "الإدارة العليا",
      icon: "landmark",
      subFunctions: [
        {
          id: "gov",
          label: "الحوكمة",
          pages: [
            { id: "customers", label: "عملاء البوابة", href: "/v2/admin/portal-customers" },
            { id: "sales", label: "المبيعات", href: "sales.html", badgeCount: 3 },
          ],
        },
      ],
    },
    { id: "weird", label: "قسم غريب", icon: "fa-does-not-exist", subFunctions: [{ id: "s", label: "محور", pages: [{ id: "x", label: "صفحة", href: "x.html" }] }] },
  ],
};

beforeEach(() => {
  sessionStorage.clear();
  history.replaceState(null, "", "/v2/login");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("nav (تحويل أيقونات وروابط)", () => {
  it("أيقونات FontAwesome ← Lucide، وغير المعروف ← دايرة", () => {
    expect(iconFor("landmark")).toBe(Landmark);
    expect(iconFor("fa-industry")).toBe(Factory);
    expect(iconFor("fa-solid fa-industry")).toBe(Factory);
    expect(iconFor("nope")).toBe(Circle);
    expect(iconFor(undefined)).toBe(Circle);
  });
  it("/v2/... تنقل داخلي، و.html القديم تحميل كامل", () => {
    expect(resolveHref("/v2/admin/portal-orders")).toEqual({ kind: "spa", to: "/admin/portal-orders" });
    expect(resolveHref("sales.html")).toEqual({ kind: "legacy", href: "/sales.html" });
    expect(resolveHref("/sales.html")).toEqual({ kind: "legacy", href: "/sales.html" });
  });
  it("النشط بالمسار (وبالمسارات الفرعية)", () => {
    expect(isActiveHref("/admin/portal-customers", "/v2/admin/portal-customers")).toBe(true);
    expect(isActiveHref("/admin/portal-customers/12", "/v2/admin/portal-customers")).toBe(true);
    expect(isActiveHref("/admin/portal-customersX", "/v2/admin/portal-customers")).toBe(false);
    expect(isActiveHref("/admin/portal-customers", "sales.html")).toBe(false);
  });
  it("عنوان الهيدر والقسم النشط", () => {
    expect(currentTitle(NAV, "/admin/portal-customers/5")).toBe("عملاء البوابة");
    expect(activeDeptId(NAV, "/admin/portal-customers")).toBe("top");
    expect(currentTitle(NAV, "/nowhere")).toBeNull();
  });
  it("next آمن: بيرفض الروابط الخارجية", () => {
    expect(safeNext("/sales.html")).toBe("/sales.html");
    expect(safeNext("/v2/admin/portal-orders?x=1")).toBe("/v2/admin/portal-orders?x=1");
    for (const bad of ["https://evil.test", "//evil.test", "javascript:alert(1)", "\\evil", "", null, undefined]) expect(safeNext(bad as never)).toBeNull();
  });
});

describe("Sidebar", () => {
  it("بيعرض صفحات القسم النشط، والصفحة الحالية aria-current، والقديمة رابط عادي", () => {
    render(<Sidebar nav={NAV} path="/admin/portal-customers" collapsed={false} openDept={null} onToggleDept={() => {}} />);
    expect(screen.getByRole("button", { name: "الإدارة العليا" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "عملاء البوابة" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /المبيعات/ }).getAttribute("href")).toBe("/sales.html");
    expect(screen.getByText("3")).toBeTruthy();
  });
  it("المطوي: أيقونات بس (بأسماء للقارئ)، من غير روابط", () => {
    render(<Sidebar nav={NAV} path="/admin/portal-customers" collapsed openDept={null} onToggleDept={() => {}} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "الإدارة العليا" })).toBeTruthy();
  });
  it("أيقونة غير معروفة ما بتكسرش الرسم، والضغط على القسم بينادي الـhandler", () => {
    const onToggle = vi.fn();
    render(<Sidebar nav={NAV} path="/" collapsed={false} openDept={null} onToggleDept={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "قسم غريب" }));
    expect(onToggle).toHaveBeenCalledWith("weird");
  });
});

describe("Login", () => {
  const fill = (u: string, p: string) => {
    fireEvent.input(screen.getByLabelText("اسم المستخدم"), { target: { value: u } });
    fireEvent.input(screen.getByLabelText("كلمة السر"), { target: { value: p } });
  };
  const submit = () => fireEvent.click(screen.getByRole("button", { name: "دخول" }));

  it("العرض الأساسي من غير مخالفات a11y", async () => {
    const { container } = render(<main><Login /></main>);
    expect((await axe(container)).violations).toEqual([]);
  });

  it("بيانات غلط: رسالة بسيطة وبتفضل في الصفحة", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "UNAUTHORIZED", message: "x" } }, 401)));
    render(<Login />);
    fill("ali", "bad");
    submit();
    expect(await screen.findByText("اسم المستخدم أو كلمة السر غير صحيحة")).toBeTruthy();
    expect(sessionStorage.getItem("hyper_erp_session")).toBeNull();
  });

  it("دخول ناجح: بيحفظ الجلسة بنفس شكل الصفحات القديمة وبينقل للرئيسية", async () => {
    const reply = { token: "tok", user: { id: 1, username: "ali", fullName: "علي", role: "chairman" }, isNewDevice: false };
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: reply })));
    render(<Login />);
    fill("ali", "good");
    submit();
    await waitFor(() => expect(location.pathname).toBe("/v2/staff"));
    expect(JSON.parse(sessionStorage.getItem("hyper_erp_session")!)).toEqual(reply);
  });

  it("TOTP: خانة الكود بتظهر، كود غلط يفضل في الخطوة، وكود صح يدخّل", async () => {
    const reply = { token: "tok2", user: { id: 2, username: "mo", fullName: "مي", role: "hr" } };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: { requiresTotp: true, preAuthToken: "pre" } }))
      .mockResolvedValueOnce(json({ error: { code: "UNAUTHORIZED", message: "رمز التحقق غير صحيح" } }, 401))
      .mockResolvedValueOnce(json({ data: reply }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Login />);
    fill("mo", "pw");
    submit();
    const codeInput = await screen.findByLabelText("الرمز");
    fireEvent.input(codeInput, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد" }));
    expect(await screen.findByText("رمز التحقق غير صحيح")).toBeTruthy();
    expect(sessionStorage.getItem("hyper_erp_session")).toBeNull();
    fireEvent.input(screen.getByLabelText("الرمز"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد" }));
    await waitFor(() => expect(location.pathname).toBe("/v2/staff"));
    const body = JSON.parse((fetchMock.mock.calls[2]![1] as RequestInit).body as string);
    expect(body).toEqual({ preAuthToken: "pre", code: "123456" });
  });

  it("قفل مؤقت: عدّاد mm:ss والزر مقفول", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "ACCOUNT_LOCKED", message: "x", details: { retryAfterSeconds: 150 } } }, 423)));
    render(<Login />);
    fill("ali", "bad");
    submit();
    expect(await screen.findByText("الحساب مقفول مؤقتًا. جرّب بعد 02:30")).toBeTruthy();
    expect((screen.getByRole("button", { name: "دخول" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("انقطاع الشبكة: رسالة مفهومة", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    render(<Login />);
    fill("ali", "pw");
    submit();
    expect(await screen.findByText("مفيش اتصال بالإنترنت. جرّب تاني.")).toBeTruthy();
  });

  it("الحقول الفاضية: ما بيبعتش طلب", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    render(<Login />);
    submit();
    expect(f).not.toHaveBeenCalled();
    expect(screen.getByText("اكتب اسم المستخدم وكلمة السر")).toBeTruthy();
  });

  it("formatCountdown: mm:ss بأرقام لاتينية", () => {
    expect(formatCountdown(150)).toBe("02:30");
    expect(formatCountdown(59.2)).toBe("01:00");
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(-5)).toBe("00:00");
  });
});

describe("StaffShell", () => {
  it("بيبني السايدبار من /nav، والهيدر بالاسم والدور، والمحتوى جوّاه", async () => {
    sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "ali", fullName: "علي", role: "chairman" } }));
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: NAV })));
    render(<ToastProvider><StaffShell path="/admin/portal-customers"><p>محتوى الصفحة</p></StaffShell></ToastProvider>);
    expect(await screen.findByRole("button", { name: "الإدارة العليا" })).toBeTruthy();
    expect(screen.getByText("منى أحمد")).toBeTruthy();
    expect(screen.getByText("رئيس مجلس الإدارة")).toBeTruthy();
    expect(screen.getByText("محتوى الصفحة")).toBeTruthy();
  });
  it("فشل تحميل /nav: رسالة وزر إعادة المحاولة", async () => {
    sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "ali", fullName: "علي", role: "chairman" } }));
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "X", message: "x" } }, 403)));
    render(<ToastProvider><StaffShell path="/staff"><p>x</p></StaffShell></ToastProvider>);
    expect(await screen.findByText("ماقدرناش نحمّل القائمة.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "حاول تاني" })).toBeTruthy();
  });
});
