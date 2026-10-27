import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { ToastProvider } from "../design/components";
import { ChatThread } from "./ChatThread";
import { mergeMessages } from "./useThread";
import type { ChatMsg } from "./types";
import { axe } from "../test/axe";

const msg = (id: number, over: Partial<ChatMsg> = {}): ChatMsg => ({ id, senderType: "customer", senderName: "منى", kind: "text", event: null, body: `رسالة ${id}`, hidden: false, topic: null, context: null, attachment: null, createdAt: new Date().toISOString(), ...over });
const backend = { imagePath: (id: number) => `/x/${id}`, token: () => "t" };

describe("mergeMessages", () => {
  it("بيدمج من غير تكرار وبيرتّب بالرقم", () => {
    const r = mergeMessages([msg(2), msg(1)], [msg(3), msg(2, { body: "اتعدّلت" })]);
    expect(r.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(r[1]!.body).toBe("اتعدّلت");
  });
});

describe("ChatThread", () => {
  it("بيعرض الرسايل وعلامة القراءة، وبيبعت بزر «ابعت»", async () => {
    const onSend = vi.fn(async () => undefined);
    render(<ToastProvider><ChatThread messages={[msg(1, { senderType: "staff", status: "read" }), msg(2, { kind: "system", body: "اتقفلت المحادثة" })]} me="staff" backend={backend} onSend={onSend} /></ToastProvider>);
    expect(screen.getByText("رسالة 1")).toBeTruthy();
    expect(screen.getByText("تمت القراءة")).toBeTruthy();
    expect(screen.getByText("اتقفلت المحادثة")).toBeTruthy();
    const send = screen.getByRole("button", { name: "ابعت" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.input(screen.getAllByRole("textbox")[0]!, { target: { value: "أهلًا" } });
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ body: "أهلًا", image: null, internal: false }));
  });
  it("للمشاهدة بس: مفيش مربع كتابة", () => {
    render(<ToastProvider><ChatThread messages={[msg(1)]} me="customer" backend={backend} /></ToastProvider>);
    expect(screen.queryByRole("button", { name: "ابعت" })).toBeNull();
  });
  it("الرسالة المخفية بتظهر بنص بديل", () => {
    render(<ToastProvider><ChatThread messages={[msg(1, { hidden: true })]} me="customer" backend={backend} /></ToastProvider>);
    expect(screen.getByText("الرسالة دي مخفية")).toBeTruthy();
  });
  it("إتاحة: من غير مخالفات", async () => {
    const { container } = render(<ToastProvider><ChatThread messages={[msg(1)]} me="staff" backend={backend} onSend={async () => undefined} allowInternal /></ToastProvider>);
    expect((await axe(container)).violations).toEqual([]);
  });
});
