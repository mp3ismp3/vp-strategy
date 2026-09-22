import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LiquidityGuide } from "@/components/LiquidityGuide";

it("explains actual page controls, source names and the distinction between price levels and orders", () => {
  const html = renderToStaticMarkup(<LiquidityGuide />);
  for (const text of ["如何使用", "選擇標的", "前日高低", "選擇分析紀錄", "後續收盤", "0.05%–3%", "30%", "20 根", "下一交易日開盤", "5 個交易日", "0.10%", "95%", "搭配其他指標", "不會自動加分", "實際掛單", "不代表買賣指令"]) expect(html).toContain(text);
});

it("uses pure chronological analysis and labels source/confirmation dates separately", () => {
  const source = readFileSync("src/app/liquidity/page.tsx", "utf8");
  expect(source).toContain("analyzeLiquidity(ohlc)");
  expect(source).not.toContain("detectSweeps(ohlc, levels)");
  expect(source).not.toContain("function buildLiquidityLevels");
  expect(source).not.toContain("function detectSweeps");
  expect(source).not.toContain("void buildLiquidityLevels");
  expect(source).not.toContain("void detectSweeps");
  expect(source).toContain("確認日期");
  expect(source).toContain("來源日期");
  expect(source).toContain("尚無符合條件的掃蕩");
  expect(source).toContain("validateLiquidityStrategy(ohlc, sweeps)");
  expect(source).toContain("歷史門檻信號");
  expect(source).toContain("偏正觀察（非信號）");
  expect(source).toContain("watchSweeps={visiblePositiveSweeps}");
  expect(source).toContain("偏正觀察:");
  expect(source).toContain("level.confirmedTime");
  expect(source).toContain("x0: ohlc[level.confirmedIndex].time");
  expect(source).toContain("x: ohlc[level.confirmedIndex].time");
  expect(source).not.toContain("x0: ohlc[level.startIndex].time");
  expect(source).not.toContain("專業級流動性掃蕩偵測");
  expect(source).not.toContain(">有效<");
});
