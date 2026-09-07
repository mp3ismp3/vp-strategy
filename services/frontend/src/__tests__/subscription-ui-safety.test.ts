import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { resolvePlanSnapshot } from "@/lib/plans";
import { refreshSessionAfterPayment } from "@/lib/session-plan-sync";
import { formatTrigger } from "@/lib/triggers";

describe("subscription UI safety", () => {
  it("syncs the session on the ECPay success return", () => {
    const accountPage = readFileSync("src/app/account/page.tsx", "utf8");

    expect(accountPage).toContain('payment") === "success"');
    expect(accountPage).toContain("refreshSessionAfterPayment");
    expect(accountPage).toContain("updateSession: update");
  });

  it("refreshes the session as soon as the paid plan becomes authoritative", async () => {
    const fetchPlan = vi.fn()
      .mockResolvedValueOnce({ plan: "free", subscriptionStatus: "inactive" })
      .mockResolvedValueOnce({ plan: "premium", subscriptionStatus: "active" });
    const updateSession = vi.fn().mockResolvedValue({ user: { plan: "premium" } });
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await refreshSessionAfterPayment({
      fetchPlan,
      updateSession,
      wait,
      maxAttempts: 3,
    });

    expect(result.plan).toBe("premium");
    expect(fetchPlan).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(updateSession).toHaveBeenCalledTimes(1);
  });

  it("does not promote the UI when payment entitlement is still unavailable", async () => {
    const fetchPlan = vi.fn().mockResolvedValue({
      plan: "free",
      subscriptionStatus: "inactive",
    });
    const updateSession = vi.fn();

    const result = await refreshSessionAfterPayment({
      fetchPlan,
      updateSession,
      wait: () => Promise.resolve(),
      maxAttempts: 2,
    });

    expect(result.plan).toBe("free");
    expect(fetchPlan).toHaveBeenCalledTimes(2);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("retries a transient plan lookup failure after the payment return", async () => {
    const fetchPlan = vi.fn()
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce({ plan: "pro", subscriptionStatus: "active" });
    const updateSession = vi.fn().mockResolvedValue({ user: { plan: "pro" } });
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(refreshSessionAfterPayment({
      fetchPlan,
      updateSession,
      wait,
      maxAttempts: 2,
    })).resolves.toMatchObject({ plan: "pro" });
    expect(wait).toHaveBeenCalledTimes(1);
    expect(updateSession).toHaveBeenCalledTimes(1);
  });

  it("does not complete when the paid plan is missing from the refreshed session", async () => {
    const fetchPlan = vi.fn().mockResolvedValue({
      plan: "premium",
      subscriptionStatus: "active",
    });
    const updateSession = vi.fn().mockResolvedValue({
      user: { plan: "free" },
    });

    await expect(refreshSessionAfterPayment({
      fetchPlan,
      updateSession,
      wait: () => Promise.resolve(),
      maxAttempts: 2,
    })).rejects.toThrow("Session plan did not refresh");
  });

  it("stops before updating the session when the account effect is cancelled", async () => {
    let cancelled = false;
    const fetchPlan = vi.fn().mockImplementation(async () => {
      cancelled = true;
      return { plan: "premium", subscriptionStatus: "active" };
    });
    const updateSession = vi.fn();

    await expect(refreshSessionAfterPayment({
      fetchPlan,
      updateSession,
      isCancelled: () => cancelled,
    })).rejects.toThrow("Session plan refresh cancelled");
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("clears account-scoped plan state before loading another account", () => {
    const accountPage = readFileSync("src/app/account/page.tsx", "utf8");

    expect(accountPage).toContain("accountPlanInfo.email === session?.user?.email");
    expect(accountPage).toContain("isCancelled: () => cancelled");
  });

  it("keeps payment polling below the authenticated strict-tier budget", async () => {
    const fetchPlan = vi.fn().mockResolvedValue({
      plan: "free",
      subscriptionStatus: "inactive",
    });

    await refreshSessionAfterPayment({
      fetchPlan,
      updateSession: vi.fn(),
      wait: () => Promise.resolve(),
    });

    expect(fetchPlan).toHaveBeenCalledTimes(4);
  });

  it("fails closed when the plan snapshot belongs to another account", () => {
    expect(
      resolvePlanSnapshot(
        { email: "paid@example.com", plan: "premium", status: "active" },
        "new@example.com"
      )
    ).toEqual({ plan: "free", ready: false, status: "inactive" });
  });

  it("accepts an explicit free snapshot after a plan lookup failure", () => {
    expect(
      resolvePlanSnapshot(
        { email: "new@example.com", plan: "free", status: "inactive" },
        "new@example.com"
      )
    ).toEqual({ plan: "free", ready: true, status: "inactive" });
  });

  it("formats both legacy string and object triggers", () => {
    expect(formatTrigger("Spring")).toBe("Spring");
    expect(formatTrigger({ type: "LPS", date: "2026-08-07" })).toBe("LPS");
  });
});
