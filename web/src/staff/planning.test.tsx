import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Planning } from "./Planning";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const demand = {
  inventoryItemId: 7, code: "RM-1", name: "رصاص", unit: "kg", grossQty: "200.000", requiredBy: "2099-01-10",
  sources: [{ recipeId: 1, productName: "بطارية 12 فولت", lineNo: 0, producedQty: "100", perBatchQty: "20", outputQty: "10", contribution: "200.000" }],
  stock: { onHand: "50", reserved: "10", quarantine: "0" }, openSupply: { purchaseOrders: "30", requisitions: "0", total: "30" },
  result: { freeAvailableQty: "40", netQty: "130", status: "shortage", shortageCode: "insufficient", explanation: "المطلوب أكبر من المتاح" },
};
let preview: unknown;
let calls: Array<{ key: string; body: unknown }> = [];

function stub() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).split("?")[0]!.replace("/api/v1", "")}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (key === "GET /planning/lookups") return json({ data: { recipes: [{ id: 1, productName: "بطارية 12 فولت", productCode: "FG-1", outputQty: "10.000" }] } });
    if (key === "POST /planning/explode") return json({ data: preview });
    if (key === "POST /planning/runs") return json({ data: { id: 5, scenarioCode: "baseline", status: "draft", horizonStart: "2099-01-01", horizonEnd: "2099-01-10", createdAt: "x", summary: { demandCount: 1, shortageCount: 1, overloadedCount: 0 }, inputs: [], shortageMessages: [], capacityLoads: [], requisitions: [] } }, 201);
    if (key === "GET /planning/runs") return json({ data: [] });
    if (key === "GET /planning/runs/5") return json({ data: { id: 5, scenarioCode: "baseline", status: "draft", horizonStart: "2099-01-01", horizonEnd: "2099-01-10", createdAt: "x", summary: { demandCount: 1, shortageCount: 1, overloadedCount: 0 }, inputs: [], shortageMessages: [], capacityLoads: [], requisitions: [] } });
    return json({});
  }));
}
function login(role: string) {
  sessionStorage.clear();
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "مستخدم", role } }));
}
const mount = () => render(<ToastProvider><Planning /></ToastProvider>);
beforeEach(() => { preview = { demands: [demand], blockers: [], summary: { demandCount: 1, shortageCount: 1, blockerCount: 0 } }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function fillAndCalc() {
  const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
  await waitFor(() => expect(select.options.length).toBeGreaterThan(1));
  fireEvent.change(select, { target: { value: "1" } });
  fireEvent.input(screen.getByLabelText(/الكمية/), { target: { value: "100" } });
  fireEvent.click(screen.getByRole("button", { name: "احسب الاحتياجات" }));
}

describe("صفحة التخطيط", () => {
  it("دور بلا صلاحية يشوف رسالة منع", () => {
    login("sales_manager");
    stub();
    mount();
    expect(screen.getByText("الصفحة دي مش متاحة لدورك.")).toBeTruthy();
  });

  it("الحساب يعرض الخامة والعجز و«ليه؟» بيشرح المعادلة", async () => {
    login("production_controller");
    stub();
    mount();
    await fillAndCalc();
    expect(await screen.findByText("رصاص")).toBeTruthy();
    expect(screen.getAllByText("عجز").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "ليه؟" }));
    expect(await screen.findByText(/بطارية 12 فولت: 100 × 20 ÷ 10 = 200/)).toBeTruthy();
    expect(calls.find((c) => c.key === "POST /planning/explode")?.body).toEqual({ lines: [{ bomRecipeId: 1, qty: "100", requiredBy: expect.any(String) }] });
  });

  it("وجود وصفة غير جاهزة يمنع الحفظ ويعرض الرابط", async () => {
    login("production_controller");
    preview = { demands: [demand], blockers: [{ code: "item_unlinked", recipeId: 1, productName: "بطارية 12 فولت", materialName: "غلاف", message: "المكوّن غلاف مش مربوط بالمخزون" }], summary: { demandCount: 1, shortageCount: 1, blockerCount: 1 } };
    stub();
    mount();
    await fillAndCalc();
    expect(await screen.findByText("المكوّن غلاف مش مربوط بالمخزون")).toBeTruthy();
    expect((screen.getByRole("button", { name: "احفظ السيناريو" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("link", { name: "افتح الوصفات" })).toBeTruthy();
  });

  it("الحفظ بيبعت التوريد المفتوح من المعاينة", async () => {
    login("production_controller");
    stub();
    mount();
    await fillAndCalc();
    await screen.findByText("رصاص");
    fireEvent.click(screen.getByRole("button", { name: "احفظ السيناريو" }));
    await waitFor(() => expect(calls.some((c) => c.key === "POST /planning/runs")).toBe(true));
    const body = calls.find((c) => c.key === "POST /planning/runs")!.body as { demands: Array<{ openSupplyQty: string; inventoryItemId: number }> };
    expect(body.demands[0]).toMatchObject({ inventoryItemId: 7, openSupplyQty: "30" });
  });
});
