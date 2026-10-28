import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Production } from "./Production";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ORDERS = [{ id: 5, orderNumber: "PO-5", productName: "بطارية 12 فولت", qty: "10", unit: "قطعة", priority: "normal", workflowStatus: "materials_requested", neededBy: "2099-01-01", createdById: 9, lifecycleRevision: 1 }];
const SHORT = { materials: [
  { inventoryItemId: 1, materialName: "نحاس", requestedQty: "10.000", availableQty: "20.000", unit: "كجم", sufficient: true },
  { inventoryItemId: 2, materialName: "بلاستيك", requestedQty: "5.000", availableQty: "3.000", unit: "كجم", sufficient: false },
], allSufficient: false };
const ENOUGH = { materials: [{ inventoryItemId: 1, materialName: "نحاس", requestedQty: "10.000", availableQty: "20.000", unit: "كجم", sufficient: true }], allSufficient: true };
let calls: Array<{ key: string; body: unknown }> = [];
function stub(check: unknown = SHORT) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).split("?")[0]!.replace("/api/v1", "")}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (key === "GET /production-workflow") return json({ data: ORDERS, stats: {} });
    if (key === "GET /production-workflow/5/materials-check") return json(check);
    if (key.endsWith("/lifecycle")) return json({ viewKind: "canonical_workflow_order", data: { blockedGates: [], conformance: { ok: true }, children: [], timeline: [] } });
    return json({ data: {} });
  }));
}
function login(role: string) {
  sessionStorage.clear();
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "مستخدم", role } }));
}
const mount = () => render(<ToastProvider><Production /></ToastProvider>);
beforeEach(() => { history.replaceState(null, "", "/v2/staff/production?tab=orders"); localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openDecision() {
  fireEvent.click(await screen.findByRole("button", { name: "قرار الخامات" }));
  return screen.findByRole("dialog");
}
const sendBtn = (dlg: HTMLElement) => within(dlg).getByRole("button", { name: "تنفيذ القرار" }) as HTMLButtonElement;

describe("قرار خامات أمر الإنتاج", () => {
  it("مدير المخازن: النقص ظاهر، والاعتماد الكامل مقفول، والجزئي هو الافتراضي بكميات مقترحة", async () => {
    login("warehouse_manager");
    stub();
    mount();
    const dlg = await openDecision();
    expect(await within(dlg).findByText(/1 من 2 مواد ناقصة/)).toBeTruthy();
    expect(within(dlg).getByText(/ناقص 2 كجم/)).toBeTruthy();
    expect((within(dlg).getByRole("radio", { name: "اعتماد كامل" }) as HTMLInputElement).disabled).toBe(true);
    expect((within(dlg).getByRole("radio", { name: "اعتماد جزئي" }) as HTMLInputElement).checked).toBe(true);
    expect((within(dlg).getByLabelText("الكمية المعتمدة من نحاس") as HTMLInputElement).value).toBe("10.000");
    expect((within(dlg).getByLabelText("الكمية المعتمدة من بلاستيك") as HTMLInputElement).value).toBe("3.000");
    expect(within(dlg).getByText(/دون خصم مباشر من المخزن/)).toBeTruthy();
    fireEvent.click(sendBtn(dlg));
    await waitFor(() => expect(calls.find((c) => c.key === "PATCH /production-workflow/5/warehouse-action")?.body).toMatchObject({
      action: "partial",
      materialDecisions: [
        { materialName: "نحاس", inventoryItemId: 1, approvedQty: "10.000", unit: "كجم" },
        { materialName: "بلاستيك", inventoryItemId: 2, approvedQty: "3.000", unit: "كجم" },
      ],
    }));
  });

  it("كمية أكبر من المتاح بتقفل الإرسال وبتظهر السبب", async () => {
    login("warehouse_manager");
    stub();
    mount();
    const dlg = await openDecision();
    fireEvent.input(await within(dlg).findByLabelText("الكمية المعتمدة من بلاستيك"), { target: { value: "4" } });
    expect(within(dlg).getByText(/أكبر من المتاح بالمخزن/)).toBeTruthy();
    expect(sendBtn(dlg).disabled).toBe(true);
    fireEvent.input(within(dlg).getByLabelText("الكمية المعتمدة من بلاستيك"), { target: { value: "0" } });
    fireEvent.input(within(dlg).getByLabelText("الكمية المعتمدة من نحاس"), { target: { value: "0" } });
    expect(within(dlg).getByText(/اعتمد كمية واحدة على الأقل/)).toBeTruthy();
    expect(sendBtn(dlg).disabled).toBe(true);
  });

  it("كل شيء متوفر: الاعتماد الكامل افتراضي، ويتبعت من غير كميات، والرئيس يشوف إن الخصم فوري", async () => {
    login("chairman");
    stub(ENOUGH);
    mount();
    const dlg = await openDecision();
    expect(await within(dlg).findByText("كل المواد متوفرة بالكامل.")).toBeTruthy();
    expect((within(dlg).getByRole("radio", { name: "اعتماد كامل" }) as HTMLInputElement).checked).toBe(true);
    expect(within(dlg).getByText(/ستُخصم الخامات المعتمدة من المخزن فورًا/)).toBeTruthy();
    fireEvent.click(sendBtn(dlg));
    await waitFor(() => expect(calls.find((c) => c.key === "PATCH /production-workflow/5/warehouse-action")?.body).toEqual({ action: "approve" }));
  });

  it("الرفض بيحتاج سببًا، وبيتبعت بالسبب", async () => {
    login("storekeeper");
    stub();
    mount();
    const dlg = await openDecision();
    fireEvent.click(await within(dlg).findByRole("radio", { name: "رفض" }));
    expect(sendBtn(dlg).disabled).toBe(true);
    fireEvent.input(within(dlg).getByLabelText(/سبب الرفض/), { target: { value: "الخامة تالفة" } });
    expect(sendBtn(dlg).disabled).toBe(false);
    fireEvent.click(sendBtn(dlg));
    await waitFor(() => expect(calls.find((c) => c.key === "PATCH /production-workflow/5/warehouse-action")?.body).toEqual({ action: "reject", comment: "الخامة تالفة" }));
  });

  it("مدير الإنتاج مفيش له زر قرار الخامات", async () => {
    login("production_manager");
    stub();
    mount();
    expect(await screen.findAllByText("PO-5")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "قرار الخامات" })).toBeNull();
  });
});
