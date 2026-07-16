import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="flex flex-col items-center justify-center min-h-[70vh] text-center px-4">
        <div className="text-6xl mb-6">💰</div>
        <h1 className="text-4xl md:text-5xl font-bold text-gray-900 leading-tight max-w-3xl">
          Market Auction Theory
          <br />
          交易分析平台
        </h1>
        <p className="mt-6 text-lg text-gray-600 max-w-2xl">
          Volume Profile 多時間框架分析 + Wyckoff 機構吸籌追蹤。
          <br />
          即時 Telegram 信號通知，幫你找到最佳入場時機。
        </p>
        <div className="mt-8 flex gap-4">
          <Link
            href="/pricing"
            className="bg-black text-white px-8 py-3 rounded-md font-medium hover:bg-gray-800 text-lg"
          >
            開始 7 天免費試用
          </Link>
          <Link
            href="/login"
            className="border border-gray-300 px-8 py-3 rounded-md font-medium hover:bg-gray-50 text-lg"
          >
            登入
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">兩大核心系統</h2>
          <div className="grid md:grid-cols-2 gap-8">
            {/* VP Scanner */}
            <div className="bg-white rounded-xl p-8 shadow-sm border">
              <div className="text-3xl mb-4">📊</div>
              <h3 className="text-xl font-bold mb-3">VP Position Viewer</h3>
              <p className="text-gray-600 mb-4">
                日線 / 周線 / 月線 Volume Profile，一眼看出價格相對公允價值的位置。
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>✓ 免費看 Mega Cap Tech 7 檔</li>
                <li>✓ Pro 解鎖全部 78 檔 AI 美股</li>
                <li>✓ 多時間框架共識分析</li>
                <li>✓ K 線圖 + VP Histogram</li>
              </ul>
            </div>

            {/* Accumulation */}
            <div className="bg-white rounded-xl p-8 shadow-sm border">
              <div className="text-3xl mb-4">🔍</div>
              <h3 className="text-xl font-bold mb-3">Accumulation Tracker</h3>
              <p className="text-gray-600 mb-4">
                Wyckoff 機構吸籌追蹤，跨天累積狀態，在突破前提早發現。
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>✓ 6 指標每日評分（0-18）</li>
                <li>✓ Wyckoff Phase A-E 自動分類</li>
                <li>✓ Spring / LPS / SOS 入場觸發</li>
                <li>✓ Pro 方案解鎖</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-12">如何運作</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <div className="text-4xl mb-4">1️⃣</div>
              <h3 className="font-bold mb-2">每日自動掃描</h3>
              <p className="text-gray-600 text-sm">
                美股收盤後，系統自動分析 62 檔標的的 VP 位置和累積狀態
              </p>
            </div>
            <div>
              <div className="text-4xl mb-4">2️⃣</div>
              <h3 className="font-bold mb-2">即時信號推送</h3>
              <p className="text-gray-600 text-sm">
                觸發條件成立時，Telegram 私訊通知你入場時機和建議倉位
              </p>
            </div>
            <div>
              <div className="text-4xl mb-4">3️⃣</div>
              <h3 className="font-bold mb-2">Web 儀表板</h3>
              <p className="text-gray-600 text-sm">
                隨時查看完整圖表、歷史信號、多策略綜合分析
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-black text-white text-center">
        <div className="max-w-3xl mx-auto px-4">
          <h2 className="text-3xl font-bold mb-4">準備好了嗎？</h2>
          <p className="text-gray-400 mb-8">7 天免費試用，不滿意隨時取消。</p>
          <Link
            href="/pricing"
            className="bg-white text-black px-8 py-3 rounded-md font-medium hover:bg-gray-100 text-lg"
          >
            查看方案
          </Link>
        </div>
      </section>
    </div>
  );
}
