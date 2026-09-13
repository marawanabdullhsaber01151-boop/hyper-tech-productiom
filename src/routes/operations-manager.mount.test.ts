import { afterEach, describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgresql://stage02:stage02@localhost:5432/stage02";
process.env.SESSION_SECRET ??= "test-session-secret";

const { default: app } = await import("../main");

describe("operations manager route mounting", () => {
  let server: ReturnType<typeof app.listen> | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
    server = undefined;
  });

  it("is mounted in the real application and is not reported as 404", async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not expose a TCP address");
    }

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/operations-manager/cases`,
    );
    expect(response.status).not.toBe(404);
    expect(response.status).toBe(401);
  });
});