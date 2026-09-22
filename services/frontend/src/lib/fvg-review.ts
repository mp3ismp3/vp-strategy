import type { OHLCBar } from "./macd";
import { type IndicatorReview, reviewPrice as price, reviewOutcome as outcome, validReviewBars } from "./indicator-review";

interface FvgRecord {
  type: "bullish" | "bearish";
  date: string;
  gapLow: number;
  gapHigh: number;
}

/** Explain a page-detected gap using its original three candles, not rounded fill percentages. */
export function buildFvgReview(gap: FvgRecord | null, bars: OHLCBar[]): IndicatorReview {
  const result: IndicatorReview = { title: "FVG", summary: [], checks: [] };
  if (!validReviewBars(bars) || bars.length < 3) {
    result.summary = ["日 K 資料不足或無效，無法分析 FVG。"];
    return result;
  }
  const latest = bars.at(-1)!;
  if (!gap) {
    result.summary = [bars.length < 20 ? "資料不足：目前 FVG 頁面至少需要 20 根日 K。"
      : `截至 ${latest.time}，目前篩選範圍沒有 FVG 紀錄；不代表其他期間沒有缺口。`];
    return result;
  }
  const middle = bars.findIndex(bar => bar.time === gap.date);
  if (middle < 1 || middle + 1 >= bars.length) {
    result.summary = ["缺口日期或第三根日 K 資料不足，無法確認三根結構。"];
    return result;
  }
  const bullish = gap.type === "bullish";
  const first = bars[middle - 1];
  const third = bars[middle + 1];
  const low = bullish ? first.high : third.high;
  const high = bullish ? third.low : first.low;
  if (high <= low || Math.round(low * 100) / 100 !== gap.gapLow || Math.round(high * 100) / 100 !== gap.gapHigh) {
    result.summary = ["缺口價位與原始日 K 不一致，暫不產生比對。"];
    return result;
  }
  result.title = `${gap.date} ${bullish ? "Bullish" : "Bearish"} FVG ${price(low)}–${price(high)}`;
  const subsequent = bars.slice(middle + 2);
  const fillBar = subsequent.find(bar => bullish ? bar.low <= low : bar.high >= high);
  const extreme = subsequent.length ? (bullish ? Math.min(...subsequent.map(bar => bar.low)) : Math.max(...subsequent.map(bar => bar.high))) : (bullish ? high : low);
  const fillPct = Math.min(1, Math.max(0, bullish ? (high - extreme) / (high - low) : (extreme - low) / (high - low))) * 100;
  const inside = latest.close >= low && latest.close <= high;
  const edge = latest.close > high ? high : low;
  const distance = inside ? 0 : (latest.close / edge - 1) * 100;
  const position = inside ? "區間內" : latest.close > high ? "上方" : "下方";
  const formedToday = latest.time === third.time;
  const filledEarlier = Boolean(fillBar && fillBar.time < latest.time);
  const overlap = latest.low <= high && latest.high >= low;
  result.summary = [
    `結構中間日 ${gap.date}；第三根完成日 ${third.time}，三根結構最早在此日完成後可確認。缺口 ${price(low)}–${price(high)}。`,
    `截至 ${latest.time}（已完成日 K），收盤 ${price(latest.close)} 位於缺口${position}，距最近邊界 ${distance >= 0 ? "+" : ""}${distance.toFixed(2)}%（區間內為 0）。`,
    `形成後累計填補 ${fillPct.toFixed(2)}%；${fillBar ? `首次完全填補 ${fillBar.time}` : "尚未完全填補"}。`,
    formedToday ? "第三根形成當日，不計為形成後再次觸及。" : filledEarlier ? "此缺口此前已完全填補，最新價格位置不會恢復未填補狀態。"
      : `${latest.time} 日 K ${overlap ? "與缺口區間重疊" : "未與缺口區間重疊"}；觸及與完全填補分開判斷。`,
    "缺口清單依目前快照的 ATR 篩選；第三根完成日不代表該缺口當時已通過相同篩選。",
  ];
  result.checks = [
    { id: "structure", label: "三根 K 棒形成缺口", date: third.time, status: "met",
      evidence: bullish ? `第一根高點 ${price(first.high)} < 第三根低點 ${price(third.low)}。` : `第一根低點 ${price(first.low)} > 第三根高點 ${price(third.high)}。` },
    { id: "inside", label: "最新收盤位於缺口內", date: latest.time, status: outcome(inside),
      evidence: `收盤 ${price(latest.close)}；條件 ${price(low)} ≤ 收盤 ≤ ${price(high)}。` },
    { id: "latest-touch", label: "最新日再次觸及未填補缺口", date: latest.time,
      status: formedToday || filledEarlier ? "not-applicable" : outcome(overlap),
      evidence: formedToday ? "第三根形成日，不判定再次觸及。" : filledEarlier ? `已於 ${fillBar!.time} 完全填補。`
        : `最新低點 ${price(latest.low)}、高點 ${price(latest.high)}；條件：低點 ≤ ${price(high)} 且高點 ≥ ${price(low)}。` },
    { id: "filled", label: "形成後已完全填補", date: latest.time, status: outcome(Boolean(fillBar)),
      evidence: `形成後${bullish ? "最低價" : "最高價"} ${subsequent.length ? price(extreme) : "尚無後續日 K"}；完全填補條件：${bullish ? `低點 ≤ ${price(low)}` : `高點 ≥ ${price(high)}`}。累計 ${fillPct.toFixed(2)}%，不以四捨五入後百分比判定。` },
  ];
  return result;
}
