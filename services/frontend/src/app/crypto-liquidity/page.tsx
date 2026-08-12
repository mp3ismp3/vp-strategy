"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { joinSeriesByDate } from "@/lib/crypto-liquidity";

type Point = { date: string; value: number };
type Payload = {
  asOf: string;
  sources: { stablecoin: string | null; market: string | null; etf: string | null };
  stablecoin: { current: number | null; changePct1d: number | null; changePct7d: number | null; changePct30d: number | null; changePct90d: number | null; history: Point[] };
  etf: { status: "unavailable" | "available"; btcNetFlow: number | null; ethNetFlow: number | null };
  market: { totalMarketCap: number | null; totalVolume: number | null; marketCapChangePct: number | null; volumeRatio30d: number | null; history: Point[] };
  liquidityBias: string;
  biasReasons: string[];
};

const money = (value: number | null) => value == null ? "—" : `$${(value / 1e9).toFixed(2)}B`;
const pct = (value: number | null) => value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const biasLabel = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function IndexedChart({ stablecoin, market, days }: { stablecoin: Point[]; market: Point[]; days: number }) {
  const rows = useMemo(() => {
    const joined = joinSeriesByDate(stablecoin.slice(-days), market.slice(-days));
    const baseStable = joined[0]?.left || 1;
    const baseMarket = joined[0]?.right || 1;
    return joined.map((point) => ({ date: point.date, stable: (point.left / baseStable) * 100, market: (point.right / baseMarket) * 100 }));
  }, [stablecoin, market, days]);
  if (rows.length < 2) return <div className="flex h-64 items-center justify-center text-sm text-gray-500">歷史資料不足，暫時無法繪圖。</div>;
  const values = rows.flatMap((row) => [row.stable, row.market ?? 100]);
  const min = Math.min(...values); const max = Math.max(...values); const range = max - min || 1;
  const path = (key: "stable" | "market") => rows.map((row, index) => `${index ? "L" : "M"} ${(index / (rows.length - 1)) * 100} ${100 - (((row[key] ?? 100) - min) / range) * 90 - 5}`).join(" ");
  return <div><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-64 w-full overflow-visible rounded-lg bg-gray-50 p-2"><path d={path("stable")} fill="none" stroke="#2563eb" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /><path d={path("market")} fill="none" stroke="#16a34a" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg><div className="mt-3 flex gap-5 text-xs text-gray-600"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-600" />Stablecoin indexed</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-green-600" />Market cap indexed</span><span className="ml-auto">{rows[0].date} → {rows.at(-1)?.date}</span></div></div>;
}

export default function CryptoLiquidityPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<"auth" | "unavailable" | "unknown" | null>(null);
  const [days, setDays] = useState(365);
  useEffect(() => {
    fetch("/api/data/crypto-liquidity").then(async (response) => {
      if (response.status === 401) throw new Error("auth");
      if (response.status === 503) throw new Error("unavailable");
      if (!response.ok) throw new Error("unknown");
      return response.json();
    }).then(setData).catch((reason: Error) => setError(reason.message as typeof error || "unknown"));
  }, []);

  if (error === "auth") return <main className="mx-auto max-w-xl px-4 py-20 text-center"><h1 className="text-3xl font-bold">登入後查看 Crypto Liquidity</h1><p className="mt-4 text-gray-600">登入後即可查看 stablecoin、market cap 與市場成交量的歷史資料。</p><Link href="/login" className="mt-6 inline-block rounded-md bg-black px-6 py-3 font-medium text-white">前往登入</Link></main>;
  if (error) return <main className="mx-auto max-w-5xl px-4 py-12"><h1 className="text-3xl font-bold">Crypto Liquidity</h1><p className="mt-4 text-red-700">{error === "unavailable" ? "資料服務暫時無法取得，請稍後再試。" : "頁面載入失敗，請稍後再試。"}</p></main>;
  if (!data) return <main className="flex min-h-[50vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900" /></main>;

  const biasClass = data.liquidityBias.includes("inflow") ? "border-green-200 bg-green-50 text-green-800" : data.liquidityBias.includes("outflow") ? "border-red-200 bg-red-50 text-red-800" : "border-gray-200 bg-gray-50 text-gray-800";
  const cards = [["Stablecoin Supply", money(data.stablecoin.current), data.sources.stablecoin ? `30D ${pct(data.stablecoin.changePct30d)}` : "資料來源暫時無法取得", data.sources.stablecoin || "Unavailable"], ["BTC ETF Net Flow", money(data.etf.btcNetFlow), data.etf.status === "available" ? "Configured" : "尚未設定來源", data.sources.etf || "Not configured"], ["ETH ETF Net Flow", money(data.etf.ethNetFlow), data.etf.status === "available" ? "Configured" : "尚未設定來源", data.sources.etf || "Not configured"], ["BTC Market Cap", money(data.market.totalMarketCap), data.sources.market ? `30D ${pct(data.market.marketCapChangePct)}` : "資料來源暫時無法取得", data.sources.market || "Unavailable"], ["BTC Spot Volume", money(data.market.totalVolume), data.sources.market ? (data.market.volumeRatio30d == null ? "30D baseline unavailable" : `${data.market.volumeRatio30d}x previous 30D avg`) : "資料來源暫時無法取得", data.sources.market || "Unavailable"]];
  return <main className="mx-auto max-w-7xl px-4 py-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium uppercase tracking-widest text-blue-600">Macro liquidity</p><h1 className="mt-2 text-3xl font-bold">Crypto Liquidity</h1><p className="mt-2 max-w-2xl text-gray-600">追蹤 stablecoin 供應、ETF 資金、BTC 市值與成交量，判斷資金是否正在進入 Crypto 生態系。</p></div><div className={`rounded-lg border px-4 py-3 text-right ${biasClass}`}><div className="text-xs">Liquidity Bias</div><div className="text-lg font-semibold">{biasLabel(data.liquidityBias)}</div><div className="text-xs opacity-70">As of {new Date(data.asOf).toLocaleString()}</div></div></div><div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">{cards.map(([title, value, change, source]) => <div key={title} className="rounded-xl border bg-white p-5 shadow-sm"><div className="text-sm text-gray-500">{title}</div><div className="mt-3 text-2xl font-bold">{value}</div><div className="mt-2 text-sm text-gray-600">{change}</div><div className="mt-4 text-xs text-gray-400">Source: {source}</div></div>)}</div><section className="mt-8 rounded-xl border bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Liquidity trend (indexed to 100)</h2><p className="text-sm text-gray-500">用相對變化比較 stablecoin supply 與 BTC market cap。</p></div><div className="flex gap-1 rounded-lg bg-gray-100 p-1">{[30, 90, 365].map((range) => <button key={range} onClick={() => setDays(range)} className={`rounded-md px-3 py-1 text-sm ${days === range ? "bg-white font-medium shadow-sm" : "text-gray-600"}`}>{range === 365 ? "1Y" : `${range}D`}</button>)}</div></div><div className="mt-5"><IndexedChart stablecoin={data.stablecoin.history} market={data.market.history} days={days} /></div></section><section className="mt-8 grid gap-5 md:grid-cols-2"><div className="rounded-xl border bg-white p-5 shadow-sm"><h2 className="text-lg font-semibold">Bias reasons</h2><ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-gray-600">{data.biasReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div><div className="rounded-xl border bg-white p-5 shadow-sm"><h2 className="text-lg font-semibold">Data sources & limitations</h2><p className="mt-3 text-sm text-gray-600">Stablecoin supply 使用 DeFiLlama 的 USDT + USDC；BTC 市值與成交量使用 CoinPaprika 免費一年歷史資料。BTC 不是全 Crypto 市值。ETF provider 尚未設定時，不會將 ETF 缺資料計入 Bias。</p><p className="mt-3 text-xs text-gray-400">這些是流動性背景指標，不是交易建議。</p></div></section><p className="mt-6 text-sm text-gray-500">想查看完整股票分析？<Link className="ml-1 underline" href="/scanner">前往 VP Scanner</Link></p></main>;
}
