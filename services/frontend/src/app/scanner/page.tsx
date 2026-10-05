"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { ScanResult } from "@/types/signal";
import { VPChart } from "@/components/charts/VPChart";
import { Badge } from "@/components/ui/badge";
import { StrategyGuide } from "@/components/StrategyGuide";
import { WatchlistButton } from "@/components/WatchlistButton";
import { SYMBOL_CATEGORIES, ALL_CATEGORIES, isBinanceEquityTicker } from "@/lib/categories";
import type { Plan } from "@/types/user";

function ScannerContent() {
  const { data: session, status } = useSession();
  const [results, setResults] = useState<ScanResult[]>([]);
  const [scanTime, setScanTime] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [planSnapshot, setPlanSnapshot] = useState<{
    email: string;
    plan: Plan;
  } | null>(null);

  // Fetch real-time plan
  useEffect(() => {
    let cancelled = false;
    if (session?.user?.email) {
      const email = session.user.email;
      fetch("/api/user/plan")
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled) {
            setPlanSnapshot({ email, plan: data.plan || "free" });
          }
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session?.user?.email) {
      return;
    }
    fetch("/api/data/scan-results")
      .then(async (response) => response.ok ? response.json() : Promise.reject())
      .then((data) => {
        setResults(data.results || []);
        setScanTime(data.scan_time || "");
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [session?.user?.email]);

  if (status === "loading" || (session && loading)) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-bold">登入後免費查看即時 Scanner</h1>
        <p className="text-gray-600">Free 方案包含 Mega Cap Tech 7 檔即時 VP 分析。</p>
        <a href="/login" className="rounded-md bg-black px-6 py-3 font-medium text-white">免費登入</a>
      </div>
    );
  }

  const vaTouchBadge = (touch?: "vah" | "val" | "both" | null) => {
    if (!touch) return null;
    const label = touch === "both" ? "VAH + VAL 觸及" : `${touch.toUpperCase()} 觸及`;
    return <Badge className="bg-amber-100 text-amber-900">{label}</Badge>;
  };

  const vaTouchContext = (context?: string | null) => ({
    reentered_value: "收回 VA",
    closed_above_value: "收在 VA 上方",
    closed_below_value: "收在 VA 下方",
    retest_from_above: "VAH 回踩守住",
    retest_from_below: "VAL 回踩守住",
    range_test: "區間測試",
    at_vah: "收在 VAH",
    at_val: "收在 VAL",
  }[context || ""] || "待確認");

  const positionBadge = (level: ScanResult["daily"]) => {
    const position = level.position;
    if (position === "above_va")
      return <>{<Badge className="bg-green-100 text-green-800">Above VA</Badge>} {vaTouchBadge(level.va_touch)}</>;
    if (position === "below_va")
      return <>{<Badge className="bg-red-100 text-red-800">Below VA</Badge>} {vaTouchBadge(level.va_touch)}</>;
    return <><Badge className="bg-gray-100 text-gray-800">Inside VA</Badge> {vaTouchBadge(level.va_touch)}</>;
  };

  const FREE_SYMBOLS = SYMBOL_CATEGORIES["Mega Cap Tech"] || [];

  // Filter by plan: free only sees Mega Cap Tech
  const effectiveUserPlan =
    session?.user?.email && planSnapshot?.email === session.user.email
      ? planSnapshot.plan
      : "free";
  const planFilteredResults = effectiveUserPlan === "free"
    ? results.filter((r) => FREE_SYMBOLS.includes(r.ticker))
    : results;

  const filteredResults = selectedCategory === "all"
    ? planFilteredResults
    : planFilteredResults.filter((r) => (SYMBOL_CATEGORIES[selectedCategory] || []).includes(r.ticker));

  const bullish = filteredResults.filter((r) => r.consensus === "bullish");
  const bearish = filteredResults.filter((r) => r.consensus === "bearish");
  const neutral = filteredResults.filter(
    (r) => r.consensus !== "bullish" && r.consensus !== "bearish"
  );

  const selectedResult = results.find((r) => r.ticker === selectedTicker);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">VP Scanner</h1>
          <p className="text-gray-600 mt-1">
            多時間框架 Volume Profile 位置分析
          </p>
          {scanTime && (
            <p className="text-xs text-gray-400 mt-1">
              Last scan: {new Date(scanTime).toLocaleString()}
            </p>
          )}
          {filteredResults.length > 0 && filteredResults[0].bar_date && (
            <p className="text-xs text-gray-400 mt-1">
              Data through: {filteredResults[0].bar_date} (completed daily bar)
            </p>
          )}
        </div>
        <div className="text-sm text-gray-500">
          {results.length} symbols
        </div>
      </div>

      {/* Category Filter */}
      {effectiveUserPlan === "free" && (
        <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex justify-between items-center">
          <span className="text-sm text-yellow-800">
            免費方案只顯示 Mega Cap Tech（7 檔）。升級 Pro 解鎖全部分析標的。
          </span>
          <a href="/pricing" className="text-sm font-medium bg-black text-white px-3 py-1 rounded-md hover:bg-gray-800">
            升級
          </a>
        </div>
      )}
      <div className="mb-4">
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm"
        >
          <option value="all">全部類別（{results.length} 檔）</option>
          {ALL_CATEGORIES.map((cat) => {
            const count = results.filter((r) => (SYMBOL_CATEGORIES[cat] || []).includes(r.ticker)).length;
            return (
              <option key={cat} value={cat}>{cat}（{count}）</option>
            );
          })}
        </select>
      </div>

      {/* Strategy Guide (floating button + modal) */}
      <StrategyGuide type="scanner" />

      {/* Chart Area */}
      {selectedResult && (
        <div className="mb-8 bg-white rounded-xl border p-4">
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold">{selectedResult.ticker}</h2>
              {isBinanceEquityTicker(selectedResult.ticker) && <Badge variant="outline">Binance</Badge>}
              <WatchlistButton ticker={selectedResult.ticker} />
            </div>
            <button
              onClick={() => setSelectedTicker(null)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              關閉
            </button>
          </div>
          <VPChart ticker={selectedResult.ticker} />
          <div className="flex gap-4 mt-3 text-sm">
            <div>
              Daily: {positionBadge(selectedResult.daily)}{" "}
              <span className="text-gray-500">
                {selectedResult.daily.pct_from_poc.toFixed(0)}% from POC
              </span>
              {selectedResult.daily.va_touch_date && <div className="text-xs text-amber-800">邊界測試日：{selectedResult.daily.va_touch_date} · {vaTouchContext(selectedResult.daily.va_touch_context)}</div>}
            </div>
            <div>
              Weekly: {positionBadge(selectedResult.weekly)}{" "}
              <span className="text-gray-500">
                {selectedResult.weekly.pct_from_poc.toFixed(0)}% from POC
              </span>
              {selectedResult.weekly.va_touch_date && <div className="text-xs text-amber-800">邊界測試日：{selectedResult.weekly.va_touch_date} · {vaTouchContext(selectedResult.weekly.va_touch_context)}</div>}
            </div>
            <div>
              Monthly: {positionBadge(selectedResult.monthly)}{" "}
              <span className="text-gray-500">
                {selectedResult.monthly.pct_from_poc.toFixed(0)}% from POC
              </span>
              {selectedResult.monthly.va_touch_date && <div className="text-xs text-amber-800">邊界測試日：{selectedResult.monthly.va_touch_date} · {vaTouchContext(selectedResult.monthly.va_touch_context)}</div>}
            </div>
          </div>
        </div>
      )}

      {/* Results Grid */}
      <div className="grid gap-6">
        {/* Bullish */}
        {bullish.length > 0 && (
          <div className="bg-green-50 rounded-xl p-6 border border-green-200">
            <h2 className="text-lg font-bold text-green-800 mb-4">
              Bullish（Above VA 2+ TFs）— {bullish.length} 檔
            </h2>
            <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-3">
              {bullish.map((r) => (
                <button
                  key={r.ticker}
                  onClick={() => setSelectedTicker(r.ticker)}
                  className={`bg-white rounded-lg p-4 border text-left hover:shadow-md transition ${
                    selectedTicker === r.ticker ? "ring-2 ring-green-500" : ""
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-2 font-bold">
                      {r.ticker}
                      {isBinanceEquityTicker(r.ticker) && <Badge variant="outline">Binance</Badge>}
                    </span>
                    <span className="text-sm text-gray-600">
                      ${r.price.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-2 flex gap-1">
                    {positionBadge(r.daily)}
                    {positionBadge(r.weekly)}
                    {positionBadge(r.monthly)}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    D:{r.daily.pct_from_poc.toFixed(0)}% W:
                    {r.weekly.pct_from_poc.toFixed(0)}% M:
                    {r.monthly.pct_from_poc.toFixed(0)}%
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Bearish */}
        {bearish.length > 0 && (
          <div className="bg-red-50 rounded-xl p-6 border border-red-200">
            <h2 className="text-lg font-bold text-red-800 mb-4">
              Bearish（Below VA 2+ TFs）— {bearish.length} 檔
            </h2>
            <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-3">
              {bearish.map((r) => (
                <button
                  key={r.ticker}
                  onClick={() => setSelectedTicker(r.ticker)}
                  className={`bg-white rounded-lg p-4 border text-left hover:shadow-md transition ${
                    selectedTicker === r.ticker ? "ring-2 ring-red-500" : ""
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-2 font-bold">
                      {r.ticker}
                      {isBinanceEquityTicker(r.ticker) && <Badge variant="outline">Binance</Badge>}
                    </span>
                    <span className="text-sm text-gray-600">
                      ${r.price.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-2 flex gap-1">
                    {positionBadge(r.daily)}
                    {positionBadge(r.weekly)}
                    {positionBadge(r.monthly)}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    D:{r.daily.pct_from_poc.toFixed(0)}% W:
                    {r.weekly.pct_from_poc.toFixed(0)}% M:
                    {r.monthly.pct_from_poc.toFixed(0)}%
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Neutral */}
        {neutral.length > 0 && (
          <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
            <h2 className="text-lg font-bold text-gray-800 mb-4">
              Neutral — {neutral.length} 檔
            </h2>
            <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-3">
              {neutral.map((r) => (
                <button
                  key={r.ticker}
                  onClick={() => setSelectedTicker(r.ticker)}
                  className={`bg-white rounded-lg p-4 border text-left hover:shadow-md transition ${
                    selectedTicker === r.ticker ? "ring-2 ring-gray-500" : ""
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-2 font-bold">
                      {r.ticker}
                      {isBinanceEquityTicker(r.ticker) && <Badge variant="outline">Binance</Badge>}
                    </span>
                    <span className="text-sm text-gray-600">
                      ${r.price.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-2 flex gap-1">
                    {positionBadge(r.daily)}
                    {positionBadge(r.weekly)}
                    {positionBadge(r.monthly)}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    D:{r.daily.pct_from_poc.toFixed(0)}% W:
                    {r.weekly.pct_from_poc.toFixed(0)}% M:
                    {r.monthly.pct_from_poc.toFixed(0)}%
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ScannerPage() {
  return <ScannerContent />;
}
