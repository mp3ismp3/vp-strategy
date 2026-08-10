import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  sanitizeAccumulationForPlan,
  statusForRequiredPlan,
} from "@/lib/data-entitlement";

describe("server-side data entitlement", () => {
  it("requires authentication for production data", () => {
    expect(statusForRequiredPlan(null, "free")).toBe(401);
  });

  it("reserves fusion for premium", () => {
    expect(statusForRequiredPlan("free", "premium")).toBe(403);
    expect(statusForRequiredPlan("pro", "premium")).toBe(403);
    expect(statusForRequiredPlan("premium", "premium")).toBe(200);
  });

  it("removes actionable accumulation fields from free data", () => {
    const rows = [{
      ticker: "NVDA",
      phase: "C",
      tier: "confirmed",
      decay_score: 12,
      raw_score: 14,
      support_primary: 100,
      support_dynamic: 102,
      resistance: 120,
      failing: false,
      triggers_fired: [{ type: "Spring" }],
      pending_triggers: [{ type: "LPS" }],
    }];

    expect(sanitizeAccumulationForPlan(rows, "free")).toEqual([{
      ticker: "NVDA",
      phase: "C",
      tier: "confirmed",
      decay_score: 12,
      raw_score: 14,
      failing: false,
    }]);
    expect(sanitizeAccumulationForPlan(rows, "pro")[0]).toHaveProperty(
      "support_primary",
      100
    );
    expect(sanitizeAccumulationForPlan(rows, "free")[0]).not.toHaveProperty(
      "pending_triggers"
    );
    expect(sanitizeAccumulationForPlan(rows, "premium")[0]).toHaveProperty(
      "pending_triggers"
    );
  });

  it("keeps production analysis tables server-only", () => {
    const migration = readFileSync("supabase_billing_providers.sql", "utf8");
    for (const table of [
      "users",
      "telegram_bind_tokens",
      "subscription_events",
      "scan_results",
      "scan_data",
      "chart_data",
      "accum_data",
    ]) {
      expect(migration).toContain(`REVOKE ALL ON public.${table} FROM anon, authenticated`);
    }
  });

  it("does not read production Supabase tables directly from client pages", () => {
    for (const file of [
      "src/app/scanner/page.tsx",
      "src/app/accumulation/page.tsx",
      "src/app/strategy/page.tsx",
      "src/app/macd/page.tsx",
      "src/app/fvg/page.tsx",
      "src/app/liquidity/page.tsx",
      "src/components/charts/VPChart.tsx",
      "src/components/charts/AccumChart.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
      expect(source).not.toContain('from("chart_data")');
      expect(source).not.toContain('from("scan_data")');
      expect(source).not.toContain('from("accum_data")');
    }
  });
});
