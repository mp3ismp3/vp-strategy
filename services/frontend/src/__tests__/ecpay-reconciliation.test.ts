import { describe, expect, it } from "vitest";

import { auditEcpaySubscription } from "@/lib/ecpay-reconciliation";

describe("ECPay reconciliation audit", () => {
  it("flags an active subscription whose paid period has expired", () => {
    expect(auditEcpaySubscription({
      id: "sub_1",
      status: "active",
      current_period_end: "2026-08-01T00:00:00.000Z",
      last_provider_event_at: "2026-07-01T00:00:00.000Z",
    }, new Date("2026-08-02T00:00:00.000Z"))).toMatchObject({
      severity: "critical",
      issue: "active_period_expired",
    });
  });

  it("flags a missing renewal callback before entitlement expires", () => {
    expect(auditEcpaySubscription({
      id: "sub_2",
      status: "active",
      current_period_end: "2026-08-01T00:00:00.000Z",
      last_provider_event_at: "2026-07-01T00:00:00.000Z",
    }, new Date("2026-08-01T06:00:00.000Z"), 12)).toMatchObject({
      severity: "warning",
      issue: "renewal_callback_overdue",
    });
  });

  it("keeps a healthy active subscription clear", () => {
    expect(auditEcpaySubscription({
      id: "sub_3",
      status: "active",
      current_period_end: "2026-09-01T00:00:00.000Z",
      last_provider_event_at: "2026-08-01T00:00:00.000Z",
    }, new Date("2026-08-10T00:00:00.000Z"))).toBeNull();
  });
});
