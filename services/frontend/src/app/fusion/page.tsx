"use client";

import { useEffect, useState } from "react";
import { Paywall } from "@/components/Paywall";
import { Badge } from "@/components/ui/badge";

interface FusionSignal {
  symbol: string;
  phase: string;
  tier: string;
  decay_score: number;
  raw_score: number;
  daily_position: string;
  daily_position_pct: number;
  weekly_position: string;
  monthly_position: string;
  macro_direction: string;
  stars: number;
  label: string;
  action: string;
  triggers_fired: string[];
  price: number;
  support: number;
  resistance: number;
}

function FusionContent() {
  const [signals, setSignals] = useState<FusionSignal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/data/fusion")
      .then((res) => res.json())
      .then((data) => {
        setSignals(data.signals || []);
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

  const starsDisplay = (n: number) => (n <= 0 ? "❌" : "⭐".repeat(n));

  const positionBadge = (pos: string) => {
    if (pos === "above_va") return <Badge className="bg-green-100 text-green-800">Above VA</Badge>;
    if (pos === "below_va") return <Badge className="bg-red-100 text-red-800">Below VA</Badge>;
    return <Badge className="bg-gray-100 text-gray-800">Inside VA</Badge>;
  };

  const macroBadge = (dir: string) => {
    if (dir === "bullish") return <Badge className="bg-green-100 text-green-800">🟢 Bullish</Badge>;
    if (dir === "bearish") return <Badge className="bg-red-100 text-red-800">🔴 Bearish</Badge>;
    return <Badge className="bg-gray-100 text-gray-800">⚪ Neutral</Badge>;
  };

  const phaseColor: Record<string, string> = {
    A: "bg-yellow-100 text-yellow-800",
    B: "bg-blue-100 text-blue-800",
    C: "bg-purple-100 text-purple-800",
    D: "bg-green-100 text-green-800",
    E: "bg-emerald-100 text-emerald-800",
    UNKNOWN: "bg-gray-100 text-gray-800",
  };

  const actionable = signals.filter((s) => s.stars >= 3);
  const watchlist = signals.filter((s) => s.stars > 0 && s.stars < 3);
  const inactive = signals.filter((s) => s.stars <= 0);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Fusion Analysis</h1>
        <p className="text-gray-600 mt-1">
          VP + Accumulation 跨系統對齊 — 高信心交易機會
        </p>
      </div>

      {/* Actionable (3+ stars) */}
      {actionable.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-4 text-green-800">
            🎯 可操作信號（3+ ⭐）
          </h2>
          <div className="grid gap-4">
            {actionable.map((sig) => (
              <div key={sig.symbol} className="bg-white rounded-xl border-2 border-green-200 p-5">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold">{sig.symbol}</span>
                    <span className="text-lg">{starsDisplay(sig.stars)}</span>
                    <Badge className={phaseColor[sig.phase]}>Phase {sig.phase}</Badge>
                    {macroBadge(sig.macro_direction)}
                  </div>
                  <span className="text-lg font-medium">${sig.price?.toFixed(2)}</span>
                </div>
                <div className="mt-3 p-3 bg-green-50 rounded-lg">
                  <p className="font-medium text-green-900">{sig.label}</p>
                  <p className="text-sm text-green-800 mt-1">{sig.action}</p>
                </div>
                <div className="mt-3 flex gap-4 text-sm">
                  <div>Daily: {positionBadge(sig.daily_position)}</div>
                  <div>Weekly: {positionBadge(sig.weekly_position)}</div>
                  <div>Monthly: {positionBadge(sig.monthly_position)}</div>
                </div>
                <div className="mt-2 flex gap-4 text-xs text-gray-500">
                  <span>Score: {sig.decay_score.toFixed(1)}/18</span>
                  <span>Support: ${sig.support?.toFixed(2)}</span>
                  <span>Resistance: ${sig.resistance?.toFixed(2)}</span>
                  {sig.triggers_fired.length > 0 && (
                    <Badge className="bg-orange-100 text-orange-800">
                      {sig.triggers_fired.join(", ")}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Watchlist (1-2 stars) */}
      {watchlist.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-4 text-yellow-800">
            👀 觀察清單（1-2 ⭐）
          </h2>
          <div className="overflow-x-auto bg-white rounded-xl border">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-gray-500 bg-gray-50">
                  <th className="py-2 px-4">Symbol</th>
                  <th className="py-2 px-4">Stars</th>
                  <th className="py-2 px-4">Phase</th>
                  <th className="py-2 px-4">Daily VP</th>
                  <th className="py-2 px-4">Macro</th>
                  <th className="py-2 px-4">Label</th>
                  <th className="py-2 px-4">Action</th>
                </tr>
              </thead>
              <tbody>
                {watchlist.map((sig) => (
                  <tr key={sig.symbol} className="border-b hover:bg-gray-50">
                    <td className="py-2 px-4 font-bold">{sig.symbol}</td>
                    <td className="py-2 px-4">{starsDisplay(sig.stars)}</td>
                    <td className="py-2 px-4">
                      <Badge className={phaseColor[sig.phase]}>{sig.phase}</Badge>
                    </td>
                    <td className="py-2 px-4">{positionBadge(sig.daily_position)}</td>
                    <td className="py-2 px-4">{macroBadge(sig.macro_direction)}</td>
                    <td className="py-2 px-4 text-sm">{sig.label}</td>
                    <td className="py-2 px-4 text-sm text-gray-600">{sig.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Inactive */}
      {inactive.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-4 text-gray-500">
            ⏸️ 不活躍（{inactive.length} 檔）
          </h2>
          <div className="text-sm text-gray-500 flex flex-wrap gap-2">
            {inactive.map((sig) => (
              <span key={sig.symbol} className="bg-gray-100 px-2 py-1 rounded">
                {sig.symbol}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function FusionPage() {
  return (
    <Paywall requiredPlan="premium">
      <FusionContent />
    </Paywall>
  );
}
