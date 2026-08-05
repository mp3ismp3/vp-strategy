import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const pages = [
  { path: "src/app/macd/page.tsx", chart: "<MACDChart" },
  { path: "src/app/fvg/page.tsx", chart: "<FVGChart" },
  { path: "src/app/liquidity/page.tsx", chart: "<LiquidityChart" },
];

describe("indicator guest preview layout", () => {
  it.each(pages)("keeps the chart visible and uses one signal lock in $path", ({ path, chart }) => {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    const locks = source.match(/<SignalMosaic\b/g) ?? [];

    expect(locks).toHaveLength(1);
    expect(source.indexOf(chart)).toBeGreaterThan(-1);
    expect(source.indexOf(chart)).toBeLessThan(source.indexOf("<SignalMosaic"));
  });
});
