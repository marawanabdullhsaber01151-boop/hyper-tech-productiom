import { beforeEach, describe, expect, it, vi } from "vitest";

const { sessionState, fakeDb } = vi.hoisted(() => {
  const state: {
    id: number;
    portalCustomerId: number;
    phone: string;
    sessionToken: string;
    rememberMe: boolean;
    expiresAt: Date;
    lastActiveAt: Date;
    revokedAt: Date | null;
  } = {
    id: 1,
    portalCustomerId: 0,
    phone: "",
    sessionToken: "",
    rememberMe: false,
    expiresAt: new Date(0),
    lastActiveAt: new Date(0),
    revokedAt: null,
  };

  const db = {
    insert: () => ({
      values: (values: any) => ({
        returning: async () => {
          Object.assign(state, values, {
            id: 1,
            revokedAt: null,
          });
          state.phone = "01000000000";
          return [{ sessionToken: state.sessionToken }];
        },
      }),
    }),
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => {
              const now = new Date();
              const active =
                state.sessionToken &&
                state.revokedAt === null &&
                state.expiresAt > now;
              return active ?
                  [
                    {
                      session: { ...state },
                      customer: {
                        id: state.portalCustomerId,
                        phone: state.phone,
                      },
                    },
                  ]
                : [];
            },
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: any) => ({
        where: () => ({
          returning: async () => {
            if (!state.sessionToken || state.revokedAt !== null) return [];
            if (Object.prototype.hasOwnProperty.call(values, "revokedAt")) {
              state.revokedAt = values.revokedAt;
              return [{ id: state.id }];
            }
            if (state.expiresAt <= new Date()) return [];
            Object.assign(state, values);
            return [{ id: state.id }];
          },
        }),
      }),
    }),
  };

  return { sessionState: state, fakeDb: db };
});

vi.mock("../db", () => ({ db: fakeDb }));

const {
  createPortalSession,
  requirePortalAuth,
  revokePortalSession,
  revokeAllPortalSessions,
  getAuthenticatedPortalCustomerId,
} = await import("./portal-auth");

function responseDouble() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as any;
}

describe("portal reference-token sessions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T10:00:00.000Z"));
    Object.assign(sessionState, {
      id: 1,
      portalCustomerId: 0,
      phone: "",
      sessionToken: "",
      rememberMe: false,
      expiresAt: new Date(0),
      lastActiveAt: new Date(0),
      revokedAt: null,
    });
  });

  it("creates an opaque session with the requested lifetime and device label", async () => {
    const token = await createPortalSession(42, {
      rememberMe: true,
      ip: "192.0.2.10",
      userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120",
    });

    expect(token).toBe(sessionState.sessionToken);
    expect(token).toHaveLength(43);
    expect(token).not.toContain(".");
    expect(sessionState.portalCustomerId).toBe(42);
    expect(sessionState.rememberMe).toBe(true);
    expect(sessionState.expiresAt).toEqual(
      new Date("2026-10-03T10:00:00.000Z"),
    );
  });

  it("accepts a live session and slides expiry from the latest activity", async () => {
    const token = await createPortalSession(7);
    const req = {
      headers: { authorization: `Bearer ${token}` },
    } as any;
    const res = responseDouble();
    const next = vi.fn();

    await requirePortalAuth(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.portalCustomer).toEqual({
      portalCustomerId: 7,
      phone: "01000000000",
      sessionId: 1,
    });

    vi.advanceTimersByTime(60 * 1000);
    await requirePortalAuth(req, res, next);

    expect(sessionState.lastActiveAt).toEqual(
      new Date("2026-09-03T10:01:00.000Z"),
    );
    expect(sessionState.expiresAt).toEqual(
      new Date("2026-09-04T10:01:00.000Z"),
    );
  });

  it("ignores a forged customer id supplied alongside the session token", async () => {
    const token = await createPortalSession(7);
    const req = {
      headers: { authorization: `Bearer ${token}` },
      body: { portalCustomerId: 999999, contactId: 999999 },
    } as any;
    const res = responseDouble();
    const next = vi.fn();

    await requirePortalAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.portalCustomer).toMatchObject({ portalCustomerId: 7 });
    expect(req.portalCustomer).not.toMatchObject({ portalCustomerId: 999999 });
  });

  it("rejects an expired session and never slides it", async () => {
    const token = await createPortalSession(7);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    const expiresAtBeforeRequest = sessionState.expiresAt;
    const req = {
      headers: { authorization: `Bearer ${token}` },
    } as any;
    const res = responseDouble();
    const next = vi.fn();

    await requirePortalAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(sessionState.expiresAt).toEqual(expiresAtBeforeRequest);
  });

  it("revokes a session immediately", async () => {
    const token = await createPortalSession(7);
    expect(await revokePortalSession(token)).toBe(true);

    const req = {
      headers: { authorization: `Bearer ${token}` },
    } as any;
    const res = responseDouble();
    const next = vi.fn();

    await requirePortalAuth(req, res, next);

    expect(sessionState.revokedAt).toEqual(
      new Date("2026-09-03T10:00:00.000Z"),
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("revokes every active session for a customer", async () => {
    await createPortalSession(7);

    expect(await revokeAllPortalSessions(7)).toBe(1);
    expect(sessionState.revokedAt).toEqual(
      new Date("2026-09-03T10:00:00.000Z"),
    );
  });

  it("derives ownership only from the authenticated session payload", () => {
    expect(
      getAuthenticatedPortalCustomerId({
        portalCustomer: {
          portalCustomerId: 7,
          phone: "01000000000",
          sessionId: 1,
        },
      }),
    ).toBe(7);

    expect(() =>
      getAuthenticatedPortalCustomerId({ portalCustomer: undefined }),
    ).toThrowError();
  });
});