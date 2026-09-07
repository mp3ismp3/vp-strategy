import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  single: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({ from: mocks.from }),
}));

import { authOptions } from "@/lib/auth";

describe("session entitlement snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.single.mockResolvedValue({
      data: {
        plan: "premium",
        subscription_status: "active",
        current_period_end: "2099-01-01T00:00:00.000Z",
        cancel_at_period_end: false,
      },
    });
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () => ({ single: mocks.single }),
      }),
    });
  });

  it("does not query Supabase during an ordinary JWT session refresh", async () => {
    const jwt = authOptions.callbacks?.jwt;
    expect(jwt).toBeTypeOf("function");

    const token = {
      email: "member@example.com",
      plan: "pro",
      planRefreshedAt: Date.now(),
    };
    const result = await jwt!({ token } as never);

    expect(result).toBe(token);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("refreshes a missing or expired snapshot without trusting stale UI state", async () => {
    const jwt = authOptions.callbacks?.jwt;

    const refreshed = await jwt!({
      token: {
        email: "member@example.com",
        plan: "free",
        planRefreshedAt: 0,
      },
    } as never);

    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(refreshed).toMatchObject({
      plan: "premium",
      subscriptionStatus: "active",
      planRefreshedAt: expect.any(Number),
    });
  });

  it("refreshes the informational snapshot on sign-in or explicit update", async () => {
    const jwt = authOptions.callbacks?.jwt;

    const signedIn = await jwt!({
      token: { email: "member@example.com" },
      user: { id: "user-1" },
    } as never);
    expect(signedIn).toMatchObject({ userId: "user-1", plan: "premium" });

    vi.clearAllMocks();
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () => ({ single: mocks.single }),
      }),
    });
    await jwt!({
      token: { email: "member@example.com", plan: "free" },
      trigger: "update",
    } as never);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
});
