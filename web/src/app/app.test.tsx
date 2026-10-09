import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";
import { Link, matchRoute, navigate, Router } from "./router";

describe("router", () => {
  const routes = [
    { path: "/team", render: () => <p>الفريق</p> },
    { path: "/orders/:id", render: (p: Record<string, string>) => <p>طلب {p.id}</p> },
  ];
  it("بيطابق ويطلّع المتغيرات", () => {
    expect(matchRoute(routes, "/orders/12")?.params).toEqual({ id: "12" });
    expect(matchRoute(routes, "/orders")).toBeNull();
    expect(matchRoute(routes, "/orders/%D8%A3")?.params.id).toBe("أ");
  });
  it("Link بيغيّر الصفحة من غير reload", () => {
    history.replaceState(null, "", "/v2/");
    render(<><Link to="/team">روح</Link><Router routes={routes} notFound={() => <p>مش موجود</p>} /></>);
    expect(screen.getByText("مش موجود")).toBeInTheDocument();
    fireEvent.click(screen.getByText("روح"));
    expect(screen.getByText("الفريق")).toBeInTheDocument();
    navigate("/orders/5");
    expect(location.pathname).toBe("/v2/orders/5");
  });
});

describe("ErrorBoundary", () => {
  it("بيعرض شاشة مفهومة بدل صفحة بيضا", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Boom = () => {
      throw new Error("boom");
    };
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("الصفحة وقفت");
    expect(screen.getByRole("button", { name: "حدّث الصفحة" })).toBeInTheDocument();
  });
});
