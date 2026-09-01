"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { AccumChart } from "@/components/charts/AccumChart";
import { VPChart } from "@/components/charts/VPChart";
import { FVGChart } from "@/components/charts/FVGChart";
import { WatchlistButton } from "@/components/WatchlistButton";
import { Badge } from "@/components/ui/badge";
import type { FVGGap } from "@/lib/fvg";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("symbol");
  const dashboard = useTranslations("dashboard");
  const common = useTranslations("common");
  const vp = useTranslations("vp");
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
        if (response.status === 403) throw new Error(t("analysisMissing"));
        if (!response.ok) throw new Error(t("analysisMissing"));
        return response.json();
      })
      .then(setAnalysis)
      .catch((reason) => setError(reason instanceof Error ? reason.message : t("analysisMissing")))
      .finally(() => setLoading(false));
  }, [session, status, t, ticker]);

  if (status === "loading") return <div className="flex min-h-[50vh] items-center justify-center">{common("loading")}</div>;
  if (!session) return <div className="py-20 text-center"><Link href="/login" className="underline">{t("loginToView")}</Link></div>;
  if (loading) return <div className="flex min-h-[50vh] items-center justify-center">{common("loading")}</div>;
  if (!analysis) return <div className="mx-auto max-w-xl py-20 text-center"><p>{error}</p><Link href="/dashboard" className="mt-4 inline-block underline">{common("backToWatchlist")}</Link></div>;

  const accumulation = analysis.accumulation;
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/dashboard" className="text-sm text-gray-500 underline">{common("backToWatchlist")}</Link>
           <div className="mt-2 flex items-center gap-3"><h1 className="text-3xl font-bold">{ticker}</h1><Badge className="capitalize">{vp(analysis.vp.consensus)}</Badge></div>
          <p className="mt-1 text-gray-600">{analysis.price == null ? t("noPrice") : `$${analysis.price.toFixed(2)}`} · {t("updated")} {analysis.updatedAt ? new Date(analysis.updatedAt).toLocaleString() : t("unknownTime")}</p>
        </div>
        <WatchlistButton ticker={ticker} />
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-white p-5"><p className="text-sm text-gray-500">{t("consensus")}</p><p className="mt-2 text-2xl font-bold capitalize">{vp(analysis.vp.consensus)}</p></div>
         <div className="rounded-xl border bg-white p-5"><p className="text-sm text-gray-500">{t("accumulation")}</p><p className="mt-2 text-2xl font-bold">{accumulation ? `Phase ${accumulation.phase}` : dashboard("notTracked")}</p>{accumulation && <p className="text-sm">Decay {accumulation.decay_score.toFixed(1)}</p>}</div>
         <div className="rounded-xl border bg-white p-5"><p className="text-sm text-gray-500">{dashboard("unfilledFvg")}</p><p className="mt-2 text-lg"><span className="text-green-700">{dashboard("bull")} {analysis.fvg.bullishOpen}</span> · <span className="text-red-700">{dashboard("bear")} {analysis.fvg.bearishOpen}</span></p></div>
      </section>

      <section className="rounded-xl border bg-white p-5">
         <h2 className="mb-4 text-xl font-bold">{t("volumeProfile")}</h2>
        <VPChart ticker={ticker} />
      </section>

      <section className="rounded-xl border bg-white p-5">
        <h2 className="mb-4 text-xl font-bold">{t("accumulation")}</h2>
        {!accumulation ? <p className="text-gray-500">{t("noAccumulation")}</p> : analysis.access.accumulationDetails ? (
          <AccumChart ticker={ticker} phase={accumulation.phase} decay_score={accumulation.decay_score} support_primary={accumulation.support_primary || 0} support_dynamic={accumulation.support_dynamic || 0} resistance={accumulation.resistance || 0} />
        ) : (
           <div className="space-y-2"><p>Phase {accumulation.phase} · {accumulation.tier} · Raw {accumulation.raw_score}/18 · Decay {accumulation.decay_score.toFixed(1)}</p><p className="text-sm text-amber-700">{t("freeAccumulation")}</p><Link href="/pricing" className="text-sm font-semibold underline">{common("pricing")}</Link></div>
        )}
      </section>

      <section className="rounded-xl border bg-white p-5">
        <h2 className="mb-4 text-xl font-bold">{t("fvg")}</h2>
        {!analysis.access.fvgDetails ? (
          <div><p>{dashboard("unfilledFvg")} {dashboard("bull")} {analysis.fvg.bullishOpen} · {dashboard("bear")} {analysis.fvg.bearishOpen}</p><p className="mt-2 text-sm text-amber-700">{t("freeFvg")}</p></div>
        ) : !analysis.fvg.gaps?.length ? <p className="text-gray-500">{t("noFvg")}</p> : (
          <div className="space-y-5"><FVGChart ticker={ticker} gaps={analysis.fvg.gaps} /><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-gray-500"><th className="py-2">{t("direction")}</th><th>{t("date")}</th><th>{t("range")}</th><th>{t("status")}</th></tr></thead><tbody>{analysis.fvg.gaps.map((gap, index) => <tr key={`${gap.date}-${index}`} className="border-b"><td className={gap.type === "bullish" ? "py-3 text-green-700" : "py-3 text-red-700"}>{gap.type === "bullish" ? dashboard("bull") : dashboard("bear")}</td><td>{gap.date}</td><td>${gap.gapLow.toFixed(2)}–${gap.gapHigh.toFixed(2)}</td><td>{gap.filled ? t("filled") : t("open", { percent: gap.fillPct.toFixed(0) })}</td></tr>)}</tbody></table></div></div>
        )}
      </section>
    </main>
  );
}
