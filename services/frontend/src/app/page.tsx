import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="px-6 py-14 lg:py-20">
        <div className="mx-auto grid min-h-[72vh] max-w-7xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="max-w-2xl">
            <h1 className="text-5xl font-semibold leading-[0.95] tracking-[-0.055em] text-gray-950 sm:text-6xl lg:text-7xl xl:text-8xl">
              SMART
              <br />
              STRATEGY
            </h1>
            <p className="mt-5 text-2xl font-medium text-gray-900">交易分析平台</p>
            <p className="mt-7 max-w-xl text-lg leading-8 text-gray-600">
              每天自動分析美股走勢，找出關鍵價位與潛在機會。
              <br className="hidden sm:block" />
              快速掌握市場方向，登入即可查看完整分析與交易信號。
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/scanner"
                className="rounded-full bg-blue-600 px-8 py-3.5 text-center text-lg font-semibold text-white transition-colors hover:bg-blue-700"
              >
                免費瀏覽 Scanner
              </Link>
              <Link
                href="/login"
                className="rounded-full border border-gray-300 px-8 py-3.5 text-center text-lg font-semibold text-gray-900 transition-colors hover:bg-gray-50"
              >
                登入
              </Link>
            </div>
          </div>

          <div
            role="img"
            aria-label="動態交易趨勢圖"
            data-testid="animated-trend-chart"
            className="relative min-h-[420px] overflow-hidden rounded-[2.75rem] bg-black shadow-2xl shadow-blue-950/20 sm:min-h-[560px]"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(37, 99, 235, 0.6) 1.2px, transparent 1.3px)",
              backgroundSize: "32px 32px",
            }}
          >
            <svg
              viewBox="0 0 640 560"
              className="absolute inset-0 h-full w-full"
              aria-hidden="true"
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <linearGradient id="trendLine" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#1d4ed8" />
                  <stop offset="55%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#93c5fd" />
                </linearGradient>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
                </linearGradient>
                <filter id="trendGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="7" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <path
                d="M45 430 C105 425 125 365 185 382 S275 440 320 318 S410 275 455 300 S525 205 595 115 L595 500 L45 500 Z"
                fill="url(#trendFill)"
                className="trend-chart-fill"
              />
              <path
                d="M45 430 C105 425 125 365 185 382 S275 440 320 318 S410 275 455 300 S525 205 595 115"
                fill="none"
                stroke="url(#trendLine)"
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray="900"
                filter="url(#trendGlow)"
                className="trend-chart-line"
              />
              <circle
                cx="595"
                cy="115"
                r="10"
                fill="#60a5fa"
                filter="url(#trendGlow)"
                className="trend-chart-point"
              />
            </svg>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">四大策略工具</h2>
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-8">
            {/* VP Scanner */}
            <div className="bg-white rounded-xl p-8 shadow-sm border">
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
