import type { OHLCBar } from "./macd";
import type { RvolAnalysis } from "./rvol";

export type RvolCheckStatus = "met" | "not-met" | "not-applicable" | "unavailable";
export interface RvolCheck {
  id: string;
  label: string;
  date: string;
  status: RvolCheckStatus;
  evidence: string;
}
export interface RvolReview {
  summary: string[];
  checks: RvolCheck[];
}

const price = (value: number) => `$${value.toFixed(2)}`;
const validVolume = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;
const volume = (value: number | null) => validVolume(value) ? `${value.toFixed(2)}×` : "資料不足";
const outcome = (met: boolean): RvolCheckStatus => met ? "met" : "not-met";

/** Factual downstream comparisons, using the same completed-session snapshot as analyzeRvol.
 * Does not change setup lifecycle, thresholds or signals. No current-clock or future-bar access.
 */
export function buildRvolReview(analysis: RvolAnalysis, bars: OHLCBar[]): RvolReview {
  const latest = bars.at(-1);
  if (!latest) return { summary: ["已完成日 K 資料不足，無法逐項比對。"], checks: [] };
  if (analysis.asOf !== latest.time) {
    return { summary: ["分析日期與日 K 不一致，暫不產生摘要。"], checks: [] };
  }
  if (![latest.low, latest.high, latest.close].every(Number.isFinite) || latest.low <= 0 ||
    latest.close < latest.low || latest.close > latest.high) {
    return { summary: ["最新日價格資料不足或無效，無法逐項比對。"], checks: [] };
  }
  const summary = [`截至 ${latest.time}（已完成日 K），收盤 ${price(latest.close)}，最新日 RVOL ${volume(analysis.rvol)}。`];
  const { setup } = analysis;
  if (!setup) {
    summary.push(bars.length < 21 || !validVolume(analysis.rvol)
      ? "資料不足，無法完整判斷量價條件。" : "目前沒有保留中的突破紀錄，不產生回踩條件結論。");
    return { summary, checks: [] };
  }
  const start = bars.findIndex(bar => bar.time === setup.breakoutDate);
  const event = bars.findIndex(bar => bar.time === setup.eventDate);
  if (start < 0 || event < start || bars.length - 1 - start !== setup.age ||
    !Number.isFinite(setup.level) || setup.level <= 0 || !Number.isFinite(setup.tolerance) || setup.tolerance < 0) {
    return { summary: ["突破／事件紀錄與日 K 不一致，暫不產生摘要。"], checks: [] };
  }

  const ended = setup.status === "invalidated" || setup.status === "expired";
  const eligible = !ended && setup.age > 0 && setup.age <= 10;
  const lower = setup.level - setup.tolerance;
  const upper = setup.level + setup.tolerance;
  const held = latest.close >= setup.level;
  const ordinary = held && latest.low >= lower && latest.low <= upper;
  const reclaimed = held && latest.low < lower;
  const distance = (latest.close / setup.level - 1) * 100;
  const ineligibleReason = ended ? `已結束：${setup.label}，不再確認原形態的回踩事件。` : "突破當日，不判定突破後回踩。";
  const tracking = ended ? `已結束：${setup.label}（${setup.eventDate}）。`
    : `突破後第 ${setup.age} 根日 K，剩餘 ${Math.max(0, 10 - setup.age)} 根觀察期；超過 10 根結束觀察。`;
  const checks: RvolCheck[] = [
    { id: "close-position", label: "最新收盤 ≥ 原突破位", date: latest.time, status: outcome(held),
      evidence: `收盤 ${price(latest.close)} ${held ? "≥" : "<"} 原突破位 ${price(setup.level)}；距原突破位 ${distance >= 0 ? "+" : ""}${distance.toFixed(2)}%。` },
    { id: "breakout-volume", label: "突破日放量（RVOL ≥ 1.5）", date: setup.breakoutDate,
      status: validVolume(setup.breakoutRvol) ? outcome(setup.breakoutRvol >= 1.5) : "unavailable",
      evidence: `突破日 RVOL ${volume(setup.breakoutRvol)}；比較門檻 ≥ 1.5×，使用突破日之前 20 根均量。` },
    { id: "tracking", label: "原形態仍在觀察期", date: latest.time, status: outcome(!ended && setup.age <= 10), evidence: tracking },
    { id: "retest-price", label: "最新日一般回踩價格條件", date: latest.time,
      status: eligible ? outcome(ordinary) : "not-applicable",
      evidence: eligible ? `實際最低價 ${price(latest.low)}、收盤 ${price(latest.close)}；條件：${price(lower)} ≤ 最低價 ≤ ${price(upper)}，且收盤 ≥ ${price(setup.level)}。` : ineligibleReason },
    { id: "reclaimed-price", label: "最新日跌破後收復價格條件", date: latest.time,
      status: eligible ? outcome(reclaimed) : "not-applicable",
      evidence: eligible ? `實際最低價 ${price(latest.low)}、收盤 ${price(latest.close)}；條件：最低價 < ${price(lower)}，且收盤 ≥ ${price(setup.level)}。` : ineligibleReason },
    { id: "retest-volume", label: "最新日一般回踩縮量（RVOL < 0.7）", date: latest.time,
      status: !eligible || !ordinary ? "not-applicable" : validVolume(analysis.rvol) ? outcome(analysis.rvol < 0.7) : "unavailable",
      evidence: !eligible ? ineligibleReason : !ordinary ? "最新日一般回踩價格條件未成立，不將最新日量能稱為一般回踩量能。"
        : `最新日 RVOL ${volume(analysis.rvol)}；比較門檻 < 0.7×，使用該日之前 20 根均量。` },
  ];

  summary.push(checks[0].evidence);
  summary.push(`原突破 ${setup.breakoutDate}，突破位 ${price(setup.level)}，突破日 RVOL ${volume(setup.breakoutRvol)}。`);
  // Waiting keeps the breakout date in the detector; it is not a separately dated retest event.
  if (setup.status !== "breakout" && setup.status !== "waiting") {
    summary.push(`最近紀錄 ${setup.eventDate}：${setup.label}，事件日 RVOL ${volume(setup.eventRvol)}。`);
  }
  summary.push(tracking);
  if (!eligible) summary.push(ineligibleReason);
  else if (ordinary || reclaimed) {
    const condition = ordinary ? "一般回踩價格條件成立" : "跌破後收復價格條件成立";
    summary.push(!validVolume(analysis.rvol)
      ? `${latest.time}：${condition}；量能資料不足，無法確認回踩事件。`
      : ordinary ? `${latest.time}：${condition}，縮量條件${analysis.rvol < 0.7 ? "成立" : "未成立"}（RVOL ${volume(analysis.rvol)}，門檻 < 0.7×）。`
        : `${latest.time}：${condition}，RVOL ${volume(analysis.rvol)}；不歸類為一般縮量回踩。`);
  } else {
    summary.push(`${latest.time}：未觸及回踩上界 ${price(upper)}（最低價 ${price(latest.low)}），沒有最新日回踩事件。`);
  }
  return { summary, checks };
}
