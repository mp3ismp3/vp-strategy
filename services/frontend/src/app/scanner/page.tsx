"use client";

import { useEffect, useState } from "react";
import { Paywall } from "@/components/Paywall";
import { ScanResult } from "@/types/signal";
import { VPChart } from "@/components/charts/VPChart";
import { Badge } from "@/components/ui/badge";
import { StrategyGuide } from "@/components/StrategyGuide";
import { SYMBOL_CATEGORIES, TICKER_TO_CATEGORY, ALL_CATEGORIES } from "@/lib/categories";

function ScannerContent() {
  const [results, setResults] = useState<ScanResult[]>([]);
  const [scanTime, setScanTime] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"signal" | "category">("signal");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  useEffect(() => {
    // Read from Supabase
    import("@supabase/supabase-js").then(({ createClient }) => {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      supabase
        .from("scan_data")
        .select("*")
        .eq("id", "latest")
        .single()
        .then(({ data, error }) => {
          if (error || !data) {
            setLoading(false);
            return;
          }
          const vpData = data.vp_data || {};
          const transformed = Object.entries(vpData).map(([ticker, info]: [string, any]) => {
            const daily = info.daily || {};
            const weekly = info.weekly || {};
            const monthly = info.monthly || {};
            const positions = [daily.position, weekly.position, monthly.position];
            const aboveCount = positions.filter((p: string) => p === "above_va").length;
            const belowCount = positions.filter((p: string) => p === "below_va").length;
            let consensus = "neutral";
            if (aboveCount >= 2) consensus = "bullish";
            else if (belowCount >= 2) consensus = "bearish";
            return {
              ticker,
              price: info.price || 0,
              daily: { poc: daily.poc || 0, vah: daily.vah || 0, val: daily.val || 0, position: daily.position || "inside_va", pct_from_poc: daily.position_pct || 0 },
              weekly: { poc: weekly.poc || 0, vah: weekly.vah || 0, val: weekly.val || 0, position: weekly.position || "inside_va", pct_from_poc: weekly.position_pct || 0 },
              monthly: { poc: monthly.poc || 0, vah: monthly.vah || 0, val: monthly.val || 0, position: monthly.position || "inside_va", pct_from_poc: monthly.position_pct || 0 },
              consensus,
              suggestion: "",
            };
          });
          setResults(transformed);
          setScanTime(data.scan_time || "");
          setLoading(false);
        });
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  const positionBadge = (position: string) => {
    if (position === "above_va")
      return <Badge className="bg-green-100 text-green-800">Above VA</Badge>;
    if (position === "below_va")
      return <Badge className="bg-red-100 text-red-800">Below VA</Badge>;
    return <Badge className="bg-gray-100 text-gray-800">Inside VA</Badge>;
  };

  const bullish = results.filter((r) => r.consensus === "bullish");
  const bearish = results.filter((r) => r.consensus === "bearish");
  const neutral = results.filter(
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
        </div>
        <div className="text-sm text-gray-500">
          {results.length} symbols
        </div>
      </div>

      {/* View Mode + Category Filter */}
      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <div className="flex rounded-md overflow-hidden border">
          <button
            onClick={() => setViewMode("signal")}
            className={`px-3 py-1.5 text-sm font-medium ${viewMode === "signal" ? "bg-black text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
          >
            按信號
          </button>
          <button
            onClick={() => setViewMode("category")}
            className={`px-3 py-1.5 text-sm font-medium ${viewMode === "category" ? "bg-black text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
          >
            按類別
          </button>
        </div>

        {viewMode === "category" && (
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="border rounded-md px-3 py-1.5 text-sm"
          >
            <option value="all">全部類別</option>
            {ALL_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        )}
      </div>

      {/* Strategy Guide (floating button + modal) */}
      <StrategyGuide type="scanner" />

      {/* Chart Area */}
      {selectedResult && (
        <div className="mb-8 bg-white rounded-xl border p-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-lg font-bold">{selectedResult.ticker}</h2>
            <button
              onClick={() => setSelectedTicker(null)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              ✕ 關閉
            </button>
          </div>
          <VPChart ticker={selectedResult.ticker} />
          <div className="flex gap-4 mt-3 text-sm">
            <div>
              Daily: {positionBadge(selectedResult.daily.position)}{" "}
              <span className="text-gray-500">
                {selectedResult.daily.pct_from_poc.toFixed(0)}% from POC
              </span>
            </div>
            <div>
              Weekly: {positionBadge(selectedResult.weekly.position)}{" "}
              <span className="text-gray-500">
                {selectedResult.weekly.pct_from_poc.toFixed(0)}% from POC
              </span>
            </div>
            <div>
              Monthly: {positionBadge(selectedResult.monthly.position)}{" "}
              <span className="text-gray-500">
                {selectedResult.monthly.pct_from_poc.toFixed(0)}% from POC
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Results Grid */}
      {viewMode === "category" ? (
        // Category View
        <div className="grid gap-6">
          {(selectedCategory === "all" ? ALL_CATEGORIES : [selectedCategory]).map((cat) => {
            const categoryTickers = SYMBOL_CATEGORIES[cat] || [];
            const categoryResults = results.filter((r) => categoryTickers.includes(r.ticker));
            if (categoryResults.length === 0) return null;

            return (
              <div key={cat} className="bg-white rounded-xl p-6 border">
                <h2 className="text-lg font-bold mb-4">{cat}（{categoryResults.length} 檔）</h2>
                <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {categoryResults.map((r) => (
                    <button
                      key={r.ticker}
                      onClick={() => setSelectedTicker(r.ticker)}
                      className={`rounded-lg p-4 border text-left hover:shadow-md transition ${
                        r.consensus === "bullish" ? "bg-green-50 border-green-200" :
                        r.consensus === "bearish" ? "bg-red-50 border-red-200" :
                        "bg-gray-50 border-gray-200"
                      } ${selectedTicker === r.ticker ? "ring-2 ring-black" : ""}`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-bold">{r.ticker}</span>
                        <span className="text-sm text-gray-600">${r.price.toFixed(2)}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-2 flex gap-1">
                        {positionBadge(r.daily.position)}
                        {positionBadge(r.weekly.position)}
                        {positionBadge(r.monthly.position)}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        D:{r.daily.pct_from_poc.toFixed(0)}% W:{r.weekly.pct_from_poc.toFixed(0)}% M:{r.monthly.pct_from_poc.toFixed(0)}%
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        // Signal View (original)
      <div className="grid gap-6">
        {/* Bullish */}
        {bullish.length > 0 && (
          <div className="bg-green-50 rounded-xl p-6 border border-green-200">
            <h2 className="text-lg font-bold text-green-800 mb-4">
              🟢 Bullish（Above VA 2+ TFs）— {bullish.length} 檔
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
                    <span className="font-bold">{r.ticker}</span>
                    <span className="text-sm text-gray-600">
                      ${r.price.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-2 flex gap-1">
                    {positionBadge(r.daily.position)}
                    {positionBadge(r.weekly.position)}
                    {positionBadge(r.monthly.position)}
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
              🔴 Bearish（Below VA 2+ TFs）— {bearish.length} 檔
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
                    <span className="font-bold">{r.ticker}</span>
                    <span className="text-sm text-gray-600">
                      ${r.price.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-2 flex gap-1">
                    {positionBadge(r.daily.position)}
                    {positionBadge(r.weekly.position)}
                    {positionBadge(r.monthly.position)}
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
              ⚪ Neutral — {neutral.length} 檔
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
                    <span className="font-bold">{r.ticker}</span>
                    <span className="text-sm text-gray-600">
                      ${r.price.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-2 flex gap-1">
                    {positionBadge(r.daily.position)}
                    {positionBadge(r.weekly.position)}
                    {positionBadge(r.monthly.position)}
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
      )}
    </div>
  );
}

export default function ScannerPage() {
  return (
    <Paywall requiredPlan="pro">
      <ScannerContent />
    </Paywall>
  );
}
