import { describe, expect, it } from "vitest";
import {
  getCycleStage,
  PRODUCTION_CYCLE_STAGES,
} from "./production-cycle";

describe("production cycle", () => {
  it("exposes the complete ordered cycle", () => {
    expect(PRODUCTION_CYCLE_STAGES).toHaveLength(11);
    expect(PRODUCTION_CYCLE_STAGES.map((stage) => stage.number)).toEqual(
      Array.from({ length: 11 }, (_, index) => index),
    );
  });

  it("maps workflow statuses to operational stages", () => {
    expect(getCycleStage("in_production").key).toBe("execution");
    expect(getCycleStage("quality_check").key).toBe("quality");
    expect(getCycleStage("delivered_warehouse").key).toBe("delivery");
  });
});
