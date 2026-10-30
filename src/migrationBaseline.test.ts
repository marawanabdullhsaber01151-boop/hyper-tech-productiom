import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("الأساس (baseline) يكفي لتشغيل كل الهجرات على قاعدة فاضية", () => {
  it("جدول production_requests فيه workflow_order_id (الهجرة 0055 بتبني عليه فهرس وUPDATE)", () => {
    const baseline = read("drizzle/0000_0000_initial_schema.sql");
    const block = baseline.match(/CREATE TABLE "production_requests" \(([\s\S]*?)\n\);/)?.[1] ?? "";
    expect(block).toContain('"workflow_order_id" integer');
    expect(read("migrations/0055_phase2_canonical_production_domain.sql")).toContain("ON production_requests(workflow_order_id)");
  });
});
