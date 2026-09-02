"use client";

import { type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { getVpPositionLabel } from "@/lib/vp-labels";
import { persistWatchlistOrder, reorderWatchlistItems } from "@/lib/watchlist";
import { useTranslations } from "next-intl";

const VP_PERIODS = [
  "daily",
  "weekly",
  "monthly",
] as const;

interface AnalysisSummary {
  ticker: string;
  price: number | null;
  updatedAt: string | null;
  vp: {
    consensus: string;
    daily: { position: string } | null;
    weekly: { position: string } | null;
    monthly: { position: string } | null;
  };
  accumulation: {
    phase: string;
    tier: string;
    decay_score: number;
    failing: boolean;
  } | null;
  fvg: { bullishOpen: number; bearishOpen: number };
}

interface DashboardItem {
  ticker: string;
  sort_order: number;
  locked: boolean;
  analysis: AnalysisSummary | null;
}

interface DashboardPayload {
  items: DashboardItem[];
  plan: "free" | "pro" | "premium";
  limit: number;
  allowedTickers: string[];
}

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const common = useTranslations("common");
  const vp = useTranslations("vp");
  const { data: session, status } = useSession();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [draggedTicker, setDraggedTicker] = useState<string | null>(null);
  const [dragOverTicker, setDragOverTicker] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const reorderInFlight = useRef(false);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/data/dashboard");
      if (!response.ok) throw new Error(t("loadFailed"));
      setData(await response.json());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!session) return;
    fetch("/api/data/dashboard")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setData)
      .catch(() => setMessage(t("loadFailed")))
      .finally(() => setLoading(false));
  }, [session, t]);

  if (status === "loading") {
    return <div className="flex min-h-[50vh] items-center justify-center">{common("loading")}</div>;
  }
  if (!session) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-bold">{t("unauthenticatedTitle")}</h1>
        <Link href="/login" className="rounded-md bg-black px-6 py-3 text-white">{common("login")}</Link>
      </div>
    );
  }
  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center">{common("loading")}</div>;
  }

  const saved = new Set(data?.items.map((item) => item.ticker) || []);
  const choices = data?.allowedTickers.filter((ticker) => !saved.has(ticker)) || [];

  async function addTicker() {
    if (!selected || reorderInFlight.current) return;
    setMessage("");
    const response = await fetch("/api/user/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: selected }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setMessage(payload.error === "Watchlist limit reached" ? t("limitReached", { limit: data?.limit ?? 0 }) : t("addFailed"));
      return;
    }
    setSelected("");
    await loadDashboard();
  }

  async function removeTicker(ticker: string) {
    if (reorderInFlight.current) return;
    const response = await fetch(`/api/user/watchlist/${encodeURIComponent(ticker)}`, { method: "DELETE" });
    if (response.ok) await loadDashboard();
    else setMessage(t("removeFailed"));
  }

  async function reorderTicker(ticker: string, targetIndex: number) {
    if (!data || reorderInFlight.current) return;
    const reorderedItems = reorderWatchlistItems(data.items, ticker, targetIndex);
    if (reorderedItems === data.items) return;
    const previousData = data;
    const persistence = persistWatchlistOrder(
      fetch,
      reorderedItems.map((item) => item.ticker),
      reorderInFlight,
    );
    setIsReordering(true);
    setData({ ...data, items: reorderedItems });
    setMessage("");
    const result = await persistence;
    if (result === "failed") {
      setData(previousData);
      setMessage(t("orderFailed"));
    }
    setIsReordering(false);
  }

  function startDragging(event: DragEvent<HTMLElement>, ticker: string) {
    setDraggedTicker(ticker);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", ticker);
  }

  function dropTicker(event: DragEvent<HTMLElement>, targetIndex: number) {
    event.preventDefault();
    const ticker = draggedTicker || event.dataTransfer.getData("text/plain");
    setDraggedTicker(null);
    setDragOverTicker(null);
    if (ticker) void reorderTicker(ticker, targetIndex);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="mt-1 text-gray-600">{t("subtitle")}</p>
        </div>
        <Badge variant="outline" className="capitalize">{data?.plan || "free"} · {data?.items.length || 0} / {data?.limit || 5}</Badge>
      </div>

      <section className="mb-6 rounded-xl border bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <select value={selected} onChange={(event) => setSelected(event.target.value)} disabled={isReordering} className="min-w-64 rounded-md border px-3 py-2 disabled:opacity-50">
            <option value="">{t("chooseTicker")}</option>
            {choices.map((ticker) => <option key={ticker} value={ticker}>{ticker}</option>)}
          </select>
           <button aria-label={t("add")} title={t("add")} onClick={addTicker} disabled={isReordering || !selected || (data?.items.length || 0) >= (data?.limit || 0)} className="flex h-10 w-10 items-center justify-center rounded-full bg-black text-xl text-white disabled:opacity-40">
            +
          </button>
          {data?.plan === "free" && <Link href="/pricing" className="self-center text-sm font-medium underline">{t("upgradeMore")}</Link>}
        </div>
        {message && <p className="mt-3 text-sm text-red-600">{message}</p>}
      </section>

      {!data?.items.length ? (
        <div className="rounded-xl border border-dashed py-20 text-center text-gray-500">{t("empty")}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((item, index) => {
            const analysis = item.analysis;
            return (
              <article
                key={item.ticker}
                draggable={!isReordering}
                aria-label={`${item.ticker} · ${t("dragToReorder")}`}
                title={t("dragToReorder")}
                onDragStart={(event) => startDragging(event, item.ticker)}
                onDragEnd={() => {
                  setDraggedTicker(null);
                  setDragOverTicker(null);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDragOverTicker(item.ticker);
                }}
                onDragLeave={() => setDragOverTicker((ticker) => ticker === item.ticker ? null : ticker)}
                onDrop={(event) => dropTicker(event, index)}
                className={`cursor-grab rounded-xl border bg-white p-5 shadow-sm transition active:cursor-grabbing ${draggedTicker === item.ticker ? "opacity-60" : ""} ${dragOverTicker === item.ticker && draggedTicker !== item.ticker ? "border-blue-500 ring-2 ring-blue-100" : ""}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span aria-hidden="true" className="select-none text-lg leading-none text-gray-400">
                        ⋮⋮
                      </span>
                      <h2 className="text-xl font-bold">{item.ticker}</h2>
                    </div>
                    <p className="text-sm text-gray-500">{analysis?.price == null ? t("priceMissing") : `$${analysis.price.toFixed(2)}`}</p>
                  </div>
                  {item.locked ? <Badge variant="outline">{t("locked")}</Badge> : <Badge className="capitalize">{analysis ? vp(analysis.vp.consensus) : common("noData")}</Badge>}
                </div>
                {item.locked ? (
                  <p className="my-6 text-sm text-amber-700">{t("lockedDescription")}</p>
                ) : analysis ? (
                  <div className="my-5 space-y-3 text-sm">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      {VP_PERIODS.map((period) => (
                        <div key={period} className="rounded-md bg-gray-50 p-2">
                          <div className="text-xs text-gray-500">{t(period)}</div>
                          <div className="truncate font-medium" title={analysis.vp[period]?.position}>{getVpPositionLabel(analysis.vp[period]?.position, vp)}</div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500">{t("valueAreaHelp")}</p>
                    <div className="flex justify-between"><span>{t("accumulation")}</span><span>{analysis.accumulation ? `Phase ${analysis.accumulation.phase} · ${analysis.accumulation.decay_score.toFixed(1)}` : t("notTracked")}</span></div>
                    <div className="flex justify-between"><span>{t("unfilledFvg")}</span><span className="text-green-700">{t("bull")} {analysis.fvg.bullishOpen}</span><span className="text-red-700">{t("bear")} {analysis.fvg.bearishOpen}</span></div>
                    {analysis.accumulation?.failing && <p className="font-medium text-red-700">{t("failureWarning")}</p>}
                  </div>
                ) : <p className="my-6 text-sm text-gray-500">{t("noAnalysis")}</p>}
                <div className="flex items-center justify-end border-t pt-4">
                  <div className="flex gap-3">
                    <button onClick={() => removeTicker(item.ticker)} disabled={isReordering} className="text-sm text-red-600 disabled:opacity-40">{t("remove")}</button>
                    {!item.locked && <Link href={`/dashboard/${item.ticker}`} className="text-sm font-semibold underline">{t("fullAnalysis")}</Link>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
