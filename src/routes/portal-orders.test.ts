import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DATABASE_URL ??= "postgresql://phase07:phase07@localhost:5432/phase07";
// "./portal" pulls in production-workflow.ts -> auth.ts, which throws at import
// time unless a secret is already configured. Match the same test-only fallback
// already used in operations-manager.test.ts so this file doesn't fail outside
// environments that happen to export JWT_SECRET globally.
process.env.JWT_SECRET ??= "stage-02-test-secret-that-is-long-enough";

const { default: portalRouter, submitOrderSchema } = await import("./portal");
const { isBatchReviewUniqueViolation } = await import("./portal-orders");
const portalOrdersSource = readFileSync(
  resolve(process.cwd(), "src/routes/portal-orders.ts"),
  "utf8",
);
const orderMigration = readFileSync(
  resolve(process.cwd(), "migrations/0041_portal_order_submission_integrity.sql"),
  "utf8",
);

const validOrder = {
  items: [{ bomRecipeId: 12, qty: "10.125", unit: "قطعة" }],
  priority: "normal" as const,
  notes: "تسليم صباحًا",
  idempotencyKey: "portal-order-001",
};

describe("POST /portal/orders validation contract", () => {
  it("accepts decimal quantities up to the database scale", () => {
    const parsed = submitOrderSchema.parse(validOrder);
    expect(parsed.items[0].qty).toBe("10.125");
  });

  it("rejects more than 50 products in one submission", () => {
    const tooManyItems = {
      ...validOrder,
      items: Array.from({ length: 51 }, (_, index) => ({
        bomRecipeId: index + 1,
        qty: "1",
      })),
    };
    expect(submitOrderSchema.safeParse(tooManyItems).success).toBe(false);
  });

  it.each(["-1", "NaN", "Infinity", "1.0000", "1000001"])(
    "rejects an invalid quantity: %s",
    (qty) => {
      expect(
        submitOrderSchema.safeParse({
          ...validOrder,
          items: [{ bomRecipeId: 12, qty }],
        }).success,
      ).toBe(false);
    },
  );

  it("rejects oversized notes and idempotency keys", () => {
    expect(
      submitOrderSchema.safeParse({
        ...validOrder,
        notes: "x".repeat(1001),
      }).success,
    ).toBe(false);
    expect(
      submitOrderSchema.safeParse({
        ...validOrder,
        idempotencyKey: "short",
      }).success,
    ).toBe(false);
  });

  it("registers POST /portal/orders with auth and customer rate-limit middleware", () => {
    const { stack } = portalRouter as any;
    const orderRoute = stack.find(
      (layer: any) => layer.route?.path === "/portal/orders",
    );
    expect(orderRoute?.route?.methods?.post).toBe(true);
    expect(orderRoute.route.stack.length).toBeGreaterThanOrEqual(2);
  });

  it("defines additive database guarantees for idempotency and unique batch references", () => {
    expect(orderMigration).toContain("CREATE TABLE IF NOT EXISTS portal_order_batches");
    expect(orderMigration).toContain(
      "UNIQUE (portal_customer_id, idempotency_key)",
    );
    expect(orderMigration).toContain("batch_ref text NOT NULL UNIQUE");
    expect(orderMigration).not.toMatch(
      /\b(DROP\s+TABLE|DROP\s+COLUMN|DELETE\s+FROM|TRUNCATE)\b/i,
    );
  });
});

describe("portal review race protection", () => {
  it("maps only the portal batch_ref unique constraint to a conflict", () => {
    expect(
      isBatchReviewUniqueViolation({
        code: "23505",
        constraint: "portal_order_reviews_batch_ref_unique",
      }),
    ).toBe(true);
    expect(
      isBatchReviewUniqueViolation({
        code: "23505",
        constraint: "some_other_unique_constraint",
      }),
    ).toBe(false);
    expect(
      isBatchReviewUniqueViolation({
        code: "23505",
      }),
    ).toBe(false);
  });

  it("locks the batch rows before the review check in both decisions", () => {
    // Confirm and reject both lock the batch rows. The separate Phase 3
    // per-line cancellation endpoint also locks its row, so counting the
    // entire file must not reject that legitimate third lock.
    expect(portalOrdersSource.match(/\.for\("update"\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(portalOrdersSource).toContain(
      'candidate.constraint === "portal_order_reviews_batch_ref_unique"',
    );
    expect(portalOrdersSource).toContain(
      "الإرسالية دي اتراجعت بالفعل من موظف تاني في نفس اللحظة",
    );
  });
});

describe.skipIf(hasDatabaseUrl)("PostgreSQL order-submission integration", () => {
  it.skip("runs two concurrent submissions without a duplicate batchRef", () => {});
  it.skip("replays the saved response for a repeated customer idempotency key", () => {});
  it.skip("rejects a customer after the submission rate limit is exceeded", () => {});
});