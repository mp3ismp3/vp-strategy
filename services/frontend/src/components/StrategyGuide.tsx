"use client";

import { useState } from "react";

interface StrategyGuideProps {
  type: "scanner" | "accumulation";
}

export function StrategyGuide({ type }: StrategyGuideProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* 右下角浮動按鈕 */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 bg-black text-white px-4 py-3 rounded-full shadow-lg hover:bg-gray-800 transition z-50 flex items-center gap-2"
      >
        <span>📖</span>
        <span className="text-sm font-medium">策略教學</span>
      </button>

      {/* 彈窗 */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* 背景遮罩 */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />

          {/* 內容 */}
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center rounded-t-2xl">
              <h2 className="text-lg font-bold">
                {type === "scanner" ? "📖 拍賣理論操作指南" : "📖 Wyckoff 吸籌教學"}
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-500 hover:text-gray-700 text-xl"
              >
                ✕
              </button>
            </div>

            <div className="p-6">
              {type === "scanner" ? <ScannerGuide /> : <AccumulationGuide />}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ScannerGuide() {
  return (
    <div className="space-y-6 text-sm">
      <div>
        <h3 className="font-bold text-green-800 mb-2">🟢 做多時機</h3>
        <ul className="space-y-2 ml-4 list-disc text-gray-700">
          <li>
            <b>VA Rejection</b> — 價格跌到 VAL 被拒絕（買方守住）
            <br />
            <span className="text-gray-500">→ 在 VAL 附近出現長下影線 or 紅轉綠</span>
          </li>
          <li>
            <b>Failed Auction</b> — 跌破 VA 又快速收回（下方沒人接受）
            <br />
            <span className="text-gray-500">→ 跌破 VAL 後 1-2 天內收回 VA 內</span>
          </li>
          <li>
            <b>Breakout Retest</b> — 突破 VAH 後回踩守住（接受新價值）
            <br />
            <span className="text-gray-500">→ 突破 VAH → 回踩 VAH 不破 → 再上</span>
          </li>
        </ul>
      </div>

      <div>
        <h3 className="font-bold text-red-800 mb-2">🔴 做空 / 觀望時機</h3>
        <ul className="space-y-2 ml-4 list-disc text-gray-700">
          <li>
            <b>VAH Rejection</b> — 價格漲到 VAH 被壓回
            <br />
            <span className="text-gray-500">→ 在 VAH 附近出現長上影線 or 綠轉紅</span>
          </li>
          <li>
            <b>Failed Breakout</b> — 突破 VAH 又跌回（假突破）
            <br />
            <span className="text-gray-500">→ 突破 VAH 後無量、隔天跌回 → 空</span>
          </li>
          <li>
            <b>遠超 100%</b> — 已漲一段，勿追高
            <br />
            <span className="text-gray-500">→ 三個 TF 都 &gt;120% = 過熱，等回踩</span>
          </li>
        </ul>
      </div>

      <div className="bg-blue-50 rounded-lg p-4">
        <h3 className="font-bold text-blue-900 mb-2">📊 多時間框架搭配</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left border-b">
              <th className="py-1">月/周線</th>
              <th className="py-1">日線</th>
              <th className="py-1">建議</th>
            </tr>
          </thead>
          <tbody className="text-gray-700">
            <tr className="border-b"><td>Above VA</td><td>Inside VA</td><td>偏多，等碰 VAL 做多</td></tr>
            <tr className="border-b"><td>Above VA</td><td>Below VA</td><td>觀察 Failed Auction 做多</td></tr>
            <tr className="border-b"><td>Below VA</td><td>Inside VA</td><td>偏空，等碰 VAH 做空</td></tr>
            <tr className="border-b"><td>Inside VA</td><td>Inside VA</td><td>區間：碰 VAL 做多、碰 VAH 做空</td></tr>
          </tbody>
        </table>
      </div>

      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="font-bold mb-2">💡 百分比怎麼看</h3>
        <ul className="space-y-1 text-gray-700">
          <li><b>0%</b> = 價格在 VAL（支撐線）</li>
          <li><b>50%</b> = 價格在 POC（公允價值）</li>
          <li><b>100%</b> = 價格在 VAH（壓力線）</li>
          <li><b>&gt;100%</b> = Above VA（已突破）</li>
          <li><b>&lt;0%</b> = Below VA（已跌破）</li>
        </ul>
      </div>
    </div>
  );
}

function AccumulationGuide() {
  return (
    <div className="space-y-6 text-sm">
      <div>
        <h3 className="font-bold mb-2">📈 Wyckoff 吸籌階段</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left border-b">
              <th className="py-1">Phase</th>
              <th className="py-1">名稱</th>
              <th className="py-1">特徵</th>
              <th className="py-1">動作</th>
            </tr>
          </thead>
          <tbody className="text-gray-700">
            <tr className="border-b"><td className="font-bold">A</td><td>Stopping</td><td>大跌停止，賣出高潮</td><td>僅觀察</td></tr>
            <tr className="border-b"><td className="font-bold">B</td><td>Building</td><td>區間震盪，OBV 上升</td><td>加入觀察清單</td></tr>
            <tr className="border-b bg-purple-50"><td className="font-bold">C</td><td>Spring ⭐</td><td>假跌破支撐 + 快速收回</td><td>PILOT BUY 10-25%</td></tr>
            <tr className="border-b bg-green-50"><td className="font-bold">D</td><td>Trending</td><td>Higher Lows + 放量反彈</td><td>ADD 25-40%</td></tr>
            <tr className="border-b"><td className="font-bold">E</td><td>Markup</td><td>突破阻力 + 量確認</td><td>持有 / Trailing Stop</td></tr>
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="font-bold text-orange-800 mb-2">⚡ 入場觸發條件</h3>
        <div className="space-y-3">
          <div className="bg-purple-50 rounded-lg p-3">
            <p className="font-bold">🌊 Spring（Phase C）</p>
            <p className="text-gray-600">跌破動態支撐 → 收盤收回支撐上方 → 量 &gt; 1.5x median</p>
            <p className="text-purple-700 font-medium">→ PILOT BUY 10-25% 倉位</p>
          </div>
          <div className="bg-green-50 rounded-lg p-3">
            <p className="font-bold">📈 LPS — Last Point of Support（Phase D）</p>
            <p className="text-gray-600">回踩前低附近 → 量縮 &lt; 0.7x → 守住不破</p>
            <p className="text-green-700 font-medium">→ ADD 25-40% 倉位</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-3">
            <p className="font-bold">🚀 SOS Breakout — Sign of Strength（Phase D）</p>
            <p className="text-gray-600">突破阻力線 → 量 &gt; 1.5x median → 收盤站穩</p>
            <p className="text-blue-700 font-medium">→ FULL POSITION</p>
          </div>
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="font-bold mb-2">💡 Score 分數解讀 (0-18)</h3>
        <ul className="space-y-1 text-gray-700">
          <li><b>12-18</b> — 🟢 強烈吸籌跡象，密切關注觸發</li>
          <li><b>9-11</b> — 🟡 可能在吸籌，持續觀察</li>
          <li><b>6-8</b> — ⚪ 不確定，等分數上升</li>
          <li><b>0-5</b> — 🔴 不符合吸籌特徵</li>
        </ul>
        <p className="text-xs text-gray-500 mt-2">
          Decay Score = 帶衰減的累積分數，反映持續性。Confirmed = 連續多天 ≥9 分。
        </p>
      </div>
    </div>
  );
}
