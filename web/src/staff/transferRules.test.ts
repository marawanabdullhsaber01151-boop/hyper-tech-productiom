import { describe, expect, it } from "vitest";
import { QUANTITY_RE, canReceiveTransfer, creatableDirections, newIdempotencyKey, stockNote } from "./transferRules";

describe("قواعد التحويلات", () => {
  it("مدير المخزن يبدأ من المخزن للتشغيل ويستلم الراجع للمخزن بس", () => {
    expect(creatableDirections("warehouse_manager")).toEqual(["warehouse_to_operations"]);
    expect(canReceiveTransfer("warehouse_manager", "operations_to_warehouse")).toBe(true);
    expect(canReceiveTransfer("warehouse_manager", "warehouse_to_operations")).toBe(false);
  });
  it("مدير التشغيل يبدأ كل الاتجاهات ويستلم من المخزن ومن الإنتاج، والإنتاج يستلم من التشغيل", () => {
    expect(creatableDirections("operations_manager")).toHaveLength(4);
    expect(canReceiveTransfer("operations_manager", "production_to_operations")).toBe(true);
    expect(canReceiveTransfer("operations_manager", "operations_to_production")).toBe(false);
    expect(canReceiveTransfer("production_manager", "operations_to_production")).toBe(true);
    expect(canReceiveTransfer("supervisor", "operations_to_production")).toBe(true);
  });
  it("دور غريب أو اتجاه غريب مفيش له صلاحية", () => {
    expect(creatableDirections("storekeeper")).toEqual([]);
    expect(canReceiveTransfer("chairman", "nope")).toBe(false);
  });
  it("أثر المخزن واضح، والكمية والمفتاح صالحين", () => {
    expect(stockNote("warehouse_to_operations")).toBe("out");
    expect(stockNote("operations_to_warehouse")).toBe("in");
    expect(stockNote("operations_to_production")).toBe("none");
    expect(QUANTITY_RE.test("12.5")).toBe(true);
    expect(QUANTITY_RE.test("12.5555")).toBe(false);
    expect(QUANTITY_RE.test("-1")).toBe(false);
    const k = newIdempotencyKey();
    expect(k.length).toBeGreaterThanOrEqual(8);
    expect(newIdempotencyKey()).not.toBe(k);
  });
});
