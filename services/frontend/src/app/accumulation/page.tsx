"use client";

import { useEffect, useState } from "react";
import { Paywall } from "@/components/Paywall";
import { AccumulationState } from "@/types/signal";
import { AccumChart } from "@/components/charts/AccumChart";
import { Badge } from "@/components/ui/badge";

function AccumulationContent() {
  const [states, setStates] = useState<AccumulationState[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  useEffect(() => {
    fetch("/accum_state.json")
      .then((res) => res.json())
      .then((data) => {
        const transformed = Object.entries(data).map(([ticker, info]: [string, any]) => ({
          ticker,
          phase: info.phase || "UNKNOWN",
          tier: info.tier || "watch",
          decay_score: info.decay_score || 0,
          raw_score: info.raw_score || 0,
          support_primary: info.support_primary || 0,
          support_dynamic: info.support_dynamic || 0,
          resistance: info.resistance || 0,
          failing: info.failing || false,
          triggers_fired: info.triggers_fired || [],
        }));
        setStates(transformed);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  const phaseColor: Record<string, string> = {
    A: "bg-yellow-100 text-yellow-800",
    B: "bg-blue-100 text-blue-800",
    C: "bg-purple-100 text-purple-800",
    D: "bg-green-100 text-green-800",
    E: "bg-emerald-100 text-emerald-800",
    UNKNOWN: "bg-gray-100 text-gray-800",
  };

  const sorted = [...states].sort((a, b) => b.decay_score - a.decay_score);
  const selectedState = states.find((s) => s.ticker === selectedTicker);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Accumulation Tracker</h1>
        <p className="text-gray-600 mt-1">
          Wyckoff 機構吸籌追蹤 — {states.length} 檔追蹤中
        </p>
      </div>

      {/* Strategy Guide */}
      <div className="mb-6 bg-purple-50 rounded-xl p-5 border border-purple-200">
        <h3 className="font-bold text-purple-900 mb-3">📖 Wyckoff 吸籌階段 & 入場時機</h3>
        <div className="grid md:grid-cols-2 gap-4 text-sm text-purple-800">
          <div>
            <p className="font-semibold mb-1">階段說明：</p>
            <ul className="space-y-1 ml-4 list-disc">
              <li><b>Phase A</b> — 大跌停止，出現賣出高潮</li>
              <li><b>Phase B</b> — 區間震盪吸籌，OBV 上升</li>
              <li><b>Phase C</b> — Spring 假跌破（最佳入場區）</li>
              <li><b>Phase D</b> — Higher Lows，趨勢啟動</li>
              <li><b>Phase E</b> — 突破阻力，已起飛</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold mb-1">入場觸發：</p>
            <ul className="space-y-1 ml-4 list-disc">
              <li><b>🌊 Spring</b>（Phase C）— 跌破支撐後收回 + 量確認 → PILOT BUY 10-25%</li>
              <li><b>📈 LPS</b>（Phase D）— 回踩量縮守住前低 → ADD 25-40%</li>
              <li><b>🚀 SOS Breakout</b>（Phase D）— 突破阻力 + 量 &gt; 1.5x → FULL POSITION</li>
            </ul>
          </div>
        </div>
        <div className="mt-3 text-xs text-purple-600">
          💡 Score 0-18 分：≥12 強烈吸籌、9-11 可能吸籌、&lt;9 觀察中。Confirmed = 連續多天高分。
        </div>
      </div>

      {/* Chart Area */}
      {selectedState && (
        <div className="mb-8 bg-white rounded-xl border p-4">
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold">{selectedState.ticker}</h2>
              <Badge className={phaseColor[selectedState.phase] || ""}>
                Phase {selectedState.phase}
              </Badge>
              <Badge variant={selectedState.tier === "confirmed" ? "default" : "outline"}>
                {selectedState.tier}
              </Badge>
            </div>
            <button
              onClick={() => setSelectedTicker(null)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              ✕ 關閉
            </button>
          </div>
          <AccumChart
            ticker={selectedState.ticker}
            phase={selectedState.phase}
            decay_score={selectedState.decay_score}
            support_primary={selectedState.support_primary}
            support_dynamic={selectedState.support_dynamic}
            resistance={selectedState.resistance}
          />
        </div>
      )}

      {/* Table */}
      {states.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          目前沒有追蹤中的標的。
        </div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl border">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b text-left text-sm text-gray-500 bg-gray-50">
                <th className="py-3 px-4">Ticker</th>
                <th className="py-3 px-4">Phase</th>
                <th className="py-3 px-4">Tier</th>
                <th className="py-3 px-4">Raw Score</th>
                <th className="py-3 px-4">Decay Score</th>
                <th className="py-3 px-4">Support</th>
                <th className="py-3 px-4">Resistance</th>
                <th className="py-3 px-4">Triggers</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr
                  key={s.ticker}
                  onClick={() => setSelectedTicker(s.ticker)}
                  className={`border-b cursor-pointer transition ${
                    selectedTicker === s.ticker
                      ? "bg-blue-50"
                      : "hover:bg-gray-50"
                  }`}
                >
                  <td className="py-3 px-4 font-bold">{s.ticker}</td>
                  <td className="py-3 px-4">
                    <Badge className={phaseColor[s.phase] || ""}>
                      {s.phase}
                    </Badge>
                  </td>
                  <td className="py-3 px-4">
                    <Badge
                      variant={
                        s.tier === "confirmed" ? "default" : "outline"
                      }
                    >
                      {s.tier}
                    </Badge>
                  </td>
                  <td className="py-3 px-4">{s.raw_score}/18</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            s.decay_score >= 12
                              ? "bg-green-500"
                              : s.decay_score >= 9
                              ? "bg-yellow-500"
                              : "bg-red-400"
                          }`}
                          style={{
                            width: `${(s.decay_score / 18) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="text-sm">{s.decay_score.toFixed(1)}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-sm">
                    ${s.support_primary.toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-sm">
                    ${s.resistance.toFixed(2)}
                  </td>
                  <td className="py-3 px-4">
                    {s.triggers_fired.length > 0 ? (
                      <Badge className="bg-orange-100 text-orange-800">
                        {s.triggers_fired.map((t: any) => typeof t === "string" ? t : t.type).join(", ")}
                      </Badge>
                    ) : (
                      <span className="text-gray-400 text-sm">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AccumulationPage() {
  return (
    <Paywall requiredPlan="pro">
      <AccumulationContent />
    </Paywall>
  );
}
