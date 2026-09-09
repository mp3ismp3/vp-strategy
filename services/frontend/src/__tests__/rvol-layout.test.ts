import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = readFileSync("src/app/macd/page.tsx", "utf8");
it("makes price-volume the primary view and MACD optional", () => {
  expect(source).toContain("突破與回踩觀察");
  expect(source.indexOf('aria-label="RVOL 量價訊號"')).toBeLessThan(source.indexOf("<MACDChart"));
  expect(source).toContain("MACD 輔助分析（選看）");
  expect(source).not.toContain("最強訊號");
  expect(source).toContain("判斷規則與 RVOL 分級");
  expect(source).toContain("顯示已到期形態");
});
