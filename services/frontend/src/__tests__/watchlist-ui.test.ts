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
    expect(detail).toContain("FVGChart");
    expect(detail).toContain("Fair Value Gap");
  });

  it("uses compact watchlist controls and localized VP labels", () => {
    const button = source("src/components/WatchlistButton.tsx");
    const dashboard = source("src/app/dashboard/page.tsx");
    expect(button).toContain('aria-label={saved ? "移除觀察" : "加入觀察"}');
    expect(button).toContain('saved ? "−" : "+"');
    expect(dashboard).toContain("getVpPositionLabel");
    expect(dashboard).toContain("日線");
    expect(dashboard).toContain("週線");
    expect(dashboard).toContain("月線");
  });
});
