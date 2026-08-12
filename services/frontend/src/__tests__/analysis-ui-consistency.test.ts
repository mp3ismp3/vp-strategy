import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { stripDecorativeSymbols } from "@/lib/analysis-display";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const analysisSurfaces = [
  "src/app/scanner/page.tsx",
  "src/app/accumulation/page.tsx",
  "src/app/fusion/page.tsx",
  "src/app/strategy/page.tsx",
  "src/app/indicator/page.tsx",
  "src/app/liquidity/page.tsx",
  "src/app/fvg/page.tsx",
  "src/app/macd/page.tsx",
  "src/app/crypto-liquidity/page.tsx",
  "src/components/SignalMosaic.tsx",
  "src/components/StrategyGuide.tsx",
];

describe("analysis UI consistency", () => {
  it("marks unavailable ETF flow cards as coming soon", () => {
    const source = read("src/app/crypto-liquidity/page.tsx");

    expect(source).toContain('"Coming soon"');
    expect(source).not.toContain('"尚未設定來源"');
    expect(source).not.toContain('"Not configured"');
  });

  it("keeps shared card styles scoped to Crypto Liquidity", () => {
    const styles = read("src/app/globals.css");

    expect(styles).toContain(".analysis-page");
    expect(styles).not.toContain("min-h-screen");
    expect(styles).not.toContain("bg-gray-50/60");
    expect(styles).not.toContain(":where(.bg-white.rounded-xl");

    for (const path of analysisSurfaces.filter((path) => path !== "src/app/crypto-liquidity/page.tsx")) {
      expect(read(path), path).not.toContain("analysis-page");
    }
  });

  it("does not use decorative emoji on analysis surfaces", () => {
    const emoji = /[🔒📖🟢🔴📊💡📈⚡🌊🚀🟡⚪❌⭐🎯👀⏸️💧📋⬆⬇🏛️⏳✅💰📐🔍🔥📅⚠️✓]/u;

    for (const path of analysisSurfaces) {
      expect(read(path), path).not.toMatch(emoji);
    }
  });

  it("removes decorative symbols received in Fusion display text", () => {
    expect(stripDecorativeSymbols("⭐ 黃金入場區")).toBe("黃金入場區");
    expect(stripDecorativeSymbols("⚠️ 假突破?")).toBe("假突破?");
    expect(stripDecorativeSymbols("❌ 不追，等回踩")).toBe("不追，等回踩");
  });
});
