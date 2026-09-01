"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { AccumChart } from "@/components/charts/AccumChart";
import { VPChart } from "@/components/charts/VPChart";
import { WatchlistButton } from "@/components/WatchlistButton";
import { Badge } from "@/components/ui/badge";
import type { FVGGap } from "@/lib/fvg";

interface SymbolAnalysis {
  ticker: string;
  price: number | null;
  updatedAt: string | null;
  vp: {
    consensus: string;
    daily: { position: string; poc: number | null; vah: number | null; val: number | null } | null;
    weekly: { position: string; poc: number | null; vah: number | null; val: number | null } | null;
    monthly: { position: string; poc: number | null; vah: number | null; val: number | null } | null;
  };
  accumulation: null | {
    phase: string;
    tier: string;
    raw_score: number;
    decay_score: number;
    failing: boolean;
    support_primary?: number | null;
    support_dynamic?: number | null;
    resistance?: number | null;
    triggers_fired?: unknown[];
  };
  fvg: { bullishOpen: number; bearishOpen: number; gaps?: FVGGap[] };
  access: { accumulationDetails: boolean; fvgDetails: boolean };
}

export default function SymbolDashboardPage() {
  const params = useParams<{ ticker: string }>();
  const ticker = params.ticker.toUpperCase();
  const { data: session, status } = useSession();
  const [analysis, setAnalysis] = useState<SymbolAnalysis | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    fetch(`/api/data/symbol/${encodeURIComponent(ticker)}`)
      .then(async (response) => {
        if (response.status === 403) throw new Error("你的方案無法查看此標的");
        if (!response.ok) throw new Error("本次批次尚無此標的分析資料");
        return response.json();
      })
      .then(setAnalysis)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "載入失敗"))
      .finally(() => setLoading(false));
  }, [session, status, ticker]);

  if (status === "loading") return <div className="flex min-h-[50vh] items-center justify-center">載入中</div>;
  if (!session) return <div className="py-20 text-center"><Link href="/login" className="underline">登入後查看標的分析</Link></div>;
  if (loading) return <div className="flex min-h-[50vh] items-center justify-center">載入中</div>;
  if (!analysis) return <div className="mx-auto max-w-xl py-20 text-center"><p>{error}</p><Link href="/dashboard" className="mt-4 inline-block underline">返回我的觀察</Link></div>;

  const accumulation = analysis.accumulation;
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/dashboard" className="text-sm text-gray-500 underline">返回我的觀察</Link>
          <div className="mt-2 flex items-center gap-3"><h1 className="text-3xl font-bold">{ticker}</h1><Badge className="capitalize">{analysis.vp.consensus}</Badge></div>
          <p className="mt-1 text-gray-600">{analysis.price == null ? "價格暫缺" : `$${analysis.price.toFixed(2)}`} · 更新 {analysis.updatedAt ? new Date(analysis.updatedAt).toLocaleString() : "時間未知"}</p>
        </div>
        <WatchlistButton ticker={ticker} />
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-white p-5"><p className="text-sm text-gray-500">VP 共識</p><p className="mt-2 text-2xl font-bold capitalize">{analysis.vp.consensus}</p></div>
        <div className="rounded-xl border bg-white p-5"><p className="text-sm text-gray-500">Accumulation</p><p className="mt-2 text-2xl font-bold">{accumulation ? `Phase ${accumulation.phase}` : "未追蹤"}</p>{accumulation && <p className="text-sm">Decay {accumulation.decay_score.toFixed(1)}</p>}</div>
        <div className="rounded-xl border bg-white p-5"><p className="text-sm text-gray-500">未回補 FVG</p><p className="mt-2 text-lg"><span className="text-green-700">Bull {analysis.fvg.bullishOpen}</span> · <span className="text-red-700">Bear {analysis.fvg.bearishOpen}</span></p></div>
      </section>

      <section className="rounded-xl border bg-white p-5">
        <h2 className="mb-4 text-xl font-bold">Volume Profile</h2>
        <VPChart ticker={ticker} />
      </section>

      <section className="rounded-xl border bg-white p-5">
        <h2 className="mb-4 text-xl font-bold">Accumulation</h2>
        {!accumulation ? <p className="text-gray-500">此標的目前未進入 Accumulation Tracker。</p> : analysis.access.accumulationDetails ? (
          <AccumChart ticker={ticker} phase={accumulation.phase} decay_score={accumulation.decay_score} support_primary={accumulation.support_primary || 0} support_dynamic={accumulation.support_dynamic || 0} resistance={accumulation.resistance || 0} />
        ) : (
          <div className="space-y-2"><p>Phase {accumulation.phase} · {accumulation.tier} · Raw {accumulation.raw_score}/18 · Decay {accumulation.decay_score.toFixed(1)}</p><p className="text-sm text-amber-700">Free 方案不顯示支撐、壓力與 trigger 細節。</p><Link href="/pricing" className="text-sm font-semibold underline">查看升級方案</Link></div>
        )}
      </section>

      <section className="rounded-xl border bg-white p-5">
        <h2 className="mb-4 text-xl font-bold">Fair Value Gap</h2>
        {!analysis.access.fvgDetails ? (
          <div><p>未回補 Bullish {analysis.fvg.bullishOpen} 個，Bearish {analysis.fvg.bearishOpen} 個。</p><p className="mt-2 text-sm text-amber-700">Free 方案提供數量摘要；升級後顯示缺口價位與回補狀態。</p></div>
        ) : !analysis.fvg.gaps?.length ? <p className="text-gray-500">最近區間沒有符合條件的 FVG。</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-gray-500"><th className="py-2">方向</th><th>日期</th><th>區間</th><th>狀態</th></tr></thead><tbody>{analysis.fvg.gaps.map((gap, index) => <tr key={`${gap.date}-${index}`} className="border-b"><td className={gap.type === "bullish" ? "py-3 text-green-700" : "py-3 text-red-700"}>{gap.type}</td><td>{gap.date}</td><td>${gap.gapLow.toFixed(2)}–${gap.gapHigh.toFixed(2)}</td><td>{gap.filled ? "已回補" : `未回補（${gap.fillPct.toFixed(0)}%）`}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </main>
  );
}
