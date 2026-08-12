"use client";

import { useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import type { Annotations, Data, Layout, Shape } from "plotly.js";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { SignalMosaic } from "@/components/SignalMosaic";
import {
  getIndicatorCategories,
  isIndicatorTickerAllowed,
} from "@/lib/preview-access";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// ─── Types ───────────────────────────────────────────────────────────────────

interface OHLCBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface LiquidityLevel {
  price: number;
  type: "high" | "low";
  source: "EQH" | "EQL" | "PDH" | "PDL" | "PWH" | "PWL" | "Swing";
  startTime: string;
  startIndex: number;
  touches: number; // how many times tested
  swept: boolean;
  sweepIndex?: number;
  sweepTime?: string;
}

interface SweepEvent {
  index: number;
  time: string;
  direction: "bullish" | "bearish";
  level: LiquidityLevel;
  wickExtreme: number;
  closePrice: number;
  volumeRatio: number;
}

// ─── Algo: ATR Calculation ───────────────────────────────────────────────────

function calcATR(ohlc: OHLCBar[], period: number = 14): number {
  if (ohlc.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < ohlc.length; i++) {
    const tr = Math.max(
      ohlc[i].high - ohlc[i].low,
      Math.abs(ohlc[i].high - ohlc[i - 1].close),
      Math.abs(ohlc[i].low - ohlc[i - 1].close)
    );
    trs.push(tr);
  }
  const recent = trs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

// ─── Algo: Significant Swing Points (ATR-filtered) ───────────────────────────

function detectSignificantSwings(
  ohlc: OHLCBar[],
  lookback: number = 10,
  minAtrMultiple: number = 1.0
): { highs: { index: number; price: number }[]; lows: { index: number; price: number }[] } {
  const atr = calcATR(ohlc, 14);
  const minSwingSize = atr * minAtrMultiple;

  const highs: { index: number; price: number }[] = [];
  const lows: { index: number; price: number }[] = [];

  for (let i = lookback; i < ohlc.length - lookback; i++) {
    // Swing High check
    let isHigh = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (ohlc[j].high >= ohlc[i].high) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) {
      // Check significance: swing must be at least 1 ATR above surrounding lows
      const surroundingLows = ohlc.slice(Math.max(0, i - lookback), i + lookback + 1).map(b => b.low);
      const minLow = Math.min(...surroundingLows);
      if (ohlc[i].high - minLow >= minSwingSize) {
        highs.push({ index: i, price: ohlc[i].high });
      }
    }

    // Swing Low check
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (ohlc[j].low <= ohlc[i].low) {
        isLow = false;
        break;
      }
    }
    if (isLow) {
      const surroundingHighs = ohlc.slice(Math.max(0, i - lookback), i + lookback + 1).map(b => b.high);
      const maxHigh = Math.max(...surroundingHighs);
      if (maxHigh - ohlc[i].low >= minSwingSize) {
        lows.push({ index: i, price: ohlc[i].low });
      }
    }
  }

  return { highs, lows };
}

// ─── Algo: Equal Highs / Equal Lows Detection ───────────────────────────────

function detectEqualLevels(
  swingHighs: { index: number; price: number }[],
  swingLows: { index: number; price: number }[],
  tolerancePct: number = 0.003
): { eqHighs: { price: number; indices: number[] }[]; eqLows: { price: number; indices: number[] }[] } {
  const eqHighs: { price: number; indices: number[] }[] = [];
  const eqLows: { price: number; indices: number[] }[] = [];

  // Find equal highs (two or more swing highs within tolerance)
  const usedH = new Set<number>();
  for (let i = 0; i < swingHighs.length; i++) {
    if (usedH.has(i)) continue;
    const cluster = [swingHighs[i]];
    for (let j = i + 1; j < swingHighs.length; j++) {
      if (usedH.has(j)) continue;
      const diff = Math.abs(swingHighs[j].price - swingHighs[i].price) / swingHighs[i].price;
      if (diff <= tolerancePct) {
        cluster.push(swingHighs[j]);
        usedH.add(j);
      }
    }
    if (cluster.length >= 2) {
      usedH.add(i);
      const avgPrice = cluster.reduce((sum, c) => sum + c.price, 0) / cluster.length;
      eqHighs.push({ price: avgPrice, indices: cluster.map(c => c.index) });
    }
  }

  // Find equal lows
  const usedL = new Set<number>();
  for (let i = 0; i < swingLows.length; i++) {
    if (usedL.has(i)) continue;
    const cluster = [swingLows[i]];
    for (let j = i + 1; j < swingLows.length; j++) {
      if (usedL.has(j)) continue;
      const diff = Math.abs(swingLows[j].price - swingLows[i].price) / swingLows[i].price;
      if (diff <= tolerancePct) {
        cluster.push(swingLows[j]);
        usedL.add(j);
      }
    }
    if (cluster.length >= 2) {
      usedL.add(i);
      const avgPrice = cluster.reduce((sum, c) => sum + c.price, 0) / cluster.length;
      eqLows.push({ price: avgPrice, indices: cluster.map(c => c.index) });
    }
  }

  return { eqHighs, eqLows };
}

// ─── Algo: PDH/PDL/PWH/PWL Detection ────────────────────────────────────────

function detectSessionLevels(ohlc: OHLCBar[]): {
  pdh: number | null; pdl: number | null;
  pwh: number | null; pwl: number | null;
  pdhIndex: number; pdlIndex: number;
  pwhIndex: number; pwlIndex: number;
} {
  const result = { pdh: null as number | null, pdl: null as number | null, pwh: null as number | null, pwl: null as number | null, pdhIndex: 0, pdlIndex: 0, pwhIndex: 0, pwlIndex: 0 };
  if (ohlc.length < 10) return result;

  // Group bars by day
  const days: { bars: OHLCBar[]; startIdx: number }[] = [];
  let currentDay = "";
  for (let i = 0; i < ohlc.length; i++) {
    const day = ohlc[i].time.slice(0, 10);
    if (day !== currentDay) {
      days.push({ bars: [ohlc[i]], startIdx: i });
      currentDay = day;
    } else {
      days[days.length - 1].bars.push(ohlc[i]);
    }
  }

  // Previous Day High/Low (second to last day)
  if (days.length >= 2) {
    const prevDay = days[days.length - 2];
    const highs = prevDay.bars.map(b => b.high);
    const lows = prevDay.bars.map(b => b.low);
    result.pdh = Math.max(...highs);
    result.pdl = Math.min(...lows);
    result.pdhIndex = prevDay.startIdx + highs.indexOf(result.pdh);
    result.pdlIndex = prevDay.startIdx + lows.indexOf(result.pdl);
  }

  // Group bars by week (Monday = new week)
  const weeks: { bars: OHLCBar[]; startIdx: number }[] = [];
  let currentWeekStart = "";
  for (let i = 0; i < ohlc.length; i++) {
    const d = new Date(ohlc[i].time);
    // Get Monday of this week
    const dayOfWeek = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((dayOfWeek + 6) % 7));
    const weekKey = monday.toISOString().slice(0, 10);

    if (weekKey !== currentWeekStart) {
      weeks.push({ bars: [ohlc[i]], startIdx: i });
      currentWeekStart = weekKey;
    } else {
      weeks[weeks.length - 1].bars.push(ohlc[i]);
    }
  }

  // Previous Week High/Low
  if (weeks.length >= 2) {
    const prevWeek = weeks[weeks.length - 2];
    const highs = prevWeek.bars.map(b => b.high);
    const lows = prevWeek.bars.map(b => b.low);
    result.pwh = Math.max(...highs);
    result.pwl = Math.min(...lows);
    result.pwhIndex = prevWeek.startIdx + highs.indexOf(result.pwh);
    result.pwlIndex = prevWeek.startIdx + lows.indexOf(result.pwl);
  }

  return result;
}

// ─── Algo: Build Liquidity Levels ────────────────────────────────────────────

function buildLiquidityLevels(ohlc: OHLCBar[]): LiquidityLevel[] {
  if (ohlc.length < 30) return [];

  const levels: LiquidityLevel[] = [];

  // 1. Detect significant swings
  const { highs, lows } = detectSignificantSwings(ohlc, 10, 1.0);

  // 2. Detect Equal Highs / Equal Lows (highest priority)
  const { eqHighs, eqLows } = detectEqualLevels(highs, lows, 0.003);

  for (const eq of eqHighs) {
    const firstIdx = Math.min(...eq.indices);
    levels.push({
      price: Math.round(eq.price * 100) / 100,
      type: "high",
      source: "EQH",
      startTime: ohlc[firstIdx].time,
      startIndex: firstIdx,
      touches: eq.indices.length,
      swept: false,
    });
  }

  for (const eq of eqLows) {
    const firstIdx = Math.min(...eq.indices);
    levels.push({
      price: Math.round(eq.price * 100) / 100,
      type: "low",
      source: "EQL",
      startTime: ohlc[firstIdx].time,
      startIndex: firstIdx,
      touches: eq.indices.length,
      swept: false,
    });
  }

  // 3. PDH/PDL/PWH/PWL
  const session = detectSessionLevels(ohlc);

  if (session.pdh !== null) {
    levels.push({
      price: Math.round(session.pdh * 100) / 100,
      type: "high",
      source: "PDH",
      startTime: ohlc[session.pdhIndex].time,
      startIndex: session.pdhIndex,
      touches: 1,
      swept: false,
    });
  }
  if (session.pdl !== null) {
    levels.push({
      price: Math.round(session.pdl * 100) / 100,
      type: "low",
      source: "PDL",
      startTime: ohlc[session.pdlIndex].time,
      startIndex: session.pdlIndex,
      touches: 1,
      swept: false,
    });
  }
  if (session.pwh !== null) {
    levels.push({
      price: Math.round(session.pwh * 100) / 100,
      type: "high",
      source: "PWH",
      startTime: ohlc[session.pwhIndex].time,
      startIndex: session.pwhIndex,
      touches: 1,
      swept: false,
    });
  }
  if (session.pwl !== null) {
    levels.push({
      price: Math.round(session.pwl * 100) / 100,
      type: "low",
      source: "PWL",
      startTime: ohlc[session.pwlIndex].time,
      startIndex: session.pwlIndex,
      touches: 1,
      swept: false,
    });
  }

  // 4. Remaining significant swings (not already part of EQH/EQL)
  const eqHighPrices = new Set(eqHighs.flatMap(e => e.indices));
  const eqLowPrices = new Set(eqLows.flatMap(e => e.indices));

  for (const h of highs) {
    if (eqHighPrices.has(h.index)) continue;
    // Skip if too close to PDH or PWH
    if (session.pdh && Math.abs(h.price - session.pdh) / session.pdh < 0.003) continue;
    if (session.pwh && Math.abs(h.price - session.pwh) / session.pwh < 0.003) continue;
    levels.push({
      price: Math.round(h.price * 100) / 100,
      type: "high",
      source: "Swing",
      startTime: ohlc[h.index].time,
      startIndex: h.index,
      touches: 1,
      swept: false,
    });
  }

  for (const l of lows) {
    if (eqLowPrices.has(l.index)) continue;
    if (session.pdl && Math.abs(l.price - session.pdl) / session.pdl < 0.003) continue;
    if (session.pwl && Math.abs(l.price - session.pwl) / session.pwl < 0.003) continue;
    levels.push({
      price: Math.round(l.price * 100) / 100,
      type: "low",
      source: "Swing",
      startTime: ohlc[l.index].time,
      startIndex: l.index,
      touches: 1,
      swept: false,
    });
  }

  return levels;
}

// ─── Algo: Sweep Detection on Liquidity Levels ───────────────────────────────

function detectSweeps(ohlc: OHLCBar[], levels: LiquidityLevel[]): SweepEvent[] {
  const sweeps: SweepEvent[] = [];
  if (ohlc.length < 20 || levels.length === 0) return sweeps;

  // Volume median for each bar
  const volMedian = ohlc.map((_, i) => {
    if (i < 19) return ohlc[i].volume;
    const window = ohlc.slice(i - 19, i + 1).map((b) => b.volume);
    const sorted = [...window].sort((a, b) => a - b);
    return (sorted[9] + sorted[10]) / 2;
  });

  for (const level of levels) {
    // Only check bars after the level was established
    const startCheck = level.startIndex + 3;

    for (let i = Math.max(startCheck, 10); i < ohlc.length; i++) {
      const bar = ohlc[i];
      const barRange = bar.high - bar.low;
      if (barRange === 0) continue;

      const vRatio = bar.volume / volMedian[i];

      if (level.type === "high") {
        // Bearish sweep: wick above level, close below
        if (bar.high > level.price && bar.close < level.price) {
          const penetration = (bar.high - level.price) / level.price;
          if (penetration < 0.0005 || penetration > 0.03) continue;
          if (vRatio < 1.0) continue;

          // Close should be in lower portion (rejection)
          const closeStrength = (bar.high - bar.close) / barRange;
          if (closeStrength < 0.3) continue;

          // Avoid duplicates on same level
          if (level.swept) continue;

          level.swept = true;
          level.sweepIndex = i;
          level.sweepTime = bar.time;

          sweeps.push({
            index: i,
            time: bar.time,
            direction: "bearish",
            level,
            wickExtreme: bar.high,
            closePrice: bar.close,
            volumeRatio: vRatio,
          });
          break; // one sweep per level
        }
      } else {
        // Bullish sweep: wick below level, close above
        if (bar.low < level.price && bar.close > level.price) {
          const penetration = (level.price - bar.low) / level.price;
          if (penetration < 0.0005 || penetration > 0.03) continue;
          if (vRatio < 1.0) continue;

          const closeStrength = (bar.close - bar.low) / barRange;
          if (closeStrength < 0.3) continue;

          if (level.swept) continue;

          level.swept = true;
          level.sweepIndex = i;
          level.sweepTime = bar.time;

          sweeps.push({
            index: i,
            time: bar.time,
            direction: "bullish",
            level,
            wickExtreme: bar.low,
            closePrice: bar.close,
            volumeRatio: vRatio,
          });
          break;
        }
      }
    }
  }

  // Sort by index (chronological)
  sweeps.sort((a, b) => a.index - b.index);
  return sweeps;
}

// ─── Source Colors ───────────────────────────────────────────────────────────

const SOURCE_COLORS: Record<string, { line: string; bg: string; label: string }> = {
  EQH: { line: "#e91e63", bg: "rgba(233,30,99,0.1)", label: "Equal High" },
  EQL: { line: "#9c27b0", bg: "rgba(156,39,176,0.1)", label: "Equal Low" },
  PDH: { line: "#ff9800", bg: "rgba(255,152,0,0.1)", label: "Prev Day High" },
  PDL: { line: "#ff9800", bg: "rgba(255,152,0,0.1)", label: "Prev Day Low" },
  PWH: { line: "#2196f3", bg: "rgba(33,150,243,0.1)", label: "Prev Week High" },
  PWL: { line: "#2196f3", bg: "rgba(33,150,243,0.1)", label: "Prev Week Low" },
  Swing: { line: "#78909c", bg: "rgba(120,144,156,0.1)", label: "Swing" },
};

// ─── Main Component ──────────────────────────────────────────────────────────

type SourceFilter = "EQH" | "EQL" | "PDH" | "PDL" | "PWH" | "PWL" | "Swing";

export default function LiquidityPage() {
  const { data: session } = useSession();
  const accessPlan = (session?.user as { plan?: "free" | "pro" | "premium" } | undefined)?.plan ?? "free";
  const isPaid = accessPlan === "pro" || accessPlan === "premium";
  const [selectedTicker, setSelectedTicker] = useState("NVDA");
  const [ohlc, setOhlc] = useState<OHLCBar[]>([]);
  const [loadedTicker, setLoadedTicker] = useState<string | null>(null);
  const [enabledSources, setEnabledSources] = useState<Set<SourceFilter>>(
    new Set(["EQH", "EQL", "PDH", "PDL", "PWH", "PWL", "Swing"])
  );
  const [showSwept, setShowSwept] = useState(true);
  const indicatorCategories = useMemo(
    () => getIndicatorCategories(accessPlan),
    [accessPlan]
  );
  const effectiveTicker = isIndicatorTickerAllowed(selectedTicker, accessPlan)
    ? selectedTicker
    : "NVDA";
  const loading = loadedTicker !== effectiveTicker;

  // Fetch OHLC through the server-side entitlement boundary.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/data/chart-data?ticker=${encodeURIComponent(effectiveTicker)}`)
      .then(async (response) => response.ok ? response.json() : Promise.reject())
      .then((chart) => {
        if (!cancelled) setOhlc(chart?.daily?.ohlc || []);
      })
      .catch(() => {
        if (!cancelled) setOhlc([]);
      })
      .finally(() => {
        if (!cancelled) setLoadedTicker(effectiveTicker);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveTicker]);

  // Compute liquidity levels and sweeps
  const levels = useMemo(() => buildLiquidityLevels(ohlc), [ohlc]);
  const sweeps = useMemo(() => detectSweeps(ohlc, levels), [ohlc, levels]);

  // Filter levels by enabled sources
  const visibleLevels = useMemo(
    () => levels.filter((l) => enabledSources.has(l.source) && (showSwept || !l.swept)),
    [levels, enabledSources, showSwept]
  );

  const visibleSweeps = useMemo(
    () => sweeps.filter((s) => enabledSources.has(s.level.source)),
    [sweeps, enabledSources]
  );

  const bullishSweeps = visibleSweeps.filter((s) => s.direction === "bullish");
  const bearishSweeps = visibleSweeps.filter((s) => s.direction === "bearish");

  // Count by source
  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of levels) {
      counts[l.source] = (counts[l.source] || 0) + 1;
    }
    return counts;
  }, [levels]);

  const toggleSource = (source: SourceFilter) => {
    setEnabledSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <div>
          <h1 className="text-3xl font-bold">Liquidity Sweep</h1>
          <p className="text-gray-600 mt-1">
            專業級流動性掃蕩偵測 — Equal Highs/Lows、PDH/PDL/PWH/PWL、顯著 Swing
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl border p-4 mb-6 space-y-3">
        {/* Row 1: Ticker + Stats */}
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">標的：</label>
            <select
              value={effectiveTicker}
              onChange={(e) => setSelectedTicker(e.target.value)}
              className="border rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {Object.entries(indicatorCategories).map(([category, tickers]) => (
                <optgroup key={category} label={category}>
                  {tickers.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showSwept}
              onChange={(e) => setShowSwept(e.target.checked)}
              className="rounded border-gray-300"
            />
            顯示已掃蕩
          </label>

          <div className="flex items-center gap-3 ml-auto">
            <Badge className="bg-green-100 text-green-800">
              Bullish: {bullishSweeps.length}
            </Badge>
            <Badge className="bg-red-100 text-red-800">
              Bearish: {bearishSweeps.length}
            </Badge>
          </div>
        </div>

        {/* Row 2: Source Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm font-medium text-gray-700 mr-1">流動性來源：</span>
          {(["EQH", "EQL", "PDH", "PDL", "PWH", "PWL", "Swing"] as SourceFilter[]).map((src) => (
            <button
              key={src}
              onClick={() => toggleSource(src)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                enabledSources.has(src)
                  ? "text-white border-transparent"
                  : "bg-white text-gray-400 border-gray-200"
              }`}
              style={
                enabledSources.has(src)
                  ? { backgroundColor: SOURCE_COLORS[src].line }
                  : undefined
              }
            >
              {src} {levelCounts[src] ? `(${levelCounts[src]})` : ""}
            </button>
          ))}
        </div>
      </div>

      {/* Chart remains visible in the guest preview. */}
      <div className="bg-white rounded-xl border p-4 mb-6">
        {loading ? (
          <div className="flex items-center justify-center h-[600px]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
          </div>
        ) : ohlc.length === 0 ? (
          <div className="flex items-center justify-center h-[600px] text-gray-500">
            無 {effectiveTicker} 圖表數據。請先執行 export_frontend_data.py
          </div>
        ) : (
          <LiquidityChart
            ticker={effectiveTicker}
            ohlc={ohlc}
            levels={visibleLevels}
            sweeps={visibleSweeps}
          />
        )}
      </div>

      {/* Signal details */}
      <SignalMosaic locked={!isPaid}>
        {/* Liquidity Levels Table */}
        {visibleLevels.length > 0 && (
        <div className="bg-white rounded-xl border p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">流動性水平一覽</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-3">來源</th>
                  <th className="text-left p-3">方向</th>
                  <th className="text-left p-3">價位</th>
                  <th className="text-left p-3">建立日期</th>
                  <th className="text-left p-3">觸碰次數</th>
                  <th className="text-left p-3">狀態</th>
                </tr>
              </thead>
              <tbody>
                {[...visibleLevels]
                  .sort((a, b) => b.price - a.price)
                  .map((level, i) => (
                  <tr key={i} className="border-b hover:bg-gray-50">
                    <td className="p-3">
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: SOURCE_COLORS[level.source].line }}
                      >
                        {level.source}
                      </span>
                    </td>
                    <td className="p-3">
                      {level.type === "high" ? (
                        <span className="text-red-600">上方流動性</span>
                      ) : (
                        <span className="text-green-600">下方流動性</span>
                      )}
                    </td>
                    <td className="p-3 font-mono font-medium">${level.price.toFixed(2)}</td>
                    <td className="p-3 font-mono text-gray-600">{level.startTime}</td>
                    <td className="p-3">
                      {level.touches >= 2 ? (
                        <span className="font-bold text-orange-600">{level.touches}x</span>
                      ) : (
                        <span className="text-gray-400">{level.touches}x</span>
                      )}
                    </td>
                    <td className="p-3">
                      {level.swept ? (
                        <Badge className="bg-gray-100 text-gray-500">已掃蕩 ({level.sweepTime})</Badge>
                      ) : (
                        <Badge className="bg-blue-100 text-blue-700 font-medium">有效</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}

      {/* Sweep Events Table */}
        {visibleSweeps.length > 0 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-xl font-bold mb-4">Sweep 事件</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-3">日期</th>
                  <th className="text-left p-3">方向</th>
                  <th className="text-left p-3">掃蕩的水平</th>
                  <th className="text-left p-3">來源</th>
                  <th className="text-left p-3">Wick 極值</th>
                  <th className="text-left p-3">收盤</th>
                  <th className="text-left p-3">量比</th>
                </tr>
              </thead>
              <tbody>
                {[...visibleSweeps].reverse().map((s, i) => (
                  <tr key={i} className="border-b hover:bg-gray-50">
                    <td className="p-3 font-mono">{s.time}</td>
                    <td className="p-3">
                      {s.direction === "bullish" ? (
                        <Badge className="bg-green-100 text-green-800">Bullish</Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800">Bearish</Badge>
                      )}
                    </td>
                    <td className="p-3 font-mono">${s.level.price.toFixed(2)}</td>
                    <td className="p-3">
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: SOURCE_COLORS[s.level.source].line }}
                      >
                        {s.level.source}
                      </span>
                    </td>
                    <td className="p-3 font-mono">${s.wickExtreme.toFixed(2)}</td>
                    <td className="p-3 font-mono">${s.closePrice.toFixed(2)}</td>
                    <td className="p-3">
                      <span className={s.volumeRatio >= 1.5 ? "text-green-700 font-bold" : "text-gray-600"}>
                        {s.volumeRatio.toFixed(2)}x
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </SignalMosaic>
    </div>
  );
}

// ─── Chart Component ─────────────────────────────────────────────────────────

interface LiquidityChartProps {
  ticker: string;
  ohlc: OHLCBar[];
  levels: LiquidityLevel[];
  sweeps: SweepEvent[];
}

function LiquidityChart({ ticker, ohlc, levels, sweeps }: LiquidityChartProps) {
  const times = ohlc.map((b) => b.time);

  // Candlestick
  const candlestick: Data = {
    type: "candlestick",
    x: times,
    open: ohlc.map((b) => b.open),
    high: ohlc.map((b) => b.high),
    low: ohlc.map((b) => b.low),
    close: ohlc.map((b) => b.close),
    increasing: { line: { color: "#26a69a" } },
    decreasing: { line: { color: "#ef5350" } },
    name: "Price",
    xaxis: "x",
    yaxis: "y",
  };

  // Volume subplot
  const volColors = ohlc.map((bar, i) =>
    i === 0 ? "#26a69a" : bar.close >= ohlc[i - 1].close ? "#26a69a" : "#ef5350"
  );
  const volTrace: Data = {
    type: "bar",
    x: times,
    y: ohlc.map((b) => b.volume),
    marker: { color: volColors },
    name: "Volume",
    opacity: 0.5,
    xaxis: "x2",
    yaxis: "y2",
    showlegend: false,
  };

  // Shapes: horizontal lines for liquidity levels
  const shapes: Partial<Shape>[] = levels.map((level) => {
    const endIdx = level.swept && level.sweepIndex !== undefined
      ? Math.min(level.sweepIndex, ohlc.length - 1)
      : ohlc.length - 1;

    const color = SOURCE_COLORS[level.source]?.line || "#999";

    return {
      type: "line",
      xref: "x",
      yref: "y",
      x0: ohlc[level.startIndex].time,
      x1: ohlc[endIdx].time,
      y0: level.price,
      y1: level.price,
      line: {
        color: level.swept ? color + "66" : color,
        width: level.source === "EQH" || level.source === "EQL" ? 2.5 : 1.5,
        dash: level.swept ? "dot" : "solid",
      },
    };
  });

  // Annotations for level labels
  const annotations: Partial<Annotations>[] = levels.map((level) => {
    const color = SOURCE_COLORS[level.source]?.line || "#999";
    return {
      x: ohlc[level.startIndex].time,
      y: level.price,
      xref: "x",
      yref: "y",
      text: `${level.source} $${level.price.toFixed(1)}${level.touches >= 2 ? ` (${level.touches}x)` : ""}`,
      showarrow: false,
      font: { size: 9, color: level.swept ? "#999" : color },
      xanchor: "left",
      yshift: level.type === "high" ? 10 : -10,
    };
  });

  // Sweep markers
  const bullSweeps = sweeps.filter((s) => s.direction === "bullish");
  const bearSweeps = sweeps.filter((s) => s.direction === "bearish");

  const bullSweepTrace: Data = {
    type: "scatter",
    x: bullSweeps.map((s) => s.time),
    y: bullSweeps.map((s) => s.wickExtreme),
    mode: "text+markers",
    marker: { symbol: "star", size: 14, color: "#4caf50", line: { width: 1, color: "#1b5e20" } },
    text: bullSweeps.map((s) => `SWEEP ${s.level.source}`),
    textposition: "bottom center",
    textfont: { size: 9, color: "#4caf50" },
    name: "Bullish Sweep",
    hovertemplate: "Bullish Sweep<br>Level: %{customdata[0]}<br>$%{customdata[1]:.2f}<br>Vol: %{customdata[2]:.1f}x<extra></extra>",
    customdata: bullSweeps.map((s) => [s.level.source, s.level.price, s.volumeRatio]),
    xaxis: "x",
    yaxis: "y",
  };

  const bearSweepTrace: Data = {
    type: "scatter",
    x: bearSweeps.map((s) => s.time),
    y: bearSweeps.map((s) => s.wickExtreme),
    mode: "text+markers",
    marker: { symbol: "star", size: 14, color: "#f44336", line: { width: 1, color: "#b71c1c" } },
    text: bearSweeps.map((s) => `SWEEP ${s.level.source}`),
    textposition: "top center",
    textfont: { size: 9, color: "#f44336" },
    name: "Bearish Sweep",
    hovertemplate: "Bearish Sweep<br>Level: %{customdata[0]}<br>$%{customdata[1]:.2f}<br>Vol: %{customdata[2]:.1f}x<extra></extra>",
    customdata: bearSweeps.map((s) => [s.level.source, s.level.price, s.volumeRatio]),
    xaxis: "x",
    yaxis: "y",
  };

  const layout: Partial<Layout> = {
    height: 650,
    margin: { l: 60, r: 20, t: 40, b: 30 },
    showlegend: true,
    legend: { x: 0, y: 1.12, orientation: "h", font: { size: 11 } },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    title: { text: `${ticker} — Liquidity Levels & Sweeps`, font: { size: 15 } },
    xaxis: {
      domain: [0, 1],
      anchor: "y",
      showticklabels: false,
      rangeslider: { visible: false },
      type: "category",
    },
    xaxis2: {
      domain: [0, 1],
      anchor: "y2",
      type: "category",
      tickangle: -45,
      nticks: 12,
    },
    yaxis: {
      domain: [0.25, 1],
      title: { text: "Price ($)" },
      showgrid: true,
      gridcolor: "rgba(0,0,0,0.04)",
    },
    yaxis2: {
      domain: [0, 0.2],
      title: { text: "Volume" },
      showgrid: true,
      gridcolor: "rgba(0,0,0,0.04)",
    },
    shapes,
    annotations,
  };

  return (
    <Plot
      data={[candlestick, bullSweepTrace, bearSweepTrace, volTrace]}
      layout={layout}
      config={{ displayModeBar: true, responsive: true }}
      style={{ width: "100%" }}
    />
  );
}
