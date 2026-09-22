import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { IndicatorFacts } from "@/components/IndicatorFacts";
import type { IndicatorReview } from "@/lib/indicator-review";

const review: IndicatorReview = {
  title: "2026-07-30 FVG $100–$104", summary: ["第三根完成日 2026-07-30。"],
  checks: [{ id: "filled", label: "完全填補", date: "2026-07-31", status: "not-met", evidence: "最低價 $102 > $100。" }],
};
it.each(["FVG", "Sweep"] as const)("renders %s summaries, dated checks and a record selector", name => {
  const html = renderToStaticMarkup(<IndicatorFacts name={name} reviews={[review]} />);
  expect(html).toContain(`${name} 自動摘要`);
  expect(html).toContain(`${name} 逐項比對`);
  expect(html).toContain("第三根完成日");
  expect(html).toContain("數據日期");
  expect(html).toContain("未成立");
  expect(html).toContain("選擇分析紀錄");
});
it("renders an empty-state summary without a misleading checklist", () => {
  const html = renderToStaticMarkup(<IndicatorFacts name="Sweep" reviews={[{ ...review, summary: ["資料不足"], checks: [] }]} />);
  expect(html).toContain("資料不足");
  expect(html).not.toContain("<table");
});
it("wires FVG to completed bars and gates the new details", () => {
  const page = "fvg";
  const source = readFileSync(`src/app/${page}/page.tsx`, "utf8");
  expect(source).toContain("completedDailyBars");
  expect(source).toContain("chart?.daily?.captured_at");
  expect(source.indexOf("<IndicatorFacts")).toBeGreaterThan(source.indexOf("<SignalMosaic locked={!isPaid}>"));
  expect(source).toContain("!loading && <IndicatorFacts");
});
