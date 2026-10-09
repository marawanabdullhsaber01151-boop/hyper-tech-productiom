import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import { axe } from "../../test/axe";
import {
  Button, CodeInput, ConfirmDialog, CopyField, DataTable, Dialog, Field, Input, Menu, PermissionMatrix, PhoneInput, Select, Switch, Tabs,
  ToastProvider, useToast, StepWizard, Pagination, type Column,
} from ".";
import { Ellipsis } from "../icons";

function mockMatchMedia(matches: boolean) {
  window.matchMedia = ((q: string) => ({ matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
}

describe("Field", () => {
  it("بيربط label / hint / error بالحقل", () => {
    render(
      <Field label="الاسم" hint="تلميح" error="مطلوب" required>
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText(/الاسم/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toBeRequired();
    const desc = input.getAttribute("aria-describedby")!;
    expect(desc.split(" ").map((id) => document.getElementById(id)?.textContent)).toContain("مطلوب");
    expect(screen.getByRole("alert")).toHaveTextContent("مطلوب");
  });
});

describe("Dialog", () => {
  function Host() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>افتح</button>
        <Dialog open={open} onClose={() => setOpen(false)} title="عنوان" footer={<Button onClick={() => setOpen(false)}>تمام</Button>}>
          <Input aria-label="حقل" />
        </Dialog>
      </>
    );
  }
  it("بيركّز جواه، بيحبس Tab، Esc بيقفل، وبيرجّع التركيز", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const opener = screen.getByText("افتح");
    await user.click(opener);
    const dlg = screen.getByRole("dialog", { name: "عنوان" });
    expect(dlg).toHaveAttribute("aria-modal", "true");
    expect(dlg.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dlg.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dlg.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.documentElement.style.overflow).toBe("");
  });
});

describe("ConfirmDialog", () => {
  it("التركيز الأول على إلغاء (أمان)", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open onClose={() => {}} onConfirm={onConfirm} title="تمسح؟" danger confirmLabel="امسح" />);
    expect(screen.getByRole("button", { name: "إلغاء" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "امسح" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe("DataTable", () => {
  interface R { id: number; name: string; qty: number }
  const cols: Column<R>[] = [
    { key: "name", header: "الاسم", mobile: "title", sortable: true, cell: (r) => r.name },
    { key: "qty", header: "الكمية", numeric: true, cell: (r) => r.qty },
  ];
  const rows = [{ id: 1, name: "أ", qty: 3 }, { id: 2, name: "ب", qty: 5 }];

  it("جدول على الشاشة العريضة مع aria-sort", async () => {
    mockMatchMedia(false);
    const onSort = vi.fn();
    render(<DataTable caption="الأصناف" columns={cols} rows={rows} rowKey={(r) => r.id} sort={{ key: "name", dir: "asc" }} onSort={onSort} />);
    expect(screen.getByRole("table", { name: "الأصناف" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /الاسم/ })).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(screen.getByRole("button", { name: /الاسم/ }));
    expect(onSort).toHaveBeenCalledWith({ key: "name", dir: "desc" });
  });

  it("كروت على الموبايل", () => {
    mockMatchMedia(true);
    render(<DataTable caption="الأصناف" columns={cols} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.queryByRole("table")).toBeNull();
    const list = screen.getByRole("list", { name: "الأصناف" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getAllByText("الكمية")).toHaveLength(2);
  });

  it("حالة فاضية وتحميل", () => {
    mockMatchMedia(false);
    const { rerender } = render(<DataTable caption="x" columns={cols} rows={[]} rowKey={(r) => r.id} />);
    expect(screen.getByText("مفيش بيانات")).toBeInTheDocument();
    rerender(<DataTable caption="x" columns={cols} rows={[]} rowKey={(r) => r.id} loading />);
    expect(screen.getByLabelText("ثواني...")).toHaveAttribute("aria-busy", "true");
  });
});

describe("PhoneInput", () => {
  it("بيحوّل الأرقام العربية ويرجّع الرقم المظبوط", async () => {
    const seen: Array<[string, string | null]> = [];
    function H() {
      const [v, setV] = useState("");
      return <PhoneInput value={v} onChange={(r, n) => { seen.push([r, n]); setV(r); }} />;
    }
    render(<H />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "٠١٠١٢٣٤٥٦٧٨" } });
    expect(seen.at(-1)).toEqual(["01012345678", "01012345678"]);
    fireEvent.input(input, { target: { value: "٠١٠١٢٣٤٥٦٧٨٩" } });
    expect(seen.at(-1)).toEqual(["010123456789", null]);
    expect(input.value).toBe("010123456789");
  });
});

describe("CopyField", () => {
  it("بينسخ وبيقول اتنسخ", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    render(<CopyField label="كود الشركة" value="HT-7K9M-2QXH" />);
    fireEvent.click(screen.getByRole("button", { name: /انسخ/ }));
    await waitFor(() => expect(write).toHaveBeenCalledWith("HT-7K9M-2QXH"));
    expect(await screen.findByRole("button", { name: /اتنسخ/ })).toBeInTheDocument();
  });
  it("لو النسخ فشل بيعرض رسالة بديلة", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("no")) }, configurable: true });
    (document as any).execCommand = vi.fn().mockReturnValue(false);
    render(<CopyField label="الرابط" value="https://x" />);
    fireEvent.click(screen.getByRole("button", { name: /انسخ/ }));
    expect(await screen.findByText(/ماقدرناش ننسخ/, { selector: ".ht-plate__fail" })).toBeInTheDocument();
  });
});

describe("CodeInput", () => {
  it("بينسّق ويقبل اللصق ويكتشف الغلط", () => {
    const onChange = vi.fn();
    const onComplete = vi.fn();
    render(<CodeInput value="" onChange={onChange} onComplete={onComplete} />);
    const input = screen.getByPlaceholderText("HT-XXXX-XXXX");
    fireEvent.paste(input, { clipboardData: { getData: () => " ht 7k9m 2qxh " } });
    expect(onChange).toHaveBeenLastCalledWith("HT-7K9M-2QXH", "7K9M2QXH");
    expect(onComplete).toHaveBeenCalledWith("7K9M2QXH");
    fireEvent.input(input, { target: { value: "7K9M2QXZ" } });
    expect(onChange).toHaveBeenLastCalledWith("HT-7K9M-2QXZ", null);
  });
});

describe("Tabs", () => {
  it("تنقل بالأسهم في RTL", async () => {
    const onChange = vi.fn();
    render(<Tabs value="a" onChange={onChange} tabs={[{ id: "a", label: "أ", panel: "pa" }, { id: "b", label: "ب", panel: "pb" }]} />);
    const tab = screen.getByRole("tab", { name: "أ" });
    tab.focus();
    // RTL: السهم الشمال = التالي
    fireEvent.keyDown(tab.parentElement!, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("pa");
  });
});

describe("Menu", () => {
  it("بيتفتح وبيتنقل بالأسهم وبينفّذ الإجراء", async () => {
    const user = userEvent.setup();
    const a = vi.fn();
    render(<Menu label="إجراءات" items={[{ label: "عرض", onSelect: a }, { label: "امسح", danger: true, onSelect: () => {} }]} trigger={({ toggle, open }) => <button aria-expanded={open} onClick={toggle}>قائمة</button>} />);
    await user.click(screen.getByText("قائمة"));
    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await user.keyboard("{ArrowUp}{Enter}");
    expect(a).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("Switch / Select / Permission / Wizard / Pager / Toast", () => {
  it("Switch بيبدّل", () => {
    const f = vi.fn();
    render(<Switch label="شغّال" checked={false} onChange={f} />);
    fireEvent.click(screen.getByRole("switch", { name: "شغّال" }));
    expect(f).toHaveBeenCalledWith(true);
  });
  it("Select بيبدأ بالـ placeholder", () => {
    render(<Field label="المحافظة"><Select placeholder="اختار" options={[{ value: "a", label: "القاهرة" }]} /></Field>);
    expect((screen.getByLabelText("المحافظة") as HTMLSelectElement).value).toBe("");
  });
  it("PermissionMatrix بيمنع المقفول ويختار المجموعة", () => {
    const onChange = vi.fn();
    render(<PermissionMatrix groups={[{ id: "g", label: "طلبات", items: [{ key: "a", label: "أ" }, { key: "b", label: "ب", locked: true }] }]} value={new Set()} onChange={onChange} />);
    expect(screen.getByLabelText(/^ب/)).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "الكل" }));
    expect([...onChange.mock.calls[0]![0]]).toEqual(["a"]);
  });
  it("StepWizard بيوقف التالي لو الخطوة مش valid", () => {
    render(<StepWizard current={0} onChange={() => {}} onFinish={() => {}} steps={[{ id: "1", title: "أ", valid: false, content: "c1" }, { id: "2", title: "ب", content: "c2" }]} />);
    expect(screen.getByRole("button", { name: "الخطوة الجاية" })).toBeDisabled();
  });
  it("Pagination", () => {
    const f = vi.fn();
    render(<Pagination page={1} pageSize={10} total={25} onPage={f} />);
    expect(screen.getByRole("button", { name: "السابق" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(f).toHaveBeenCalledWith(2);
    expect(screen.getByText("1–10 من 25")).toBeInTheDocument();
  });
  it("Toast بيظهر والخطأ مش بيختفي لوحده", async () => {
    vi.useFakeTimers();
    function B() {
      const push = useToast();
      return <button onClick={() => { push({ tone: "success", message: "اتحفظ" }); push({ tone: "danger", message: "فشل" }); }}>اضغط</button>;
    }
    render(<ToastProvider><B /></ToastProvider>);
    fireEvent.click(screen.getByText("اضغط"));
    expect(screen.getByText("اتحفظ")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.queryByText("اتحفظ")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("فشل");
    vi.useRealTimers();
  });
});

describe("a11y (axe) على الحالات الأساسية", () => {
  it("نموذج كامل بدون مخالفات", async () => {
    const { container } = render(
      <main>
        <Field label="الاسم" required hint="تلميح"><Input /></Field>
        <Field label="الموبايل" error="غلط"><PhoneInput value="" onChange={() => {}} /></Field>
        <Switch label="خيار" checked onChange={() => {}} />
        <Button icon={Ellipsis}>زر</Button>
      </main>,
    );
    const res = await axe(container);
    expect(res.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});
