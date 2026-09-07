import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("analysis navigation performance", () => {
  it("uses the scan response as the scanner plan snapshot", () => {
    const page = readFileSync("src/app/scanner/page.tsx", "utf8");
    const route = readFileSync("src/app/api/data/scan-results/route.ts", "utf8");

    expect(page).not.toContain('fetch("/api/user/plan")');
    expect(page).toContain("data.accessPlan");
    expect(page).toContain("resultsEmail === session?.user?.email");
    expect(page).toContain("visibleResults.find");
    expect(route).toContain("accessPlan: plan");
    expect(readFileSync("openapi.yaml", "utf8")).toContain(
      "required: [results, accessPlan]"
    );
  });

  it("lets the authoritative fusion API response drive access UI", () => {
    const page = readFileSync("src/app/fusion/page.tsx", "utf8");

    expect(page).not.toContain("<Paywall");
    expect(page).not.toContain('from "@/components/Paywall"');
    expect(page).toContain("response.status === 401");
    expect(page).toContain("response.status === 403");
  });

  it("provides prefetched loading boundaries for data-heavy routes", () => {
    for (const route of [
      "scanner",
      "accumulation",
      "fusion",
      "dashboard",
      "dashboard/[ticker]",
    ]) {
      expect(existsSync(`src/app/${route}/loading.tsx`)).toBe(true);
    }
  });
});
