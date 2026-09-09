"use client";

import { useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import type { Annotations, Data, Layout } from "plotly.js";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { SignalMosaic } from "@/components/SignalMosaic";
import { analyzeRvol, type RvolAnalysis } from "@/lib/rvol";
import { completedDailyBars, completedWeeklyBars } from "@/lib/market-bars";
import { buildRvolChart } from "@/lib/rvol-chart";
import {
  calcMACD, detectDivergence,
  type OHLCBar, type MACDPoint, type DivergenceSignal,
} from "@/lib/macd";
import {
  filterIndicatorItems,
  getIndicatorCategories,
  isIndicatorTickerAllowed,
} from "@/lib/preview-access";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// ─── Chart Component ─────────────────────────────────────────────────────────

interface MACDChartProps {
  ohlc: OHLCBar[];
  macdData: MACDPoint[];
  divergences: DivergenceSignal[];
  title: string;
}

function MACDChart({ ohlc, macdData, divergences, title }: MACDChartProps) {
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

  // MACD Histogram
  const histColors = macdData.map((m) => (m.histogram >= 0 ? "#26a69a" : "#ef5350"));
  const histTrace: Data = {
    type: "bar",
    x: times,
    y: macdData.map((m) => m.histogram),
    marker: { color: histColors },
    name: "Histogram",
    xaxis: "x2",
    yaxis: "y2",
    showlegend: false,
  };

  // MACD Line
  const macdLine: Data = {
    type: "scatter",
    x: times,
    y: macdData.map((m) => m.macd),
    line: { color: "#2962FF", width: 1.5 },
    name: "MACD",
    xaxis: "x2",
    yaxis: "y2",
  };

  // Signal Line
  const signalLine: Data = {
    type: "scatter",
    x: times,
    y: macdData.map((m) => m.signal),
    line: { color: "#FF6D00", width: 1.5 },
    name: "Signal",
    xaxis: "x2",
    yaxis: "y2",
  };

  // Divergence annotations
  const annotations: Partial<Annotations>[] = divergences.map((div) => ({
    x: div.time,
    y: div.type === "bullish" ? div.priceSwingCurr : div.priceSwingCurr,
    xref: "x",
    yref: "y",
    text: div.type === "bullish" ? "Bull Div" : "Bear Div",
    showarrow: true,
    arrowhead: 2,
    arrowcolor: div.type === "bullish" ? "#4caf50" : "#f44336",
    ay: div.type === "bullish" ? 30 : -30,
    font: { size: 10, color: div.type === "bullish" ? "#4caf50" : "#f44336" },
  }));

  const layout: Partial<Layout> = {
    height: 450,
    margin: { l: 60, r: 20, t: 40, b: 30 },
    showlegend: true,
    legend: { x: 0, y: 1.12, orientation: "h", font: { size: 11 } },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    title: { text: title, font: { size: 14 } },
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
      nticks: 10,
    },
    yaxis: {
      domain: [0.38, 1],
      title: { text: "Price ($)" },
      showgrid: true,
      gridcolor: "rgba(0,0,0,0.04)",
    },
    yaxis2: {
      domain: [0, 0.32],
      title: { text: "MACD" },
      showgrid: true,
      gridcolor: "rgba(0,0,0,0.04)",
    },
    annotations,
  };

  return (
    <Plot
      data={[candlestick, histTrace, macdLine, signalLine]}
      layout={layout}
      config={{ displayModeBar: true, responsive: true }}
      style={{ width: "100%" }}
    />
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

interface ScanResult {
  ticker: string;
  dailyDivs: DivergenceSignal[];
  weeklyDivs: DivergenceSignal[];
  isDual: boolean; // 日線+周線同向背離
  dualType?: "bullish" | "bearish";
}

export default function MACDPage() {
  const { data: session } = useSession();
  const accessPlan = (session?.user as { plan?: "free" | "pro" | "premium" } | undefined)?.plan ?? "free";
  const isPaid = accessPlan === "pro" || accessPlan === "premium";
  const [showMacd, setShowMacd] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState("NVDA");
  const [snapshot, setSnapshot] = useState<{ bars: OHLCBar[]; capturedAt?: string }>({ bars: [] });
  const ohlc = useMemo(() => completedDailyBars(snapshot.bars, snapshot.capturedAt), [snapshot]);
  const [loadedTicker, setLoadedTicker] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [rvolResults, setRvolResults] = useState<{ ticker: string; time: string; analysis: RvolAnalysis }[]>([]);
  const currentRvol = useMemo(() => analyzeRvol(ohlc), [ohlc]);

  const indicatorCategories = useMemo(
    () => getIndicatorCategories(accessPlan),
    [accessPlan]
  );
  const effectiveTicker = isIndicatorTickerAllowed(selectedTicker, accessPlan)
    ? selectedTicker
    : "NVDA";
  const loading = loadedTicker !== effectiveTicker;

  // Fetch OHLC for selected ticker
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/data/chart-data?ticker=${encodeURIComponent(effectiveTicker)}`)
      .then(async (response) => response.ok ? response.json() : Promise.reject())
      .then((chart) => {
        if (!cancelled) setSnapshot({ bars: chart?.daily?.ohlc || [], capturedAt: chart?.daily?.captured_at });
      })
      .catch(() => {
        if (!cancelled) setSnapshot({ bars: [] });
      })
      .finally(() => {
        if (!cancelled) setLoadedTicker(effectiveTicker);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveTicker]);

  // Compute MACD and divergences for selected ticker
  const dailyMACD = useMemo(() => {
    if (ohlc.length === 0) return null;
    const closes = ohlc.map((b) => b.close);
    const result = calcMACD(closes);
    if (!result) return null;
    return result.map((m, i) => ({ ...m, time: ohlc[i].time }));
  }, [ohlc]);

  const weeklyOHLC = useMemo(() => completedWeeklyBars(snapshot.bars, snapshot.capturedAt), [snapshot]);

  const weeklyMACD = useMemo(() => {
    if (weeklyOHLC.length === 0) return null;
    const closes = weeklyOHLC.map((b) => b.close);
    const result = calcMACD(closes);
    if (!result) return null;
    return result.map((m, i) => ({ ...m, time: weeklyOHLC[i].time }));
  }, [weeklyOHLC]);

  const dailyDivergences = useMemo(() => {
    if (!dailyMACD) return [];
    const divs = detectDivergence(ohlc, dailyMACD, 60, 5);
    return divs.map((d) => ({ ...d, timeframe: "daily" as const }));
  }, [ohlc, dailyMACD]);

  const weeklyDivergences = useMemo(() => {
    if (!weeklyMACD) return [];
    const divs = detectDivergence(weeklyOHLC, weeklyMACD, 30, 3);
    return divs.map((d) => ({ ...d, timeframe: "weekly" as const }));
  }, [weeklyOHLC, weeklyMACD]);

  // Scan all tickers for divergences
  const handleScan = async () => {
    setScanning(true);
    const response = await fetch("/api/data/chart-data?include=data");
    const chartRows = (response.ok ? await response.json() : {}) as Record<
      string,
      { daily?: { ohlc?: OHLCBar[]; captured_at?: string } }
    >;
    const rows = Object.entries(chartRows).map(([ticker, data]) => ({ ticker, data }));

    const results: ScanResult[] = [];
    const volumeResults: typeof rvolResults = [];

    if (rows) {
      for (const row of filterIndicatorItems(rows, accessPlan)) {
        const rawBars = row.data?.daily?.ohlc || [];
        const dailyOhlc = completedDailyBars(rawBars, row.data?.daily?.captured_at);
        const analysis = analyzeRvol(dailyOhlc);
        if (analysis.setup) volumeResults.push({ ticker: row.ticker, time: dailyOhlc.at(-1)!.time, analysis });
        if (dailyOhlc.length < 60) continue;

        const closes = dailyOhlc.map((b: OHLCBar) => b.close);
        const dMacd = calcMACD(closes);
        if (!dMacd) continue;
        const dMacdWithTime = dMacd.map((m, i) => ({ ...m, time: dailyOhlc[i].time }));
        const dDivs = detectDivergence(dailyOhlc, dMacdWithTime, 60, 5);
        const dailyDivs = dDivs.map((d) => ({ ...d, timeframe: "daily" as const }));

        const wOhlc = completedWeeklyBars(rawBars, row.data?.daily?.captured_at);
        let weeklyDivs: DivergenceSignal[] = [];
        if (wOhlc.length >= 35) {
          const wCloses = wOhlc.map((b) => b.close);
          const wMacd = calcMACD(wCloses);
          if (wMacd) {
            const wMacdWithTime = wMacd.map((m, i) => ({ ...m, time: wOhlc[i].time }));
            const wDivs = detectDivergence(wOhlc, wMacdWithTime, 30, 3);
            weeklyDivs = wDivs.map((d) => ({ ...d, timeframe: "weekly" as const }));
          }
        }

        if (dailyDivs.length > 0 || weeklyDivs.length > 0) {
          // Check dual divergence (same direction on both timeframes)
          let isDual = false;
          let dualType: "bullish" | "bearish" | undefined;

          for (const dd of dailyDivs) {
            for (const wd of weeklyDivs) {
              if (dd.type === wd.type) {
                isDual = true;
                dualType = dd.type;
                break;
              }
            }
            if (isDual) break;
          }

          results.push({
            ticker: row.ticker,
            dailyDivs,
            weeklyDivs,
            isDual,
            dualType,
          });
        }
      }
    }

    // Sort: dual first, then by most recent
    results.sort((a, b) => {
      if (a.isDual && !b.isDual) return -1;
      if (!a.isDual && b.isDual) return 1;
      const aMin = Math.min(
        ...a.dailyDivs.map((d) => d.barsAgo),
        ...a.weeklyDivs.map((d) => d.barsAgo),
        999
      );
      const bMin = Math.min(
        ...b.dailyDivs.map((d) => d.barsAgo),
        ...b.weeklyDivs.map((d) => d.barsAgo),
        999
      );
      return aMin - bMin;
    });

    setScanResults(results);
    setRvolResults(volumeResults);
    setScanning(false);
  };

  // Auto-scan all tickers on page load
  useEffect(() => {
    const timeoutId = window.setTimeout(() => void handleScan(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [accessPlan]); // eslint-disable-line react-hooks/exhaustive-deps

  const rvolChart = useMemo(() => buildRvolChart(ohlc, isPaid ? currentRvol : { ...currentRvol, setup: null }), [ohlc, currentRvol, isPaid]);

  const visibleRvolResults = filterIndicatorItems(rvolResults, accessPlan).filter(row => showExpired || row.analysis.setup?.status !== "expired");

  // Categorize scan results
  const dualResults = scanResults.filter((r) => r.isDual);
  const dailyOnlyResults = scanResults.filter((r) => !r.isDual && r.dailyDivs.length > 0);
  const weeklyOnlyResults = scanResults.filter((r) => !r.isDual && r.weeklyDivs.length > 0);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <div>
          <h1 className="text-3xl font-bold">突破與回踩觀察</h1>
          <p className="text-gray-600 mt-1">
            收盤後觀察放量突破、縮量回踩與失效狀態
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl border p-4 mb-6 flex flex-wrap gap-4 items-center">
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

        {scanning && (
          <div className="ml-auto flex items-center gap-2 text-sm text-gray-500">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900" />
            掃描中...
          </div>
        )}
      </div>

      <section className="bg-white rounded-xl border p-4 mb-6" aria-label="RVOL 量價訊號">
          <h2 className="text-xl font-bold mb-2">RVOL 量價訊號（日線）</h2>
          {!loading && ohlc.length > 0 && <Plot data={rvolChart.data} layout={rvolChart.layout} config={{ responsive: true, displayModeBar: true }} style={{ width: "100%" }} />}
          {loading && <p role="status">載入量價圖表…</p>}
          {!loading && ohlc.length === 0 && <p>尚無已完成日 K 資料。</p>}
          <SignalMosaic locked={!isPaid}>
          <details className="text-sm mb-4">
            <summary className="cursor-pointer font-medium">判斷規則與 RVOL 分級</summary>
          <p className="text-sm text-gray-600 mb-3">
            已完成日 K 成交量 ÷ 該日前 20 個交易日均量。追蹤突破 20 日高點後 10 根日 K；以原突破位與當時波動範圍判斷回踩，收盤跌破即失效。
          </p>
          <p className="text-sm text-gray-600 mb-3">
            &lt;0.7 明顯縮量 · 0.7–&lt;1 普通 · 1–&lt;1.5 有量 · 1.5–2 明顯放量 · &gt;2 異常大量
          </p>
          </details>
          <p className="mb-3 text-sm text-gray-600">
            {effectiveTicker}：{loading ? "載入中…" : currentRvol.rvol === null ? "成交量資料不足" :
              `最新已完成日 RVOL ${currentRvol.rvol.toFixed(2)} · ${currentRvol.volumeLabel}（${ohlc.at(-1)?.time}）`}
          </p>
          {!loading && currentRvol.setup && <p className="mb-3">
            形態：{currentRvol.setup.label} · 事件日 {currentRvol.setup.eventDate} / RVOL {currentRvol.setup.eventRvol?.toFixed(2) ?? "資料不足"}
            · 原突破 {currentRvol.setup.breakoutDate} / RVOL {currentRvol.setup.breakoutRvol?.toFixed(2) ?? "資料不足"}
            · 距原突破位 {currentRvol.distancePct?.toFixed(2)}%
          </p>}
          <p className="text-sm text-gray-600 mb-3">
            資料擷取：{snapshot.capturedAt ?? "未知（保守排除最後一根）"} · 分析至：{currentRvol.asOf ?? "資料不足"}（已完成日 K）
            · 均量區間：{currentRvol.baselineStart ?? "—"} ～ {currentRvol.baselineEnd ?? "—"}
            {snapshot.bars.length > ohlc.length && " · 未確認完成的 K 棒已排除"}
          </p>
          <label className="flex items-center gap-2 text-sm mb-3">
            <input type="checkbox" checked={showExpired} onChange={event => setShowExpired(event.target.checked)} />
            顯示已到期形態
          </label>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left">
                <th className="p-2">標的／日期</th><th className="p-2">訊號</th>
                <th className="p-2">最新已完成日 RVOL</th><th className="p-2">原突破位／距離</th><th className="p-2">突破日／RVOL</th><th className="p-2">事件日／RVOL</th>
              </tr></thead>
              <tbody>{visibleRvolResults.map(({ ticker, time, analysis }) => (
                <tr key={ticker} className="border-b">
                  <td className="p-2"><button className="underline" onClick={() => setSelectedTicker(ticker)}>{ticker}</button><span className="block text-gray-500">{time}</span></td>
                  <td className="p-2">{analysis.setup?.label}</td>
                  <td className="p-2">{analysis.rvol?.toFixed(2)}</td>
                  <td className="p-2">${analysis.setup?.level.toFixed(2)} / {analysis.distancePct?.toFixed(2)}%</td>
                  <td className="p-2">{analysis.setup?.breakoutDate} / {analysis.setup?.breakoutRvol?.toFixed(2) ?? "資料不足"}</td>
                  <td className="p-2">{analysis.setup?.eventDate} / {analysis.setup?.eventRvol?.toFixed(2) ?? "資料不足"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {!scanning && visibleRvolResults.length === 0 && <p className="text-sm text-gray-500 mt-2">目前資料沒有追蹤中的量價形態。</p>}
          <p className="text-sm text-gray-500 mt-3">回踩縮量需搭配原突破量能閱讀；突破量不足或回踩放量代表量能未支持形態，並不等於必然失敗。</p>
          </SignalMosaic>
        </section>
        <details className="rounded-xl border bg-white p-4 mt-6" onToggle={event => setShowMacd(event.currentTarget.open)}>
          <summary className="cursor-pointer font-semibold">MACD 輔助分析（選看）</summary>
          <p className="text-sm text-gray-600 my-3">動能背離提供背景資訊，不是突破／回踩的必要條件。日線轉折需後續 5 根、週線需後續 3 根 K 棒確認。</p>
          {showMacd && <>
      {/* Charts remain visible in the guest preview. */}
      <div className="space-y-6 mb-8">
        {/* Daily MACD Chart */}
        <div className="bg-white rounded-xl border p-4">
          {loading ? (
            <div className="flex items-center justify-center h-[450px]">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
            </div>
          ) : ohlc.length === 0 ? (
            <div className="flex items-center justify-center h-[450px] text-gray-500">
              無 {effectiveTicker} 已完成日 K 資料。
            </div>
          ) : dailyMACD ? (
            <MACDChart
              ohlc={ohlc}
              macdData={dailyMACD}
              divergences={dailyDivergences}
              title={`${effectiveTicker} 日線 MACD (Daily)`}
            />
          ) : (
            <div className="flex items-center justify-center h-[450px] text-gray-500">
              數據不足，無法計算 MACD
            </div>
          )}
        </div>

        {/* Weekly MACD Chart */}
        <div className="bg-white rounded-xl border p-4">
          {loading ? (
            <div className="flex items-center justify-center h-[450px]">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
            </div>
          ) : weeklyOHLC.length === 0 ? (
            <div className="flex items-center justify-center h-[450px] text-gray-500">
              無周線數據
            </div>
          ) : weeklyMACD ? (
            <MACDChart
              ohlc={weeklyOHLC}
              macdData={weeklyMACD}
              divergences={weeklyDivergences}
              title={`${effectiveTicker} 周線 MACD (Weekly)`}
            />
          ) : (
            <div className="flex items-center justify-center h-[450px] text-gray-500">
              周線數據不足，無法計算 MACD
            </div>
          )}
        </div>
      </div>

          <SignalMosaic locked={!isPaid}>
        {(dailyDivergences.length > 0 || weeklyDivergences.length > 0) && (
          <div className="bg-white rounded-xl border p-4 mb-6 flex flex-wrap gap-3">
            {dailyDivergences.map((d, i) => (
              <Badge key={`d-${i}`} className={d.type === "bullish" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                日線{d.type === "bullish" ? "看漲" : "看跌"}背離 ({d.barsAgo} bars ago)
              </Badge>
            ))}
            {weeklyDivergences.map((d, i) => (
              <Badge key={`w-${i}`} className={d.type === "bullish" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                周線{d.type === "bullish" ? "看漲" : "看跌"}背離 ({d.barsAgo} bars ago)
              </Badge>
            ))}
            {dailyDivergences.some((d) => weeklyDivergences.some((w) => w.type === d.type)) && (
              <Badge className="bg-gray-100 text-gray-700">
                日線+周線雙重背離
              </Badge>
            )}
          </div>
        )}
        {scanResults.length > 0 && (
          <div className="space-y-6">
          {/* Dual Divergence */}
          {dualResults.length > 0 && (
            <div className="bg-white rounded-xl border p-6">
              <h2 className="text-xl font-bold mb-4">雙重背離（日線 + 周線同向）</h2>
              <p className="text-sm text-gray-500 mb-4">兩個時間框架同向背離；不代表較高勝率</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left p-3">標的</th>
                      <th className="text-left p-3">方向</th>
                      <th className="text-left p-3">日線 (bars ago)</th>
                      <th className="text-left p-3">周線 (bars ago)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dualResults.map((r) => (
                      <tr key={r.ticker} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedTicker(r.ticker)}>
                        <td className="p-3 font-bold">{r.ticker}</td>
                        <td className="p-3">
                          <Badge className={r.dualType === "bullish" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                            {r.dualType === "bullish" ? "看漲" : "看跌"}
                          </Badge>
                        </td>
                        <td className="p-3">{r.dailyDivs.find((d) => d.type === r.dualType)?.barsAgo ?? "-"}</td>
                        <td className="p-3">{r.weeklyDivs.find((d) => d.type === r.dualType)?.barsAgo ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Daily Only */}
          {dailyOnlyResults.length > 0 && (
            <div className="bg-white rounded-xl border p-6">
              <h2 className="text-xl font-bold mb-4">日線背離</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left p-3">標的</th>
                      <th className="text-left p-3">方向</th>
                      <th className="text-left p-3">Bars Ago</th>
                      <th className="text-left p-3">日期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyOnlyResults.map((r) =>
                      r.dailyDivs.map((d, i) => (
                        <tr key={`${r.ticker}-${i}`} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedTicker(r.ticker)}>
                          <td className="p-3 font-bold">{r.ticker}</td>
                          <td className="p-3">
                            <Badge className={d.type === "bullish" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                              {d.type === "bullish" ? "看漲" : "看跌"}
                            </Badge>
                          </td>
                          <td className="p-3">{d.barsAgo}</td>
                          <td className="p-3 font-mono text-gray-600">{d.time}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Weekly Only */}
          {weeklyOnlyResults.length > 0 && (
            <div className="bg-white rounded-xl border p-6">
              <h2 className="text-xl font-bold mb-4">周線背離</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left p-3">標的</th>
                      <th className="text-left p-3">方向</th>
                      <th className="text-left p-3">Bars Ago</th>
                      <th className="text-left p-3">日期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyOnlyResults.map((r) =>
                      r.weeklyDivs.map((d, i) => (
                        <tr key={`${r.ticker}-${i}`} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedTicker(r.ticker)}>
                          <td className="p-3 font-bold">{r.ticker}</td>
                          <td className="p-3">
                            <Badge className={d.type === "bullish" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                              {d.type === "bullish" ? "看漲" : "看跌"}
                            </Badge>
                          </td>
                          <td className="p-3">{d.barsAgo}</td>
                          <td className="p-3 font-mono text-gray-600">{d.time}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Summary */}
          <div className="text-center text-sm text-gray-500">
            共掃描到 {scanResults.length} 檔有背離訊號 | 雙重: {dualResults.length} | 日線: {dailyOnlyResults.length} | 周線: {weeklyOnlyResults.length}
          </div>
          </div>
        )}
      </SignalMosaic>
          </>}
        </details>
    </div>
  );
}
