import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("personal watchlist UI", () => {
  it("adds the dashboard to primary navigation", () => {
    expect(source("src/components/Navbar.tsx")).toContain('{ href: "/dashboard", label: "我的觀察" }');
  });

  it("provides an authenticated dashboard with add, remove and reorder actions", () => {
    const dashboard = source("src/app/dashboard/page.tsx");
    expect(dashboard).toContain("/api/user/watchlist");
    expect(dashboard).toContain("removeTicker");
    expect(dashboard).toContain("moveTicker");
    expect(dashboard).toContain("我的觀察清單");
  });

  it("provides a ticker detail page for VP, accumulation and FVG", () => {
    const detail = source("src/app/dashboard/[ticker]/page.tsx");
    expect(detail).toContain("VPChart");
    expect(detail).toContain("AccumChart");
    expect(detail).toContain("Fair Value Gap");
  });
});
