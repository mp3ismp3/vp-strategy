"use client";

import { useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import type { Annotations, Data, Layout, Shape } from "plotly.js";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { SignalMosaic } from "@/components/SignalMosaic";
import { IndicatorFacts } from "@/components/IndicatorFacts";
import { LiquidityGuide } from "@/components/LiquidityGuide";
import { buildSweepReview } from "@/lib/sweep-review";
import { analyzeLiquidity, type LiquidityLevel, type SweepEvent } from "@/lib/liquidity";
import { validateLiquidityStrategy, type LiquidityEventAssessment } from "@/lib/liquidity-validation";
import { completedDailyBars } from "@/lib/market-bars";
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
  const [capturedAt, setCapturedAt] = useState<string | undefined>();
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
        if (!cancelled) {
          setOhlc(completedDailyBars(chart?.daily?.ohlc || [], chart?.daily?.captured_at));
          setCapturedAt(chart?.daily?.captured_at);
        }
      })
      .catch(() => {
        if (!cancelled) { setOhlc([]); setCapturedAt(undefined); }
      })
      .finally(() => {
        if (!cancelled) setLoadedTicker(effectiveTicker);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveTicker]);

  // Compute liquidity levels and sweeps
  const liquidity = useMemo(() => analyzeLiquidity(ohlc), [ohlc]);
  const levels = liquidity.levels;
  const sweeps = liquidity.sweeps;
  const validation = useMemo(() => validateLiquidityStrategy(ohlc, sweeps), [ohlc, sweeps]);

  // Filter levels by enabled sources
  const visibleLevels = useMemo(
    () => levels.filter((l) => enabledSources.has(l.source) && (showSwept || !l.swept)),
    [levels, enabledSources, showSwept]
  );

  const visibleSweeps = useMemo(
    () => sweeps.filter((s) => enabledSources.has(s.level.source)),
    [sweeps, enabledSources]
  );

  const visibleSignals = useMemo(
    () => validation.signals.filter((signal) => enabledSources.has(signal.level.source)),
    [validation.signals, enabledSources]
  );
  const assessmentByEvent = useMemo(() => new Map(
    validation.assessments.map(assessment => [assessment.event, assessment]),
  ), [validation.assessments]);
  const visiblePositiveSweeps = useMemo(() => visibleSweeps.filter(event => {
    const assessment = assessmentByEvent.get(event);
    return !assessment?.exclusion && assessment?.validity.status !== "valid" && assessment?.validity.bias === "positive";
  }), [visibleSweeps, assessmentByEvent]);

  const factReviews = useMemo(() => visibleSweeps.length
    ? [...visibleSweeps].reverse().map(record => buildSweepReview(record, ohlc))
    : [buildSweepReview(null, ohlc)], [visibleSweeps, ohlc]);

  const bullishSignals = visibleSignals.filter((s) => s.direction === "bullish");
  const bearishSignals = visibleSignals.filter((s) => s.direction === "bearish");

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
            價格流動性水平與 Sweep 回看 — Equal Highs/Lows、前日／前週高低、已確認 Swing
          </p>
        </div>
      </div>

      <LiquidityGuide />

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
              Bullish 歷史門檻信號: {bullishSignals.length}
            </Badge>
            <Badge className="bg-red-100 text-red-800">
              Bearish 歷史門檻信號: {bearishSignals.length}
            </Badge>
            <Badge className="bg-blue-100 text-blue-800">
              偏正觀察: {visiblePositiveSweeps.length}
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
            sweeps={visibleSignals}
            watchSweeps={visiblePositiveSweeps}
          />
        )}
      </div>

      {/* Signal details */}
      <SignalMosaic locked={!isPaid}>
        {!loading && <LiquidityValidationSummary result={validation} />}
        {/* IndicatorFacts provides the 選擇分析紀錄 control and separates event from 後續收盤. */}
        {!loading && <IndicatorFacts key={effectiveTicker} name="Sweep" reviews={factReviews} capturedAt={capturedAt} />}
        {visibleSweeps.length === 0 && <p className="mb-6 text-sm text-gray-600">尚無符合條件的掃蕩；這不代表所有水平都沒有被穿越。</p>}
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
                  <th className="text-left p-3">來源／確認日期</th>
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
                    <td className="p-3 font-mono text-gray-600">來源日期 {level.startTime}<br />確認日期 {level.confirmedTime}</td>
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
                        <Badge className="bg-blue-100 text-blue-700 font-medium">尚未掃蕩</Badge>
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
                  <th className="text-left p-3">有效性</th>
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
                    <td className="p-3"><ValidityBadge assessment={assessmentByEvent.get(s)} /></td>
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

function percent(value: number | null): string {
  return value === null ? "資料不足" : `${(value * 100).toFixed(2)}%`;
}

function LiquidityValidationSummary({ result }: { result: ReturnType<typeof validateLiquidityStrategy> }) {
  return (
    <div className="bg-white rounded-xl border p-6 mb-6">
      <h2 className="text-xl font-bold mb-3">固定規則回測</h2>
      <p className="text-sm text-gray-700 mb-3">
        下一交易日開盤進場、第五個交易日收盤出場、扣除來回 0.10% 成本。同日同方向只計一筆，多空衝突或既有持倉尚未結束時不重複進場；沒有挑選最佳參數。
      </p>
      <div className="space-y-3">
        {(["bullish", "bearish"] as const).map(direction => {
          const validation = result.currentValidityByDirection[direction];
          const label = validation.status === "valid" ? "已通過" : validation.status === "insufficient" ? "樣本不足" : "未通過";
          return <div key={direction} className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm border-t pt-3">
            <div><span className="text-gray-500">方向</span><br /><strong>{direction === "bullish" ? "Bullish" : "Bearish"}</strong> <Badge className={validation.status === "valid" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}>{label}</Badge>{validation.bias === "positive" && validation.status !== "valid" && <><br /><Badge className="mt-1 bg-blue-100 text-blue-800">偏正觀察（非信號）</Badge></>}</div>
            <div><span className="text-gray-500">完成交易</span><br /><strong>{validation.sampleSize}</strong></div>
            <div><span className="text-gray-500">平均淨報酬</span><br /><strong>{percent(validation.meanNetReturn)}</strong></div>
            <div><span className="text-gray-500">95% 下限</span><br /><strong>{percent(validation.lowerConfidenceBound)}</strong></div>
            <div><span className="text-gray-500">中位數</span><br /><strong>{percent(validation.medianNetReturn)}</strong></div>
            <div><span className="text-gray-500">勝率</span><br /><strong>{percent(validation.winRate)}</strong></div>
          </div>;
        })}
      </div>
      <p className="text-xs text-gray-500 mt-3">平均淨報酬、中位數與勝率三者偏正時會標記「偏正觀察」，可搭配其他指標的同日期已完成資料做人工確認，但不會自動加分或成為信號。多空分開驗證；只有事件發生前同方向已有至少 20 筆完成交易，且當時的 95% 下限與中位數皆為正，該事件才會成為歷史門檻信號；回測事件本身不會反過來替自己背書，也不代表未來績效已獲證明。</p>
    </div>
  );
}

function ValidityBadge({ assessment }: { assessment?: LiquidityEventAssessment }) {
  if (assessment?.exclusion === "direction-conflict") return <Badge className="bg-gray-100 text-gray-600">方向衝突</Badge>;
  if (assessment?.exclusion === "overlapping-position") return <Badge className="bg-gray-100 text-gray-600">持倉重疊</Badge>;
  if (assessment?.exclusion === "same-day-duplicate") return <Badge className="bg-gray-100 text-gray-600">同日重複</Badge>;
  if (assessment?.validity.status === "valid") return <Badge className="bg-green-100 text-green-800">歷史門檻信號</Badge>;
  if (assessment?.validity.bias === "positive") return <Badge className="bg-blue-100 text-blue-800">偏正觀察（非信號）</Badge>;
  if (assessment?.validity.status === "not-valid") return <Badge className="bg-red-100 text-red-700">未通過</Badge>;
  return <Badge className="bg-amber-100 text-amber-800">樣本不足</Badge>;
}

// ─── Chart Component ─────────────────────────────────────────────────────────

interface LiquidityChartProps {
  ticker: string;
  ohlc: OHLCBar[];
  levels: LiquidityLevel[];
  sweeps: SweepEvent[];
  watchSweeps: SweepEvent[];
}

function LiquidityChart({ ticker, ohlc, levels, sweeps, watchSweeps }: LiquidityChartProps) {
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
      x0: ohlc[level.confirmedIndex].time,
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
      x: ohlc[level.confirmedIndex].time,
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

  // Only events that passed the fixed historical threshold are signal markers.
  const bullSweeps = sweeps.filter((s) => s.direction === "bullish");
  const bearSweeps = sweeps.filter((s) => s.direction === "bearish");

  const bullSweepTrace: Data = {
    type: "scatter",
    x: bullSweeps.map((s) => s.time),
    y: bullSweeps.map((s) => s.wickExtreme),
    mode: "text+markers",
    marker: { symbol: "star", size: 14, color: "#4caf50", line: { width: 1, color: "#1b5e20" } },
    text: bullSweeps.map((s) => `SIGNAL ${s.level.source}`),
    textposition: "bottom center",
    textfont: { size: 9, color: "#4caf50" },
    name: "Bullish 歷史門檻信號",
    hovertemplate: "Bullish 歷史門檻信號<br>Level: %{customdata[0]}<br>$%{customdata[1]:.2f}<br>Vol: %{customdata[2]:.1f}x<extra></extra>",
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
    text: bearSweeps.map((s) => `SIGNAL ${s.level.source}`),
    textposition: "top center",
    textfont: { size: 9, color: "#f44336" },
    name: "Bearish 歷史門檻信號",
    hovertemplate: "Bearish 歷史門檻信號<br>Level: %{customdata[0]}<br>$%{customdata[1]:.2f}<br>Vol: %{customdata[2]:.1f}x<extra></extra>",
    customdata: bearSweeps.map((s) => [s.level.source, s.level.price, s.volumeRatio]),
    xaxis: "x",
    yaxis: "y",
  };

  const watchTrace: Data = {
    type: "scatter",
    x: watchSweeps.map(sweep => sweep.time),
    y: watchSweeps.map(sweep => sweep.wickExtreme),
    mode: "text+markers",
    marker: { symbol: "diamond-open", size: 11, color: "#2563eb", line: { width: 2, color: "#2563eb" } },
    text: watchSweeps.map(() => "WATCH"),
    textposition: "middle right",
    textfont: { size: 9, color: "#2563eb" },
    name: "偏正觀察（非信號）",
    hovertemplate: "偏正觀察（非信號）<br>Direction: %{customdata[0]}<br>Level: %{customdata[1]}<br>$%{customdata[2]:.2f}<extra></extra>",
    customdata: watchSweeps.map(sweep => [sweep.direction, sweep.level.source, sweep.level.price]),
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
      data={[candlestick, watchTrace, bullSweepTrace, bearSweepTrace, volTrace]}
      layout={layout}
      config={{ displayModeBar: true, responsive: true }}
      style={{ width: "100%" }}
    />
  );
}
