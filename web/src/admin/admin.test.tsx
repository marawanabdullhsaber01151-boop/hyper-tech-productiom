import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { ToastProvider } from "../design/components";
import { TypeToConfirm } from "./parts";
import { SettingField } from "./SettingField";
import { sentence } from "./screens/CompanyTabs";
import { axe } from "../test/axe";

beforeEach(() => vi.clearAllMocks());

describe("TypeToConfirm", () => {
  it("زر التأكيد مقفول لحد ما الاسم يتكتب صح", async () => {
    const onConfirm = vi.fn();
    render(<ToastProvider><TypeToConfirm open onClose={() => {}} onConfirm={onConfirm} title="عنوان" description="وصف" phrase="شركة ألف" confirmLabel="أوقف" /></ToastProvider>);
    const btn = screen.getByRole("button", { name: "أوقف" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "شركة ألف" } });
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe("SettingField (بيتولّد من شكل الإعداد)", () => {
  it("رقم: بيحفظ القيمة الجديدة بس لما تتغيّر", () => {
    const onSave = vi.fn();
    render(<SettingField label="أقصى عدد" description="" shape={{ kind: "number", min: 1 }} value={10} inherited onSave={onSave} />);
    expect(screen.queryByRole("button", { name: "احفظ" })).toBeNull();
    fireEvent.input(screen.getByRole("spinbutton"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "احفظ" }));
    expect(onSave).toHaveBeenCalledWith(12);
  });
  it("اختيار: بيعرض النصوص العربي مش القيم", () => {
    render(<SettingField label="الانضمام" description="" shape={{ kind: "choice", options: ["approval", "auto", "disabled"] }} value="approval" onSave={() => {}} />);
    expect(screen.getByRole("option", { name: "بموافقة الرئيس" })).toBeTruthy();
  });
  it("JSON غلط ما بيتبعتش", () => {
    const onSave = vi.fn();
    render(<SettingField label="نصوص" description="" shape={{ kind: "json" }} value={{ a: "b" }} onSave={onSave} />);
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "{bad" } });
    fireEvent.click(screen.getByRole("button", { name: "احفظ" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("الصيغة مش مظبوطة.")).toBeTruthy();
  });
  it("إتاحة: من غير مخالفات", async () => {
    const { container } = render(<SettingField label="أقصى عدد" description="وصف" shape={{ kind: "number" }} value={5} inherited={false} onSave={() => {}} onReset={() => {}} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe("سجل النشاط بجمل بسيطة", () => {
  it("حدث معروف وحدث مش معروف", () => {
    expect(sentence({ action: "member.suspended", actorName: "أحمد", targetName: "منى" })).toBe("أحمد أوقف منى");
    expect(sentence({ action: "x.y", actorName: "أحمد", targetName: null })).toContain("x.y");
  });
});

describe("SettingField — قائمة نصوص (قوالب الرفض)", () => {
  it("سطر لكل عنصر، وبيتحفظ كمصفوفة من غير الأسطر الفاضية", () => {
    const onSave = vi.fn();
    render(<SettingField label="أسباب الرفض" description="" shape={{ kind: "list" }} value={["أ", "ب"]} onSave={onSave} />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.value).toBe("أ\nب");
    fireEvent.input(box, { target: { value: "أ\n\nج\n" } });
    fireEvent.click(screen.getByRole("button", { name: "احفظ" }));
    expect(onSave).toHaveBeenCalledWith(["أ", "ج"]);
  });
});

describe("معالج الموافقة على طلب انضمام", () => {
  const app = { id: 1, referenceCode: "ABC12345", fullName: "منى", companyName: "شركة النور", phone: "01012345678", email: null, address: "", city: null, commercialRegisterNo: null, taxId: null, expectedMonthlyVolume: null, notes: null, stage: "new", reviewerNote: null, internalNotes: null, completeness: 45, missing: [], assignedReviewerId: null, assignedReviewerName: null, decision: null, approvedCompanyId: null, sla: "ok", ageHours: 2, createdAt: new Date().toISOString() } as never;
  const matches = { companies: [], contacts: [], applications: [], userPhoneTaken: false, userEmailTaken: false } as never;
  it("«الخطوة الجاية» مقفول لو اخترت ضم موظف من غير ما تحدد الشركة", async () => {
    const { ApprovalWizard } = await import("./screens/ApprovalWizard");
    render(<ToastProvider><ApprovalWizard app={app} matches={matches} seed={null} onClose={() => {}} onDone={() => {}} /></ToastProvider>);
    const next = screen.getByRole("button", { name: "الخطوة الجاية" }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: /موظف في شركة موجودة/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "الخطوة الجاية" }) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "7" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "الخطوة الجاية" }) as HTMLButtonElement).disabled).toBe(false));
  });
});
