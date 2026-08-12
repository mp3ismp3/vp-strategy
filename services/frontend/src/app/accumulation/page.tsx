"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AccumulationState } from "@/types/signal";
import { AccumChart } from "@/components/charts/AccumChart";
import { Badge } from "@/components/ui/badge";
import { StrategyGuide } from "@/components/StrategyGuide";
import {
  GUEST_ACCUMULATION_LIMIT,
} from "@/lib/preview-access";
import { formatTrigger } from "@/lib/triggers";
import type { Plan } from "@/types/user";

function AccumulationContent() {
  const { data: session, status } = useSession();
  const [states, setStates] = useState<AccumulationState[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [accessPlan, setAccessPlan] = useState<Plan>("free");

  useEffect(() => {
    if (!session?.user?.email) {
      return;
    }
    fetch("/api/data/accum-state")
      .then(async (response) => response.ok ? response.json() : Promise.reject())
      .then((data) => {
        setStates(data.states || []);
        setAccessPlan(data.accessPlan || "free");
      })
      .catch(() => setStates([]))
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
        <h1 className="text-2xl font-bold">登入後免費查看 Accumulation 摘要</h1>
        <p className="text-gray-600">Free 方案可查看即時前 10 名摘要。</p>
        <Link href="/login" className="rounded-md bg-black px-6 py-3 font-medium text-white">免費登入</Link>
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

  const isAuthenticated = Boolean(session);
  const isPaid = accessPlan === "pro" || accessPlan === "premium";
  const visibleStates = states;
  const selectedState = visibleStates.find((s) => s.ticker === selectedTicker);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <div>
          <h1 className="text-3xl font-bold">Accumulation Tracker</h1>
          <p className="text-gray-600 mt-1">
            Wyckoff 機構吸籌追蹤 — 顯示 {visibleStates.length} / {states.length} 檔
          </p>
        </div>
      </div>

      {!isAuthenticated && states.length > GUEST_ACCUMULATION_LIMIT && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          未登入可查看 Decay Score 前 {GUEST_ACCUMULATION_LIMIT} 名。
          <Link href="/login" className="ml-2 font-semibold underline">
            登入解鎖完整排行榜
          </Link>
        </div>
      )}

      {/* Strategy Guide (floating button + modal) */}
      <StrategyGuide type="accumulation" />

      {/* Chart Area */}
      {isPaid && selectedState && (
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
              關閉
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
                {isPaid && <th className="py-3 px-4">Support</th>}
                {isPaid && <th className="py-3 px-4">Resistance</th>}
                {isPaid && <th className="py-3 px-4">Triggers</th>}
              </tr>
            </thead>
            <tbody>
              {visibleStates.map((s) => (
                <tr
                  key={s.ticker}
                  onClick={() => isPaid && setSelectedTicker(s.ticker)}
                  className={`border-b transition ${isPaid ? "cursor-pointer" : ""} ${
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
                  {isPaid && <td className="py-3 px-4 text-sm">
                    ${s.support_primary.toFixed(2)}
                  </td>}
                  {isPaid && <td className="py-3 px-4 text-sm">
                    ${s.resistance.toFixed(2)}
                  </td>}
                  {isPaid && <td className="py-3 px-4">
                    {s.triggers_fired.length > 0 ? (
                      <Badge className="bg-orange-100 text-orange-800">
                      {s.triggers_fired.map(formatTrigger).join(", ")}
                      </Badge>
                    ) : (
                      <span className="text-gray-400 text-sm">—</span>
                    )}
                  </td>}
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
  return <AccumulationContent />;
}
