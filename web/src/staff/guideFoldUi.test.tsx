/** @format */
// عناصر الطي في الدليل: العنوان ظاهر، التفاصيل مطوية، «افتح الكل/اقفل الكل» والقفز بيفتحوا اللي محتاجه.
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Fold, FoldTools, JumpBar, jumpTo } from "./GuideFold";

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); });

function Demo() {
  return (
    <section id="scope">
      <FoldTools scope="scope" />
      <JumpBar items={[{ id: "a", label: "شرح أ" }, { id: "b", label: "شرح ب" }]} />
      <Fold id="a" title="عنوان أ" sub="وصف أ" meta="2 خطوة">
        <p>تفاصيل أ</p>
        <Fold level={2} id="a1" title="خانة 1"><p>تفاصيل الخانة</p></Fold>
      </Fold>
      <Fold id="b" title="عنوان ب" open><p>تفاصيل ب</p></Fold>
    </section>
  );
}
const det = (id: string) => document.getElementById(id) as HTMLDetailsElement;

describe("عناصر الطي", () => {
  it("العنوان والوصف ظاهرين، والمطوي مقفول، والمفتوح بـopen مفتوح", () => {
    render(<Demo />);
    expect(screen.getByRole("heading", { name: "عنوان أ" })).toBeTruthy();
    expect(screen.getByText("وصف أ")).toBeTruthy();
    expect(det("a").open).toBe(false);
    expect(det("b").open).toBe(true);
  });

  it("افتح الكل بيفتح كل المستويات، واقفل الكل بيقفلهم", () => {
    render(<Demo />);
    fireEvent.click(screen.getByRole("button", { name: "افتح الكل" }));
    expect(det("a").open && det("a1").open && det("b").open).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "اقفل الكل" }));
    expect(det("a").open || det("a1").open || det("b").open).toBe(false);
  });

  it("القفز لعنصر جوه عنصر بيفتح الاتنين وينزل عليه", () => {
    render(<Demo />);
    jumpTo("a1");
    expect(det("a").open).toBe(true);
    expect(det("a1").open).toBe(true);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("شريحة القفز بتفتح الشرح، ومبتظهرش لو في عنصر واحد بس", () => {
    const { rerender } = render(<Demo />);
    fireEvent.click(screen.getByRole("button", { name: "شرح أ" }));
    expect(det("a").open).toBe(true);
    rerender(<JumpBar items={[{ id: "a", label: "شرح أ" }]} />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
