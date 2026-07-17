"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

interface AccumSymbol {
  symbol: string;
  tier: string;
  phase: string;
  decay_score: number;
  support_dynamic: number;
  resistance: number;
  triggers_fired: { type: string; date: string }[];
  pending_triggers: { type: string }[];
}

export default function StrategyPage() {
  const [symbols, setSymbols] = useState<AccumSymbol[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    import("@supabase/supabase-js").then(({ createClient }) => {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      supabase
        .from("scan_data")
        .select("*")
        .eq("id", "accum_state")
        .single()
        .then(({ data, error }) => {
          if (error || !data) {
            setLoading(false);
            return;
          }
          const state = data.accum_data || data.vp_data || {};
          const items: AccumSymbol[] = Object.entries(state)
            .filter(([, v]: [string, any]) => typeof v === "object" && v.tier)
            .map(([sym, v]: [string, any]) => ({
              symbol: sym,
              tier: v.tier || "watch",
              phase: v.phase || "?",
              decay_score: v.decay_score || 0,
              support_dynamic: v.support_dynamic || 0,
              resistance: v.resistance || 0,
              triggers_fired: v.triggers_fired || [],
              pending_triggers: v.pending_triggers || [],
            }))
            .sort((a, b) => b.decay_score - a.decay_score);
          setSymbols(items);
          setLoading(false);
        });
    });
  }, []);

  const confirmed = symbols.filter((s) => s.tier === "confirmed");
  const withTriggers = confirmed.filter((s) => s.triggers_fired.length > 0);
  const withPending = confirmed.filter(
    (s) => s.pending_triggers.length > 0 && s.triggers_fired.length === 0
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold">📊 Strategy Lab</h1>
        <p className="text-gray-600 mt-1">
          回測驗證過的交易策略，明確的進場時機與規則
        </p>
      </div>

      {/* Strategy Card */}
      <div className="bg-white rounded-xl border p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold">🏛️ Wyckoff Accumulation + RSI(2)</h2>
            <p className="text-sm text-gray-500 mt-1">
              Swing (10-20天) | Long only | ~30 筆/年
            </p>
          </div>
          <Badge className="bg-green-100 text-green-800">Active</Badge>
        </div>

        {/* 3-Layer Logic */}
        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="bg-blue-50 rounded-lg p-4">
            <h3 className="font-semibold text-blue-800 mb-2">Layer 1: 機構吸籌</h3>
            <p className="text-sm text-blue-700">
              7 項指標日評分，Decay score 連續 2 天 ≥ 12 → Confirmed。
              確認機構正在累積買入。
            </p>
          </div>
          <div className="bg-purple-50 rounded-lg p-4">
            <h3 className="font-semibold text-purple-800 mb-2">Layer 2: 結構觸發</h3>
            <p className="text-sm text-purple-700">
              Spring（跌破收回）/ LPS（量縮回踩）/ SOS（放量突破）。
              Wyckoff 結構時機到位。
            </p>
          </div>
          <div className="bg-orange-50 rounded-lg p-4">
            <h3 className="font-semibold text-orange-800 mb-2">Layer 3: RSI(2) {"<"} 30</h3>
            <p className="text-sm text-orange-700">
              短線極度超賣 = 賣壓已耗盡。
              精確入場時機，提升勝率至 52%。
            </p>
          </div>
        </div>

        {/* Backtest Results */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="font-semibold mb-3">回測績效 (30 symbols, 900天)</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>Win Rate: <span className="font-bold">51.7%</span></div>
              <div>Expectancy: <span className="font-bold text-green-600">+0.64R</span></div>
              <div>Profit Factor: <span className="font-bold">2.16</span></div>
              <div>Sharpe: <span className="font-bold">0.34</span></div>
              <div>Max DD: <span className="font-bold">4.1R</span></div>
              <div>Avg Hold: <span className="font-bold">11 天</span></div>
            </div>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="font-semibold mb-3">Holdout 驗證 (未見數據)</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>Win Rate: <span className="font-bold">50.0%</span></div>
              <div>Expectancy: <span className="font-bold text-green-600">+0.50R</span></div>
              <div>Profit Factor: <span className="font-bold">~2.0</span></div>
              <div>Sharpe: <span className="font-bold">0.32</span></div>
              <div>Max DD: <span className="font-bold">4.0R</span></div>
              <div>Avg Hold: <span className="font-bold">8 天</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Entry Signals */}
      <div className="bg-white rounded-xl border p-6 mb-8">
        <h2 className="text-xl font-bold mb-4">⚡ 進場信號</h2>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
          </div>
        ) : withTriggers.length > 0 ? (
          <div className="space-y-3">
            {withTriggers.map((s) => {
              const lastTrigger = s.triggers_fired[s.triggers_fired.length - 1];
              return (
                <div key={s.symbol} className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-bold text-lg">{s.symbol}</span>
                      <Badge className="ml-2 bg-green-100 text-green-800">
                        Phase {s.phase}
                      </Badge>
                      <Badge className="ml-2 bg-blue-100 text-blue-800">
                        {lastTrigger.type}
                      </Badge>
                    </div>
                    <span className="text-sm text-gray-500">{lastTrigger.date}</span>
                  </div>
                  <div className="mt-2 text-sm text-gray-700">
                    Score {s.decay_score.toFixed(1)} |
                    Support ${s.support_dynamic.toFixed(1)} |
                    Resistance ${s.resistance.toFixed(1)}
                  </div>
                  <div className="mt-2 text-sm font-medium text-green-700">
                    ⏳ 等待 RSI(2) {"<"} 30 → 次日 Open 買入
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800">
            目前沒有已觸發的 confirmed 信號。耐心等待下一個機會。
          </div>
        )}

        {withPending.length > 0 && (
          <div className="mt-4">
            <h3 className="font-semibold text-gray-700 mb-2">⏳ 等待確認中</h3>
            <div className="space-y-2">
              {withPending.map((s) => (
                <div key={s.symbol} className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <span className="font-bold">{s.symbol}</span>
                  <Badge className="ml-2 bg-blue-100 text-blue-800">
                    {s.pending_triggers[0]?.type} pending
                  </Badge>
                  <span className="text-sm text-gray-500 ml-2">
                    Phase {s.phase} | Score {s.decay_score.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Entry Checklist */}
      <div className="bg-white rounded-xl border p-6 mb-8">
        <h2 className="text-xl font-bold mb-4">📋 進場 Checklist</h2>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold text-green-700 mb-2">✅ 買入條件（全部滿足）</h3>
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>Confirmed tier（上方信號區顯示）</li>
              <li>Trigger fired — Spring / LPS / SOS</li>
              <li>RSI(2) {"<"} 30（TradingView 確認）</li>
              <li>次日 Open 買入（不追盤）</li>
              <li>設 Stop Loss（trigger 給的 SL 價位）</li>
              <li>Position size ≤ 2% risk</li>
            </ol>
          </div>
          <div>
            <h3 className="font-semibold text-red-700 mb-2">❌ 不要進場</h3>
            <ul className="list-disc list-inside space-y-2 text-sm">
              <li>RSI(2) {">"} 30 — 還沒超賣</li>
              <li>Watch tier — 未確認，不可靠</li>
              <li>同時持倉 ≥ 3 筆</li>
              <li>VIX {">"} 30 — 極端恐慌暫停</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Position Sizing */}
      <div className="bg-white rounded-xl border p-6 mb-8">
        <h2 className="text-xl font-bold mb-4">💰 倉位計算</h2>
        <div className="bg-gray-50 rounded-lg p-4 text-sm font-mono">
          <p>帳戶: $100,000 | Risk: 2% = $2,000/trade</p>
          <p>Entry: $150.00 | SL: $142.50 (trigger 給的)</p>
          <p>Risk/share: $150 - $142.50 = $7.50</p>
          <p>股數: $2,000 ÷ $7.50 = <span className="font-bold">266 shares</span></p>
          <p>Position: 266 × $150 = $39,900 (40% of account)</p>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          同時最多 3 筆 = 最大曝險 6% of account
        </p>
      </div>

      {/* Tracked Symbols */}
      {!loading && confirmed.length > 0 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-xl font-bold mb-4">
            📋 Confirmed 清單（{confirmed.length} 檔）
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {confirmed.map((s) => (
              <div key={s.symbol} className="border rounded-lg p-3">
                <div className="flex justify-between items-center">
                  <span className="font-bold">{s.symbol}</span>
                  <Badge className="bg-purple-100 text-purple-800">
                    Phase {s.phase}
                  </Badge>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Score {s.decay_score.toFixed(1)} |
                  S: ${s.support_dynamic.toFixed(0)} |
                  R: ${s.resistance.toFixed(0)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
