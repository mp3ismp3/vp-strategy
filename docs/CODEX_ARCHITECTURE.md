# VP Strategy — Codex 架構記憶

> 本文件是 Codex 的 repository map，描述目前程式碼的實際邊界、資料流與變更入口。開始任何修改前先讀本文件與根目錄 `AGENTS.md`；若兩者與程式碼不一致，以程式碼為準並同步修正文檔。

## 1. 系統定位與不變條件

這是一個以 Market Auction Theory 為核心的美股分析平台。Python 分析層以同步批次工作為主，資料主要落在 JSON；Web 產品層使用 Next.js、Supabase、NextAuth、Stripe 與 Upstash。

核心不變條件：

- Python 分析流程保持同步，不引入 async 資料管線。
- Scanner 與 Accumulation 是獨立分析系統，不互相 import。
- 依賴關係遵守第 3 節矩陣；策略之間不可互相 import，`regime/` 不可依賴 `strategies/`。
- `StrategySignal`、`scan_results.json` 與既有 accumulation state 欄位須向後相容。
- 策略計算不可使用未來資料；測試不可連線 yfinance、Telegram、Teams、Stripe 或 Supabase。
- `data/accum_state.json` 是 CI 持久狀態，日常開發不可手動修改或提交。

## 2. Repository 地圖

```text
vp-strategy/
├── core/                         # 市場資料、純指標、VP、auction primitives、signal contract
├── regime/                       # 市況分類與策略信任權重
├── strategies/                   # VP/VWAP/Trend 與 Accumulation 分析
│   └── accumulation/             # score、phase、trigger、tracker、通知格式
├── scoring/                      # legacy/intraday confidence scoring
├── notifications/                # Telegram、Teams transport/format adapter
├── services/
│   ├── frontend/                 # Next.js Web app、API routes、auth/paywall/rate limit
│   └── telegram-bot/             # Telegram webhook bot 與訂閱者通知 router
├── data/                         # runtime JSON/cache；不是業務邏輯來源碼
├── tests/                        # Python pytest，使用 synthetic data/mock
├── docs/                         # 設計、部署、訂閱與本架構文件
├── deploy/                       # Docker Compose 與環境範本
├── .github/workflows/            # tests、daily scan、pre-market、manual backtest
└── *.py                          # batch entry points、backtests、export/upload jobs
```

## 3. 核心 Python 分層

### `config.py`

集中管理掃描標的與經回測調校的預設值：`SYMBOLS`、`SECTOR_MAP`、`DEFAULT_CFG`、`SCORING_WEIGHTS`、`REGIME_THRESHOLDS`。變更預設值、權重或門檻必須跑相關測試及 `python backtest_multi.py`。

### `core/`

- `data_provider.py`：`DataProvider` abstraction 與 `YahooProvider`；提供日線/盤中 batch download、欄位正規化和本地 cache。
- `data.py`：較簡單的 yfinance 單檔/批次下載 helper，仍被部分流程使用。
- `indicators.py`：純計算層。包含 VP、ATR、VWAP/AVWAP、Donchian、EMA、trend bias、MACD divergence、FVG 等。
- `vp_multitf.py`：將日線 resample 成周/月線，計算 daily/weekly/monthly VP 與價格位置。
- `auction.py`：VA migration、Initial Balance、single prints、poor highs/lows。
- `market_context.py`：取得 VIX、SPY 狀態等市場背景。
- `signal.py`：`StrategySignal` 與 `TRACK_MAP` 的公共契約。
- `base_strategy.py`：所有正式策略的抽象介面 `detect(df, cfg, market_ctx)`。

此層應保持可測、低副作用；指標計算不得 import strategy、scoring、UI 或通知模組。

### 允許依賴矩陣

| Importer | 可依賴 | 不可依賴／備註 |
|---|---|---|
| `core/indicators.py`, `core/vp_multitf.py`, `core/auction.py` | core 內較底層模組與第三方數值套件 | 不得依賴 regime、strategies、scoring、UI、通知 |
| `core/data_provider.py`, `core/data.py`, `core/market_context.py` | config、第三方資料來源、cache/file IO | 這些是 core 的 IO 邊界，不宣稱為純函數 |
| `regime/` | config、core indicators | 不得依賴 strategies 或 scoring |
| `strategies/vp_signals.py`, `vwap_signals.py`, `trend_signals.py` | config、core、regime（需要時） | 策略檔彼此不得 import；不得依賴 scoring |
| `strategies/inst_trend.py` | config、core | 可被 legacy scoring 使用，不得反向 import scoring |
| `strategies/accumulation/` | 同子系統 config/helpers、數值套件 | 與 VP/VWAP/Trend strategies 保持獨立，不依賴 scoring |
| `scoring/confidence.py` | config、core、`strategies.inst_trend` | `strategies.inst_trend` 是目前 legacy 例外；不要形成反向依賴 |
| 根目錄 entry points | 上述分析層、notifications | 負責 orchestration 與輸出，不應被分析層反向 import |
| frontend、bot、upload jobs | JSON/Supabase/API contracts | downstream consumer，不得成為策略計算依賴 |

若新增依賴不符合矩陣，先調整設計；不要把現有 `scoring → strategies.inst_trend` 誤判成待順手修正的 bug。

### `regime/`

`engine.py` 產生 `RegimeState`，把市場分為 `range`、`trend`、`expansion`、`compression`，並正規化 VP/VWAP/TrendFollowing 的 trust。只能依賴 config 與 core 指標。

### `strategies/`

- `vp_signals.py`：VA Rejection、Failed Auction、Breakout Retest/Acceptance 等 VP 訊號。
- `vwap_signals.py`：VWAP Deviation/Reclaim、AVWAP Pullback 等。
- `trend_signals.py`：Compression Breakout、EMA Cross 等 trend signals。
- `inst_trend.py`：institutional trend/market structure 計算與策略封裝。
- `accumulation/`：另一套有跨日 state 的 Wyckoff pipeline，詳見第 5 節。

每個正式 strategy 都繼承 `BaseStrategy`，回傳 `list[StrategySignal]`；新增 signal type 時同步更新 `TRACK_MAP` 和測試。

### `scoring/`

`confidence.py` 為 legacy/盤中流程提供 regime、stock factors 與信心評分。它不是 Accumulation decay score，也不是 Next.js 訂閱方案評分。

## 4. VP Scanner 與輸出鏈

主要入口：`scan_all.py`

```text
config.SYMBOLS + DEFAULT_CFG
        ↓
fetch_market_context()
        ↓
YahooProvider.batch_daily(1y)
+ YahooProvider.batch_intraday(1h, cached)
        ↓
compute_vp_multitf()
  ├─ daily VP
  ├─ weekly VP
  └─ monthly VP
        ↓
auction enrichments
(VA migration / IB / single prints / poor highs-lows)
        ↓
data/scan_results.json
        ├─ Telegram + Teams summary
        ├─ export_frontend_data.py
        ├─ fusion_report.py
        └─ upload_to_supabase.py → Supabase → Next.js API/UI
```

`scan_results.json` 頂層契約為 `scan_time`、`market_ctx`、`total_symbols`、`vp_data`。UI 與上傳流程依賴此格式，不可任意改名或改巢狀結構。寫出前會移除 VP histogram，避免 JSON 過大。

相關輔助入口：

- `pre_market.py`：依 VP 邊界距離產生盤前 watchlist。
- `intraday.py`：用已完成的 1H candle 確認 VP pattern，再以 legacy confidence scoring 過濾。
- `macd_scan.py`：批次掃描日/周 MACD divergence 並格式化通知。
- `export_frontend_data.py`：整理 OHLC/VP chart payload 至 `data/frontend_charts.json`。

## 5. Accumulation Tracker

主要入口：`accumulation.py`

```text
yfinance: symbol 6mo + SPY + VIX context
        ↓
detector.compute_daily_score()
  → raw score + support_primary/support_dynamic/resistance
        ↓
phase_classifier.classify_phase()
  → A/B/C/D/E/UNKNOWN
        ↓
accumulation.check_failure()
  → spring / soft failure / hard failure
        ↓
AccumulationTracker.update()
  → entry / decay / promote / demote / exit
        ↓
entry_triggers.check_triggers()
  → Spring / LPS / SOS + pending day-2 confirmation
        ↓
data/accum_state.json
        ├─ accumulation notifications
        ├─ Fusion readers
        ├─ Supabase upload
        └─ CI auto-commit
```

模組責任：

- `config.py`：Accumulation thresholds、decay/promotion rules、`STATE_FILE`。
- `detector.py`：六組 accumulation evidence 與 levels，回傳每日 raw score。
- `phase_classifier.py`：只分類 Wyckoff phase，不管理跨日 state。
- `entry_triggers.py`：Spring/LPS/SOS、環境 gate、停損上限、pending confirmation。
- `tracker.py`：state load/save、decay、tier 升降、failure 與 trigger 去重。
- `notifications.py`：daily/trigger/proximity message formatting 與截斷。

State 每個 ticker 的既有欄位是相容性契約。新增欄位必須在舊 JSON 缺欄位時有 default，並驗證 load/save round trip。

## 6. Fusion 與產品服務

### Fusion

`fusion_report.py` 讀取 `scan_results.json` 與 `accum_state.json`，合併 macro VP direction、Wyckoff phase/triggers、red flags 與交易 levels。它是 downstream consumer，不應回寫 Scanner 或 Tracker 的計算狀態。Web 層的 trigger contract 相容 legacy string 與 `{type, date?}` object，UI 統一顯示 trigger type。

### Next.js `services/frontend/`

- `src/app/**/page.tsx`：scanner、accumulation、fusion、strategy、indicator、liquidity、FVG、MACD、account/pricing 等頁面。
- `src/app/api/data/*`：唯一的 Web production analysis data 邊界。訪客回 `401`；Free 由 server 裁切為 7 檔與 Accumulation 前 10 名摘要；Pro 取得完整一般分析；Fusion 僅 Premium。Client 不得直接以 anon key 讀 analysis tables。
- `src/app/api/auth/*`、`src/lib/auth.ts`：NextAuth/Supabase authentication。
- `src/app/api/stripe/*`、`src/lib/stripe.ts`：checkout、portal、webhook。Checkout 由 `STRIPE_CHECKOUT_ENABLED` 控制，Price ID 僅從 server-side allowlist 取得；`stripe-config.ts` 隔離 Test/Live mode，並為 Customer/30 分鐘同方案 pending Checkout 提供冪等保護，方案不一致時回傳衝突。已有有效訂閱者不得透過 Checkout 直接切換 Pro/Premium；Portal session 固定使用 `STRIPE_PORTAL_CONFIGURATION_ID` 指定的無方案切換設定，只提供付款方式、發票、取消與恢復。`stripe-webhook.ts` 以 event ledger 與 observed timestamp CAS 提供冪等 claim/retry，取消通知在 ledger 完成後才 best-effort 發送，延遲的舊訂閱刪除事件會保留較新的有效訂閱。
- `src/lib/billing.ts`、`billing_customers`、`billing_subscriptions`、`billing_events`：provider-neutral 金流契約。`billing_checkout_intents` 以 user row lock 與 partial unique index 原子保留跨 Stripe/ECPay Checkout；`billing_subscriptions` 是權威來源，DB transaction 會跨 provider 選擇仍有效的最高 entitlement 寫入 `users` snapshot。任何單一 provider 的延遲取消不得覆寫另一個 provider 的有效權益。所有付費 entitlement 都要求 active/trialing 且 `current_period_end` 尚未到期；缺失或過期即 fail-closed。Billing tables、checkout intent、cancel outbox、`users`、`telegram_bind_tokens`、`subscription_events` 均啟用 RLS並撤除 anon/authenticated grants，只允許 service role。Event payload 僅保存必要摘要，processed events 預設保留 90 天。
- `src/app/api/ecpay/*`、`src/lib/ecpay.ts`：台灣新訂閱的綠界信用卡定期定額 adapter。ReturnURL 與 PeriodReturnURL 必須驗 MerchantID 與 SHA256 CheckMacValue、拒絕金額不符與模擬付款開通；OrderResultURL 只導頁。Callback 只負責驗簽/正規化，event、subscription 與 entitlement 由 `apply_ecpay_callback` transaction RPC 一次提交。取消先寫 `billing_cancel_outbox` 再呼叫 CreditCardPeriodAction，重試會先以 `QueryCreditCardPeriodInfo` 判斷 provider 是否已終止。`admin/ecpay-reconcile` 逐筆核對 provider 金額/執行狀態並可送告警。
- `src/app/api/admin/stripe-reconcile/route.ts`、`stripe-reconciliation.ts`：限 `ADMIN_EMAILS` 管理員使用的 Stripe/Supabase reconciliation。預設 dry-run；只有單一或零個非終止訂閱才可 apply，多重訂閱必須人工處理。
- `supabase_billing_hardening.sql`：既有 Supabase 專案的 Stripe production-readiness 增量 migration；`supabase_migration.sql` 建立新環境 base schema，新環境與既有環境都必須再套用最新版 `supabase_billing_providers.sql` 取得完整 transaction RPC 與 outbox contract。
- `src/lib/plans.ts`、`Paywall.tsx`：方案權限與前端 gate。Client 方案 snapshot 必須綁定 session email；帳號不匹配或尚未完成查詢時 fail-closed，不得沿用前一個帳號的付費狀態。
- `src/lib/rate-limit.ts`、`proxy.ts`：Next.js 16 request proxy，負責 Upstash rate limit 與登入頁面保護。
- `public/ptrade.svg`：前端共用品牌 icon，由首頁、登入頁、Navbar 與 root metadata 的瀏覽器 icon 引用。

`src/app/api/data/scan-results`、`chart-data`、`accum-state` 以 server-side service role 讀取 CI 上傳至 Supabase 的 production rows，再依有效方案裁切；不得退回 client-side anon query 或依賴未部署的 frontend JSON。

Web entitlement boundary：未登入訪客不得讀 production data。登入 Free 可讀 Mega Cap Tech 7 檔即時資料與 Accumulation 前 10 名非行動摘要；Pro 解鎖全部一般分析、levels/triggers 與 Strategy Lab；Premium 另解鎖 Fusion，以及 Telegram 綁定與即時信號。Free/Pro 不可產生或兌換 Telegram 綁定碼。Supabase analysis tables 撤除 anon/authenticated access，client pages 一律透過 server API；UI Paywall 不取代 server authorization。

修改 frontend 前另讀 `services/frontend/AGENTS.md`，使用 `npm`/`package-lock.json`，至少依變更執行 lint、test、build 中適用的 checks。

### Supabase 與 Telegram bot

- `upload_to_supabase.py`：把 scan、chart、accum JSON 清理後 upsert 至 Supabase。
- `services/telegram-bot/bot.py`：Telegram webhook/bot commands 與 Premium-only 帳號綁定；Next.js webhook 先驗 secret header，Python/Next.js 都以同一 transaction RPC 原子完成 token claim、Premium entitlement 檢查與 bind。
- `services/telegram-bot/notification_router.py`：讀 Supabase 訂閱者並分發 scanner/accumulation 摘要；與 bot 共用 `entitlement.py`，所有付費狀態均依週期截止時間 fail-closed，不依賴使用者再次登入網站。
- `setup_telegram_webhook.py`：部署時設定 webhook；屬外部狀態變更，不可當一般測試執行。

## 7. Runtime 資料與外部邊界

| 資料/服務 | Producer | Consumer | 注意事項 |
|---|---|---|---|
| `data/scan_results.json` | `scan_all.py` | Fusion、export、upload | schema 穩定；不進 git |
| `data/accum_state.json` | `AccumulationTracker` | accumulation、Fusion、upload | CI auto-commit；欄位向後相容 |
| `data/frontend_charts.json` | `export_frontend_data.py` | `upload_to_supabase.py` | 衍生資料，可重建 |
| `data/cache/` | `YahooProvider` | scanner/export jobs | runtime cache，可重建 |
| Yahoo Finance | data providers/entry points | Python analysis | 測試一律 mock |
| Telegram/Teams | notification adapters/jobs | 外部使用者 | 只用 dry-run 驗證；Telegram ≤4096 chars |
| Supabase | upload job、Next.js API、bot | Web/bot | service key 只能在 server/CI |
| Stripe | Next.js API routes | subscription state | webhook 驗簽；Test/Live customer 分離；event ledger 去重並在同步失敗時回 5xx；不得用測試觸發 live mutation |

## 8. CI 與部署流程

- `tests.yml`：push/PR 執行 Python pytest。
- `vp_scanner.yml`：平日 21:05 UTC 依序跑 scanner、accumulation、MACD、chart export、Supabase upload、subscriber notification，最後 auto-commit accumulation state。
- `pre_market.yml`：平日 13:00 UTC 執行盤前 watchlist。
- `backtest.yml`：手動觸發 multi-strategy backtest。
- `deploy/docker-compose.yml`：部署服務編排；`.env.example` 只列變數名稱，不放 secrets。

Cron 對應美股時段，不可順手調整。Daily workflow 的順序有資料依賴：scan/accumulation 必須先於 export/upload/notification。

## 9. 測試與變更路由

先用 `.agents/skills/vp-strategy-workflow/scripts/select_checks.py` 依 diff 選 checks；常用對應如下：

| 修改範圍 | 最少驗證 |
|---|---|
| `core/indicators.py`, `core/vp_multitf.py`, `core/auction.py` | indicators/VP/相關 scanner tests |
| `regime/` | `tests/test_regime.py` |
| VP/VWAP/Trend strategies | 對應 strategy tests；訊號行為變更另跑 backtest |
| `strategies/accumulation/`, `accumulation.py` | 全部 accumulation、phase、entry trigger tests |
| `scoring/`、權重、門檻、預設值 | scoring/strategy tests + backtest |
| `notifications/` | notification tests + dry-run，禁止真實發送 |
| `services/frontend/` | `npm run lint`、`npm test`、`npm run build` 中適用者 |
| `.github/workflows/` | YAML parse/review + workflow 內實際 command |
| 純文件 | link/path、Markdown 結構與完整 diff review |

任何 production logic 新增或修改都採 test-first；使用 synthetic OHLCV 與 mock external APIs。策略邏輯、調校參數或 scoring 變更需報告 backtest 前後差異。

## 10. Codex 修改前快速清單

1. 讀根 `AGENTS.md`、本文件，以及目標路徑最近的 `AGENTS.md`。
2. 看 `git status`，保留使用者既有修改與 runtime state。
3. 找到真正 producer、consumer、schema 與外部 side effect。
4. 只改最小範圍；production behavior 先寫 failing test。
5. 不跨越 import 邊界、不破壞 JSON/`StrategySignal` contract、不使用 future data。
6. 跑 select-checks、所有受影響 checks；必要時跑完整 pytest/backtest/frontend build。
7. 若是功能修正或新增功能，同步更新根目錄 `README.md` 的行為、使用方式或限制。
8. review 完整 diff，確認 README 與實作一致，且沒有 state、cache、secret 或 generated file 混入。
9. 若使用者要求 commit，commit 前必須由獨立 sub-agent 依 `AGENTS.md` checklist review 至 PASS。

Repository 的 `scripts/pre-commit` 會實際強制文件同行：production code 變更必須 staged `README.md`；核心契約、state schema、workflow、部署拓撲或 production module 結構變更必須 staged 本文件。Hook 無法判斷文字語意是否正確，因此 reviewer 仍須比較文件與完整實作 diff。

人工與 AI agent 的 Git 交付只能走 Pull Request：從 `main` 建立 `feat/*`、`fix/*`、`refactor/*` 或 `chore/*` 工作 branch，review 與 commit 後 push 該 branch，再建立以 `main` 為 base 的 PR。不得直接 push `main`；`scripts/pre-push` 會阻擋目標 ref 為 `refs/heads/main` 的本地 push，並拒絕不符合命名規則的新增或更新 branch。Tag 與刪除非 main branch 不受命名檢查影響。唯一例外是 `vp_scanner.yml` 由 GitHub Actions bot 自動持久化 `data/accum_state.json`。GitHub branch protection 仍是遠端最終防線，local hook 不取代 repository ruleset。

## 11. 文件維護規則

以下情況必須同步更新本文件：

- 新增/移除入口、服務、核心目錄或資料檔。
- 改變 producer → consumer 資料流、JSON schema 或外部服務邊界。
- 改變策略/模組依賴方向、CI job 順序或部署拓撲。
- 測試指令與變更 gate 有實質改動。

此外，每次功能修正（含 bug fix）或新增功能都必須同步更新根目錄 `README.md`，即使不需要修改本架構文件；README 至少要反映該功能目前的行為、使用方式或限制。

純函數內部實作、文案或不影響架構的局部 bug fix，不需要逐次更新本文件。
