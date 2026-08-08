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
          先瀏覽市場結構，登入即可解鎖完整預覽。
        </p>
        <div className="mt-8 flex gap-4">
          <Link
            href="/scanner"
            className="bg-black text-white px-8 py-3 rounded-md font-medium hover:bg-gray-800 text-lg"
          >
            免費瀏覽 Scanner
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
          <h2 className="text-3xl font-bold text-center mb-12">四大策略工具</h2>
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-8">
            {/* VP Scanner */}
            <div className="bg-white rounded-xl p-8 shadow-sm border">
              <div className="text-3xl mb-4">📊</div>
              <h3 className="text-xl font-bold mb-3">VP Position Viewer</h3>
              <p className="text-gray-600 mb-4">
                日線 / 周線 / 月線 Volume Profile，一眼看出價格相對公允價值的位置。
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>✓ 免費方案可看 Mega Cap Tech 7 檔</li>
                <li>✓ Pro 解鎖完整 Scanner 清單</li>
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
                <li>✓ 未登入可查看 Decay Score 前 10 名</li>
                <li>✓ 登入解鎖完整排行榜</li>
              </ul>
            </div>

            {/* Indicator */}
            <div className="bg-white rounded-xl p-8 shadow-sm border">
              <div className="text-3xl mb-4">📉</div>
              <h3 className="text-xl font-bold mb-3">Indicator Suite</h3>
              <p className="text-gray-600 mb-4">
                MACD 背離、FVG 與 Liquidity Sweep，集中查看技術結構信號。
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>✓ 未登入限 Mega Cap Tech</li>
                <li>✓ 未登入信號以馬賽克預覽</li>
                <li>✓ 登入解鎖完整標的與信號</li>
              </ul>
            </div>

            {/* Strategy Lab */}
            <div className="bg-white rounded-xl p-8 shadow-sm border">
              <div className="text-3xl mb-4">⚡</div>
              <h3 className="text-xl font-bold mb-3">Strategy Lab</h3>
              <p className="text-gray-600 mb-4">
                將 Wyckoff 結構、RSI 時機與回測績效整合成可執行的交易流程。
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>✓ 回測績效與進場 Checklist</li>
                <li>✓ Spring / LPS / SOS 策略信號</li>
                <li>✓ 未登入可閱讀策略規則</li>
                <li>✓ 登入解鎖即時進場信號</li>
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
                美股收盤後，系統自動分析完整追蹤清單的 VP 位置和累積狀態
              </p>
            </div>
            <div>
              <div className="text-4xl mb-4">2️⃣</div>
              <h3 className="font-bold mb-2">即時信號推送</h3>
              <p className="text-gray-600 text-sm">
                Premium 方案提供 Telegram 即時信號私訊
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
          <h2 className="text-3xl font-bold mb-4">先看看今天的市場結構</h2>
          <p className="text-gray-400 mb-8">不用訂閱即可瀏覽；登入後解鎖完整預覽。</p>
          <Link
            href="/scanner"
            className="bg-white text-black px-8 py-3 rounded-md font-medium hover:bg-gray-100 text-lg"
          >
            開啟 Scanner
          </Link>
        </div>
      </section>
    </div>
  );
}
