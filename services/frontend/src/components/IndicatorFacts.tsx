"use client";

import React, { useState } from "react";
import type { IndicatorReview } from "@/lib/indicator-review";

const statuses = { met: "成立", "not-met": "未成立", "not-applicable": "不適用", unavailable: "資料不足" };

export function IndicatorFacts({ name, reviews, capturedAt }: {
  name: "FVG" | "Sweep";
  reviews: IndicatorReview[];
  capturedAt?: string;
}) {
  const [selected, setSelected] = useState("");
  const review = reviews.find(item => item.title === selected) ?? reviews[0];
  return (
    <section className="rounded-xl border bg-gray-50 p-4 mb-6 text-sm" aria-label={`${name} 事實分析`}>
      <h2 className="text-xl font-bold mb-3">{name} 自動摘要</h2>
      <p className="mb-3 text-gray-600">資料擷取：{capturedAt ?? "未知（保守排除最後一根日 K）"}。分析僅使用已完成日 K，紀錄隨目前頁面篩選條件顯示，預設選取最新紀錄。</p>
      {review && <>
        {(reviews.length > 1 || review.checks.length > 0) && <label className="block mb-4">
          選擇分析紀錄
          <select value={review.title} onChange={event => setSelected(event.target.value)} className="block mt-1 max-w-full border rounded p-2 bg-white">
            {reviews.map((item, index) => <option key={`${item.title}-${index}`} value={item.title}>{item.title}</option>)}
          </select>
        </label>}
        <div className="space-y-2 mb-4">{review.summary.map((sentence, index) => <p key={index}>{sentence}</p>)}</div>
        {review.guidance && review.guidance.length > 0 && <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 mb-4">
          <p className="font-semibold mb-1">後續觀察</p>
          {review.guidance.map((sentence, index) => <p key={index} className="text-gray-700">{sentence}</p>)}
        </div>}
        {review.checks.length > 0 && <div className="overflow-x-auto">
          <table className="w-full text-left">
            <caption className="text-left font-semibold mb-2">{name} 逐項比對</caption>
            <thead><tr className="border-b">
              <th scope="col" className="p-2">條件</th><th scope="col" className="p-2">數據日期</th>
              <th scope="col" className="p-2">結果</th><th scope="col" className="p-2">數值與依據</th>
            </tr></thead>
            <tbody>{review.checks.map(check => <tr key={check.id} className="border-b align-top">
              <th scope="row" className="p-2 font-medium">{check.label}</th>
              <td className="p-2 whitespace-nowrap">{check.date}</td><td className="p-2 whitespace-nowrap">{statuses[check.status]}</td>
              <td className="p-2 min-w-64">{check.evidence}</td>
            </tr>)}</tbody>
          </table>
          <p className="mt-3 text-gray-600">條件使用未四捨五入數值比較；價格與比例顯示至小數兩位。不適用表示缺少比對前提，資料不足表示無法確認。</p>
        </div>}
      </>}
    </section>
  );
}
