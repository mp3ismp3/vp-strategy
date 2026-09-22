import React from "react";
import type { OHLCBar } from "@/lib/macd";
import type { RvolAnalysis } from "@/lib/rvol";
import { buildRvolReview, type RvolCheckStatus } from "@/lib/rvol-review";

const statusLabels: Record<RvolCheckStatus, string> = {
  met: "成立", "not-met": "未成立", "not-applicable": "不適用", unavailable: "資料不足",
};

/** Presentation only: consumes the existing completed-session analysis. */
export function RvolFacts({ analysis, bars }: { analysis: RvolAnalysis; bars: OHLCBar[] }) {
  const { setup } = analysis;
  const latest = bars.at(-1);
  const price = (value: number | undefined) => value !== undefined && Number.isFinite(value) ? `$${value.toFixed(2)}` : "資料不足";
  const volume = (value: number | null) => value !== null && Number.isFinite(value) ? `${value.toFixed(2)}×` : "資料不足";
  const ended = setup?.status === "invalidated" || setup?.status === "expired";
  const review = buildRvolReview(analysis, bars);
  return (
    <section aria-label="已發生事實與判斷條件" className="rounded-lg border bg-gray-50 p-4 mb-4 text-sm">
      <h3 className="font-semibold mb-3">已發生事實與判斷條件</h3>
      <section aria-label="RVOL 自動摘要" className="mb-4 space-y-2">
        <h4 className="font-semibold">RVOL 自動摘要</h4>
        {review.summary.map((sentence, index) => <p key={index}>{sentence}</p>)}
      </section>
      {review.checks.length > 0 && <div className="overflow-x-auto mb-4">
        <table className="w-full text-left">
          <caption className="text-left font-semibold mb-2">RVOL 逐項比對</caption>
          <thead><tr className="border-b">
            <th scope="col" className="p-2">條件</th><th scope="col" className="p-2">數據日期</th>
            <th scope="col" className="p-2">結果</th><th scope="col" className="p-2">數值與依據</th>
          </tr></thead>
          <tbody>{review.checks.map(check => <tr key={check.id} className="border-b align-top">
            <th scope="row" className="p-2 font-medium">{check.label}</th>
            <td className="p-2 whitespace-nowrap">{check.date}</td>
            <td className="p-2 whitespace-nowrap">{statusLabels[check.status]}</td>
            <td className="p-2 min-w-64">{check.evidence}</td>
          </tr>)}</tbody>
        </table>
        <p className="mt-2 text-gray-600">比較使用未四捨五入數值，畫面價格與 RVOL 顯示至小數兩位。不適用表示該日不具備比對前提，資料不足表示無法判斷。</p>
      </div>}
      <details>
      <summary className="cursor-pointer font-medium mb-3">原始事實與規則</summary>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div><dt className="text-gray-600">最新已完成日</dt><dd>{analysis.asOf ?? "資料不足"} · 收盤 {price(latest?.close)} · RVOL {volume(analysis.rvol)}</dd></div>
        {setup ? <>
          <div><dt className="text-gray-600">原突破紀錄</dt><dd>{setup.breakoutDate} · 收盤高於前 20 根日 K 最高價 {price(setup.level)} · 當日 RVOL {volume(setup.breakoutRvol)}</dd></div>
          <div><dt className="text-gray-600">最近事件（歷史紀錄）</dt><dd>{setup.eventDate} · {setup.label} · 事件日 RVOL {volume(setup.eventRvol)}</dd></div>
          <div><dt className="text-gray-600">觀察期限</dt><dd>{ended ? `已結束：${setup.label}` : `突破後第 ${setup.age} 根日 K · 剩餘 ${Math.max(0, 10 - setup.age)} 根`}；突破後超過 10 根日 K 結束觀察。</dd></div>
          <div><dt className="text-gray-600">回踩價格條件（原規則）</dt><dd>最低價 ≤ {price(setup.level + setup.tolerance)}，且收盤 ≥ {price(setup.level)}；需有有效 RVOL。最低價 &lt; {price(setup.level - setup.tolerance)} 再收回，另記為「跌破後收復」。</dd></div>
          <div><dt className="text-gray-600">失效條件（原規則）</dt><dd>觀察期內日 K 收盤 &lt; {price(setup.level)}。</dd></div>
        </> : <div><dt className="text-gray-600">突破紀錄</dt><dd>{bars.length < 21 || analysis.rvol === null ? "資料不足，無法完整判斷量價條件。" : "目前沒有保留中的突破紀錄。"}</dd></div>}
      </dl>
      <p className="mt-3 text-gray-600">量能條件：突破日 RVOL ≥ 1.5 為放量、&lt; 1 為量不足；回踩日 RVOL &lt; 0.7 為縮量、≥ 1.5 為放量。事件日量能與最新日量能分開記錄。</p>
      </details>
    </section>
  );
}
