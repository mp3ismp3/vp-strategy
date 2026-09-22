import type { OHLCBar } from "./macd";
import { type IndicatorReview, reviewPrice as price, reviewOutcome as outcome, validReviewBars } from "./indicator-review";

interface SweepRecord {
  index: number;
  time: string;
  direction: "bullish" | "bearish";
  level: { price: number; type: "high" | "low"; source: string; startTime: string; startIndex: number; confirmedIndex?: number; confirmedTime?: string };
  wickExtreme: number;
  closePrice: number;
}

/** Audit the existing historical detector's price/volume conditions, not realtime availability. */
export function buildSweepReview(event: SweepRecord | null, bars: OHLCBar[]): IndicatorReview {
  const result: IndicatorReview = { title: "Sweep", summary: [], checks: [] };
  if (!validReviewBars(bars)) {
    result.summary = ["日 K 資料不足或無效，無法分析 Sweep。"];
    return result;
  }
  const latest = bars.at(-1)!;
  if (!event) {
    result.summary = [bars.length < 30 ? "資料不足：目前 Sweep 水平偵測至少需要 30 根日 K。"
      : `截至 ${latest.time}，目前篩選範圍沒有 Sweep 事件；不代表所有水平都沒有穿越。`];
    return result;
  }
  const bar = bars[event.index];
  const lowSide = event.level.type === "low";
  const level = event.level.price;
  if (!bar || bar.time !== event.time || bars[event.level.startIndex]?.time !== event.level.startTime ||
    event.level.startIndex >= event.index || !Number.isFinite(level) || level <= 0 ||
    bar.close !== event.closePrice || (lowSide ? bar.low : bar.high) !== event.wickExtreme ||
    (lowSide ? "bullish" : "bearish") !== event.direction) {
    result.summary = ["事件日期、價位或水平來源與日 K 不一致，暫不產生比對。"];
    return result;
  }
  const extreme = lowSide ? bar.low : bar.high;
  const crossed = lowSide ? extreme < level : extreme > level;
  const closedBack = lowSide ? bar.close > level : bar.close < level;
  const penetration = (lowSide ? level - extreme : extreme - level) / level;
  const range = bar.high - bar.low;
  const strength = range > 0 ? (lowSide ? bar.close - bar.low : bar.high - bar.close) / range : null;
  const volumes = bars.slice(Math.max(0, event.index - 19), event.index + 1).map(item => item.volume);
  let ratio: number | null = null;
  if (volumes.length === 20 && volumes.every(value => Number.isFinite(value) && value >= 0)) {
    const sorted = [...volumes].sort((a, b) => a - b);
    const median = (sorted[9] + sorted[10]) / 2;
    if (median > 0) ratio = bar.volume / median;
  }
  const later = latest.time !== event.time;
  const sameSide = lowSide ? latest.close > level : latest.close < level;
  const distance = (latest.close / level - 1) * 100;
  result.title = `${event.time} ${event.level.source} ${price(level)} ${event.direction === "bullish" ? "Bullish" : "Bearish"} Sweep`;
  const confirmedIndex = event.level.confirmedIndex;
  const confirmationValid = confirmedIndex !== undefined && Number.isInteger(confirmedIndex) &&
    confirmedIndex >= event.level.startIndex && confirmedIndex < event.index &&
    bars[confirmedIndex]?.time === event.level.confirmedTime;
  const confirmationStatus = confirmedIndex === undefined || event.level.confirmedTime === undefined
    ? "unavailable" as const : confirmationValid ? "met" as const : "not-met" as const;
  result.summary = [
    `歷史回看事件 ${event.time}：${event.level.source} 水平 ${price(level)}，來源日期 ${event.level.startTime}。`,
    `事件日${lowSide ? "最低" : "最高"}價 ${price(extreme)}，穿越幅度 ${(penetration * 100).toFixed(2)}%；收盤 ${price(bar.close)}，${closedBack ? "已" : "未"}回到水平內側。`,
    `事件日量比 ${ratio === null ? "資料不足" : `${ratio.toFixed(2)}×`}；分母為含事件日的 20 根成交量中位數，並非 RVOL 的前 20 根均量。`,
    `截至 ${latest.time}（已完成日 K），收盤 ${price(latest.close)}，距該水平 ${distance >= 0 ? "+" : ""}${distance.toFixed(2)}%。${later ? `最新收盤${sameSide ? "仍在" : "未在"}事件收回側；不代表期間每根收盤都守住。` : "目前是事件當日，尚無後續日 K。"}`,
    `水平當時是否已確認：${confirmationStatus === "met" ? `已確認（${event.level.confirmedTime}）` : confirmationStatus === "not-met" ? "紀錄確認時間無效或晚於事件" : "資料不足"}。${confirmationStatus === "met" ? `水平確認日 ${event.level.confirmedTime}。` : ""}歷史回看不等於事件當時可即時得知。`,
  ];
  result.guidance = [
    `後續觀察條件：高點 Sweep 需收盤維持 ${price(level)} 下方；低點 Sweep 需收盤維持 ${price(level)} 上方。`,
    `事件日極值 ${price(extreme)} 是已發生的穿越，不是進場價；事件後若重新收復水平，應以新的日 K 結構另行確認。`,
  ];
  result.checks = [
    { id: "wick", label: "事件日極值穿越水平", date: event.time, status: outcome(crossed),
      evidence: `極值 ${price(extreme)}；條件：${lowSide ? "低點 <" : "高點 >"} ${price(level)}。` },
    { id: "close-back", label: "事件日收盤回到水平內側", date: event.time, status: outcome(closedBack),
      evidence: `收盤 ${price(bar.close)}；條件：收盤 ${lowSide ? ">" : "<"} ${price(level)}（等於不成立）。` },
    { id: "penetration", label: "穿越幅度介於 0.05%–3%", date: event.time, status: outcome(penetration >= 0.0005 && penetration <= 0.03),
      evidence: `幅度 ${(penetration * 100).toFixed(2)}%；以穿越價差 ÷ 水平價格計算，兩端包含。` },
    { id: "close-strength", label: "收盤離掃蕩極值的距離占日 K 振幅 ≥ 30%", date: event.time,
      status: strength === null ? "unavailable" : outcome(strength >= 0.3),
      evidence: strength === null ? "日 K 高低差為零，無法計算。" : `${lowSide ? "（收盤 − 低點）" : "（高點 − 收盤）"} ÷（高點 − 低點）= ${(strength * 100).toFixed(2)}%。` },
    { id: "volume", label: "事件日量比 ≥ 1", date: event.time, status: ratio === null ? "unavailable" : outcome(ratio >= 1),
      evidence: ratio === null ? "需含事件日的 20 根有效成交量，且中位數 > 0；不足時不採用早期 K 棒的替代量比。"
        : `量比 ${ratio.toFixed(2)}×；中位數區間 ${bars[event.index - 19].time} ～ ${event.time}（含事件日）。` },
    { id: "availability", label: "事件當時水平已確認", date: event.time, status: confirmationStatus,
      evidence: confirmationStatus === "met" ? `確認 K 棒 ${event.level.confirmedTime}，早於事件日。`
        : confirmationStatus === "not-met" ? "確認 K 棒不得早於水平來源，且必須早於事件日並與日 K 日期一致。"
        : "既有紀錄缺少水平確認時間，無法判定事件當時是否可取得。" },
    { id: "latest-side", label: "最新收盤位於事件收回側", date: latest.time, status: later ? outcome(sameSide) : "not-applicable",
      evidence: later ? `最新收盤 ${price(latest.close)}；條件：收盤 ${lowSide ? ">" : "<"} ${price(level)}。這是最新日比對，不是新 Sweep。` : "尚無事件後的已完成日 K。" },
  ];
  return result;
}
