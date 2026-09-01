"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { getVpPositionLabel } from "@/lib/vp-labels";

const VP_PERIODS = [
  ["daily", "日線"],
  ["weekly", "週線"],
  ["monthly", "月線"],
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
  const { data: session, status } = useSession();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/data/dashboard");
      if (!response.ok) throw new Error("目前無法載入 Dashboard");
      setData(await response.json());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法載入 Dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    fetch("/api/data/dashboard")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setData)
      .catch(() => setMessage("目前無法載入 Dashboard"))
      .finally(() => setLoading(false));
  }, [session]);

  if (status === "loading") {
    return <div className="flex min-h-[50vh] items-center justify-center">載入中</div>;
  }
  if (!session) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-bold">登入後建立個人觀察清單</h1>
        <Link href="/login" className="rounded-md bg-black px-6 py-3 text-white">登入</Link>
      </div>
    );
  }
  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center">載入中</div>;
  }

  const saved = new Set(data?.items.map((item) => item.ticker) || []);
  const choices = data?.allowedTickers.filter((ticker) => !saved.has(ticker)) || [];

  async function addTicker() {
    if (!selected) return;
    setMessage("");
    const response = await fetch("/api/user/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: selected }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setMessage(payload.error === "Watchlist limit reached" ? `你的方案最多可追蹤 ${data?.limit} 檔` : "新增失敗");
      return;
    }
    setSelected("");
    await loadDashboard();
  }

  async function removeTicker(ticker: string) {
    const response = await fetch(`/api/user/watchlist/${encodeURIComponent(ticker)}`, { method: "DELETE" });
    if (response.ok) await loadDashboard();
    else setMessage("移除失敗，請稍後再試");
  }

  async function moveTicker(index: number, direction: -1 | 1) {
    if (!data) return;
    const target = index + direction;
    if (target < 0 || target >= data.items.length) return;
    const tickers = data.items.map((item) => item.ticker);
    [tickers[index], tickers[target]] = [tickers[target], tickers[index]];
    const response = await fetch("/api/user/watchlist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers }),
    });
    if (response.ok) await loadDashboard();
    else setMessage("排序失敗，請稍後再試");
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">我的觀察清單</h1>
          <p className="mt-1 text-gray-600">集中查看 VP、Accumulation 與 FVG 狀態</p>
        </div>
        <Badge variant="outline" className="capitalize">{data?.plan || "free"} · {data?.items.length || 0} / {data?.limit || 5}</Badge>
      </div>

      <section className="mb-6 rounded-xl border bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <select value={selected} onChange={(event) => setSelected(event.target.value)} className="min-w-64 rounded-md border px-3 py-2">
            <option value="">選擇平台支援標的</option>
            {choices.map((ticker) => <option key={ticker} value={ticker}>{ticker}</option>)}
          </select>
          <button aria-label="加入觀察" title="加入觀察" onClick={addTicker} disabled={!selected || (data?.items.length || 0) >= (data?.limit || 0)} className="flex h-10 w-10 items-center justify-center rounded-full bg-black text-xl text-white disabled:opacity-40">
            +
          </button>
          {data?.plan === "free" && <Link href="/pricing" className="self-center text-sm font-medium underline">升級以追蹤更多標的</Link>}
        </div>
        {message && <p className="mt-3 text-sm text-red-600">{message}</p>}
      </section>

      {!data?.items.length ? (
        <div className="rounded-xl border border-dashed py-20 text-center text-gray-500">尚未加入標的，請從上方選擇。</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((item, index) => {
            const analysis = item.analysis;
            return (
              <article key={item.ticker} className="rounded-xl border bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-xl font-bold">{item.ticker}</h2>
                    <p className="text-sm text-gray-500">{analysis?.price == null ? "價格暫缺" : `$${analysis.price.toFixed(2)}`}</p>
                  </div>
                  {item.locked ? <Badge variant="outline">已鎖定</Badge> : <Badge className="capitalize">{analysis?.vp.consensus || "no data"}</Badge>}
                </div>
                {item.locked ? (
                  <p className="my-6 text-sm text-amber-700">目前方案無法查看此標的；降級後資料會保留，不會自動刪除。</p>
                ) : analysis ? (
                  <div className="my-5 space-y-3 text-sm">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      {VP_PERIODS.map(([period, label]) => (
                        <div key={period} className="rounded-md bg-gray-50 p-2">
                          <div className="text-xs text-gray-500">{label}</div>
                          <div className="truncate font-medium" title={analysis.vp[period]?.position}>{getVpPositionLabel(analysis.vp[period]?.position)}</div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500">價值區是主要成交量集中的價格範圍；高於／低於價值區代表現價已在 VAH 上方／VAL 下方。</p>
                    <div className="flex justify-between"><span>Accumulation</span><span>{analysis.accumulation ? `Phase ${analysis.accumulation.phase} · ${analysis.accumulation.decay_score.toFixed(1)}` : "未追蹤"}</span></div>
                    <div className="flex justify-between"><span>未回補 FVG</span><span className="text-green-700">Bull {analysis.fvg.bullishOpen}</span><span className="text-red-700">Bear {analysis.fvg.bearishOpen}</span></div>
                    {analysis.accumulation?.failing && <p className="font-medium text-red-700">Accumulation failure warning</p>}
                  </div>
                ) : <p className="my-6 text-sm text-gray-500">本次批次尚無分析資料。</p>}
                <div className="flex items-center justify-between border-t pt-4">
                  <div className="flex gap-1">
                    <button aria-label="向前排序" onClick={() => moveTicker(index, -1)} disabled={index === 0} className="rounded border px-2 py-1 disabled:opacity-30">上移</button>
                    <button aria-label="向後排序" onClick={() => moveTicker(index, 1)} disabled={index === data.items.length - 1} className="rounded border px-2 py-1 disabled:opacity-30">下移</button>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => removeTicker(item.ticker)} className="text-sm text-red-600">移除</button>
                    {!item.locked && <Link href={`/dashboard/${item.ticker}`} className="text-sm font-semibold underline">完整分析</Link>}
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
