# VP Strategy Platform

基於市場拍賣理論（Market Auction Theory）的交易分析平台。整合兩大獨立系統：

1. **VP Position Viewer** — 日線/周線/月線 Volume Profile，一眼看出價格相對公允價值的位置
2. **Accumulation Tracker** — Wyckoff 機構吸籌追蹤，跨天累積狀態，尋找大行情起點

## 核心理念

> 市場是一個拍賣場。Volume Profile 告訴你「市場認為的公允價格在哪裡」。
> 交易機會出現在**價格與公允價值的互動**——碰到邊緣被拒絕、突破後回測、假突破收回。

---

## 系統架構

```
┌────────────────── VP Position Viewer ────────────────────┐
│                                                           │
│  YahooProvider.batch_daily(62 symbols, 1y)                │
│       ↓                                                   │
│  calc_vp(df, lookback, 0.68)                              │
│  → histogram-based: bin prices → find POC → expand VA     │
│       ↓                                                   │
│  compute_vp_multitf()                                     │
│  → Daily (60天) / Weekly (52週) / Monthly (12月)          │
│       ↓                                                   │
│  Multi-TF Consensus                                       │
│  → 大方向判斷 + 操作建議                                   │
│       ↓                                                   │
│  data/scan_results.json + Telegram                        │
└───────────────────────────────────────────────────────────┘

┌────────────────── Accumulation Tracker ──────────────────┐
│                                                           │
│  yf.download(symbol, 6mo)                                 │
│       ↓                                                   │
│  compute_daily_score() → 6 指標評分 (0-18)                │
│       ↓                                                   │
│  classify_phase() → Wyckoff Phase A/B/C/D/E              │
│       ↓                                                   │
│  check_failure() → hard/soft/spring 判定                  │
│       ↓                                                   │
│  tracker.update() → decay scoring + promote/demote/exit   │
│       ↓                                                   │
│  check_triggers() → Spring / LPS / SOS 入場信號          │
│       ↓                                                   │
│  data/accum_state.json (CI auto-commit) + Telegram        │
└───────────────────────────────────────────────────────────┘
```

---

## VP Position Viewer

### Volume Profile 計算方式

1. 將回看期間的價格範圍切成 100 格 bin
2. 每根 K 棒的成交量平均分配到其 High-Low 所跨越的 bin
3. **POC**（Point of Control）= 量最大的 bin = 市場最接受的價格
4. **Value Area** = 從 POC 往兩側擴展，直到包含 68% 總成交量
5. **VAH** = Value Area 上緣（賣方壓力起始點）
6. **VAL** = Value Area 下緣（買方支撐起始點）

### 多時間框架分析

| 時間框架 | 數據 | 用途 |
|----------|------|------|
| 日線 (60天) | 近 3 個月的日線 VP | 短線交易的價值區間 |
| 周線 (52週) | 近 1 年的周線 VP | 中線 swing 的價值區間 |
| 月線 (12月) | 近 1 年的月線 VP | 大方向判斷 |

### 操作邏輯（拍賣理論）

交易機會在**價格碰到 VA 邊緣的互動**，不是看位置本身：

**做多時機：**
- 價格跌到 VAL 被拒絕（VA Rejection）→ 買方不讓它更低
- 價格跌破 VA 又快速收回（Failed Auction）→ 下方沒人接受
- 價格突破 VAH 後回踩 VAH 守住（Breakout Retest）→ 接受新價值

**做空時機：**
- 價格漲到 VAH 被拒絕 → 賣方壓制
- 價格突破 VAH 又跌回（Failed Auction）→ 上方假突破
- 多時間框架都在 VA 下方且還在往下 → 趨勢空

**多時間框架搭配：**

| 月線/周線 | 日線 | 建議 |
|-----------|------|------|
| Above VA | Inside VA | 大方向偏多，等碰 VAL 做多 |
| Above VA | Below VA | 觀察 Failed Auction 做多機會 |
| Above VA | Above VA | 已走一段，勿追高，等回踩 |
| Below VA | Inside VA | 大方向偏空，等碰 VAH 做空 |
| Below VA | Above VA | 可能假突破，觀察能否站穩 |
| Below VA | Below VA | 已跌一段，勿追空，等反彈 |
| Inside VA | Inside VA | 區間交易：碰 VAL 做多、碰 VAH 做空 |

---

## Accumulation Tracker（Wyckoff 機構吸籌追蹤）

### 設計目的

追蹤哪些股票正被機構悄悄累積，在突破前提早發現。

### Daily Score（每日評分 0-18）

6 個指標，每個 0-3 分：

| 指標 | 偵測什麼 | 3 分條件 |
|------|----------|----------|
| OBV 趨勢 | 資金是否持續流入 | 近期 OBV 斜率加速上升 |
| 收盤位置 | K 線收在上半還是下半 | 平均收盤 ≥ 65% + 下影線 ≥ 8 天 |
| 量能不對稱 | 上漲日 vs 下跌日的量比 | 加權上漲量/下跌量 ≥ 1.4x |
| ATR 收緊 | 波動率是否壓縮 | ATR 百分位 ≤ 15% + 量維持 ≥ 85% |
| 買入連續 | 連續收在上半天數 | 最大連續 ≥ 7 天 或 當前 ≥ 5 天 |
| 相對強度 | SPY 跌它不跌（Beta 調整） | 60%+ 天跑贏 + 正 alpha |

### Wyckoff Phase

```
A (Stopping)   — 大跌停止，出現 Selling Climax
B (Building)   — 區間震盪吸籌，OBV 上升，測試量遞減
C (Spring)     — 假跌破支撐 + 快速收回（洗盤，最佳入場區）
D (Trending)   — Higher Lows + SOS 放量反彈
E (Markup)     — 突破阻力 + 量確認（已起飛）
```

### Entry Triggers

| 觸發 | 適用 Phase | 條件 | 動作 |
|------|-----------|------|------|
| Spring | C | 跌破動態支撐後收回 + 量確認 | PILOT BUY 10-25% |
| LPS | D | 回踩量縮 < 0.7x + 守住前低 | ADD 25-40% |
| SOS Breakout | D/C | 突破阻力 + 量 > 1.5x | FULL POSITION |

---

## 兩系統搭配使用

| | VP Viewer | Accumulation |
|--|---------|--------------|
| 時間視角 | 當下價格位置 | 過去數週的累積過程 |
| 交易類型 | 短/中線 swing | 中長線 swing |
| 有無記憶 | 無（每次獨立計算） | 有（state 跨天累積） |
| 告訴你什麼 | 價格在哪、該注意什麼 | 機構在幹嘛、什麼時候進場 |

**高信心交易 = Accumulation confirmed + VP 位置有利 + 同方向**

例如：
- Accumulation 追蹤 NVDA 在 Phase C（準備突破）
- VP Viewer 顯示 NVDA 日線在 VAL 附近（回踩公允價值）
- → 兩邊同時看好 = 高信心做多位置

---

## 使用方式

### 安裝

```bash
pip install -r requirements.txt
```

### VP 掃描

```bash
python scan_all.py              # 掃描 62 檔 → JSON + Telegram
python scan_all.py --dry-run    # 只印不發
```

### 累積追蹤

```bash
python accumulation.py              # 掃描全部 + 更新 state + Telegram
python accumulation.py NVDA,AMD     # 只掃特定標的
python accumulation.py --dry-run    # 只印不發
python accumulation.py --debug      # 顯示詳細指標分解
```

### Web UI

```bash
cd services/frontend
npm ci
npm run dev
```

Next.js Web 預覽權限：

- 未登入訪客只能使用公開介紹與示例，不得讀取 production 即時分析 API。
- 登入 Free 可查看 Mega Cap Tech 7 檔即時 Scanner／Chart／Indicator，以及 Accumulation Decay Score 前 10 名摘要；摘要不包含支撐、壓力與 triggers。付費方案收錄 2026-08-23 Binance Futures metadata 中仍在交易的 137 個 Equity TradFi 永續合約基礎標的（包含 ETF），其中 92 個為新增分析標的。每檔只隸屬一個產業分類，Binance 合約身分以獨立 badge 呈現，因此不會在分類中重複。頁面與 Yahoo 資料流程不顯示 `USDT`／`USD1` 結算後綴；`BRKB` 會正規化為 `BRK-B`。
- Pro（NT$320／月）解鎖全部標的、完整 Accumulation levels/triggers 與 Strategy Lab 信號。
- Premium（NT$620／月）包含 Pro，另解鎖 Fusion 與 Telegram 帳號綁定／即時信號；Free 與 Pro 都不能產生 Telegram 綁定碼。歷史回顧尚未形成獨立付費功能，正式實作 server-side retention gate 前不列入方案承諾。
- 所有資料裁切與方案驗證都在 server API 執行；前端 Paywall 只負責呈現，不能作為資料安全邊界。
- Subscriber VP 摘要會容忍新上市或資料不足標的缺少日／週／月 timeframe；缺少的 timeframe 不計入 bullish／bearish 共識，不會中斷整批 Telegram 通知。

Web UI 由 `services/frontend/` 的 Next.js 應用提供；舊版 Streamlit `ui/` 已移除，避免兩套介面功能不同步。

Next.js 16 的 request protection 使用 `services/frontend/src/proxy.ts`，集中處理 API rate limit、webhook bypass 與 `/fusion`、`/account` 登入保護。Production data API 以 service role 讀取 CI 上傳到 Supabase 的 scan/chart/accum tables，再於 server 依方案裁切；client 與 anon/authenticated roles 不可直接讀取 production analysis 或敏感訂閱資料。

Web API 定位為隨產品 UI 一同演進的 backend-for-frontend（BFF），不是提供 API key 的公開市場資料 API。`GET /api/health` 可匿名用於 liveness；data routes 使用 NextAuth browser session 並在 server 驗證方案。資料來源故障統一回 `503` 與 `Retry-After`，不把內部 exception 傳給 client。可呼叫路由、權限、錯誤與 gateway contract 見 `docs/API.md`，機器可讀規格見 `services/frontend/openapi.yaml`。

Crypto Liquidity 頁面（`/crypto-liquidity`）提供登入後的 stablecoin supply、BTC market cap 與 BTC spot volume 概覽；stablecoin 歷史由 server-side API 讀取 DeFiLlama 現行 asset endpoint，BTC 一年 daily history 使用 CoinPaprika 免費、免 API Key endpoint。BTC market cap 不代表全 Crypto 市值，UI 與 Bias reasons 會明確標示此限制。單一 provider 暫時失敗時，頁面仍回傳可用的部分資料並將缺項標示為 unavailable，只有所有 upstream 都不可用時才回 `503`。BTC/ETH ETF flow 先保留 provider contract，尚未設定來源時顯示 `Coming soon`，不會把缺資料當成零流入。這些是流動性背景指標，不是交易建議。

Scanner、Accumulation、Fusion、Strategy、Indicator、Liquidity、FVG 與 MACD 保留各自原有且適合圖表／表格的穩定版面，Crypto Liquidity 使用白底圓角 panel；不再以全域 selector 強制覆寫所有分析頁，避免巢狀 Indicator 與寬表格跑版。分析頁不使用裝飾性 emoji／小 icon，方向與狀態改由文字、Badge 與既有色彩表達。BTC／ETH ETF flow 在可靠來源完成評估前顯示 `Coming soon`，且不計入 Liquidity Bias。

Production gateway 必須設定 `TRUSTED_PROXY_MODE`：Vercel 使用 `vercel`；自架環境只有在最外層 proxy 會覆寫 forwarding headers 時才能使用 `x-forwarded-for`。Redis 故障時一般/data tier 保持 fail-open，但 auth/strict tier 在 production 回 `503` fail-closed。全站回應包含 CSP、HSTS、nosniff、referrer 與 permissions security headers。

Frontend 以 `npm run lint` 作為零 error／零 warning gate；Next.js 16 Route Handler 的 `Request` 參數維持必填，確保 production type generation 可通過。Supabase ticker requests 會忽略已切換頁面後才返回的舊 response，indicator auto-scan 則在 effect 後排程，避免同步 state cascade，同時保持原本的自動載入行為。首頁 Hero 以 `SMART STRATEGY` 作為展示名稱，採響應式左右分欄宣傳排版，左側使用一般使用者可理解的市場分析文案，右側只顯示無文字的原生動態交易趨勢圖；四大策略卡片不顯示裝飾性 emoji。品牌 icon 使用 `services/frontend/public/ptrade.svg`，登入頁、Navbar 與瀏覽器 icon 共用同一份 SVG 資產。

Stripe Checkout 已退出新訂閱 UI 且 production 必須保持 `STRIPE_CHECKOUT_ENABLED=false`；既有 Stripe Customer Portal 與 webhook 仍保留，避免既有訂閱失去取消或狀態同步能力。原有 server-only Price allowlist、Test/Live 隔離、Session 冪等與禁止直接切換方案的安全邊界維持不變。

台灣新訂閱改用綠界信用卡定期定額：Pro 為 NT$320／月、Premium 為 NT$620／月，不提供免費試用。`ECPAY_CHECKOUT_ENABLED` 與 `NEXT_PUBLIC_ECPAY_ENABLED` 預設皆為 `false`。後端驗證首次及每期通知的 SHA256 `CheckMacValue`、拒絕模擬付款開通並以 provider event ID 去重；callback 透過單一 transaction RPC 同步 event、subscription 與聚合 entitlement。所有付費權益都必須有尚未到期的 `current_period_end`，缺失或到期即 fail-closed。上線前執行最新版 `services/frontend/supabase_billing_providers.sql`，撤除 billing/analysis tables 的 anon/authenticated grants、建立取消 outbox/retry、跨 provider entitlement 聚合與 retention RPC；步驟見 `docs/ecpay-recurring.md`。

Telegram webhook 必須設定 `TELEGRAM_WEBHOOK_SECRET`；route 會在解析 payload 前驗證 `X-Telegram-Bot-Api-Secret-Token`，而 `setup_telegram_webhook.py` 會把相同 secret 註冊至 Telegram。綁定碼透過 transaction RPC 同時完成 token claim、Premium 到期驗證與帳號綁定，失敗不會先消耗 token。

Pro 與 Premium 不支援直接升降級：Stripe 與 ECPay 共用 `billing_checkout_intents`，由 transaction RPC 鎖定 user row 並以 partial unique index 保證每位使用者同時只能有一個跨 provider Checkout；存在有效、pending、past-due 訂閱或其他付款頁時回傳 `409`，30 分鐘後才可釋放逾期 reservation。`users` 只保存由 `billing_subscriptions` 聚合出的最佳有效 entitlement，Stripe 延遲事件不得撤銷仍有效的 ECPay 權益，反之亦然。綠界取消會先建立 durable outbox，再呼叫 provider；本地同步失敗可由 `/api/admin/ecpay-cancel-retry` 以 CAS claim 重試並透過 provider query 復原。`GET /api/admin/ecpay-reconcile` 使用綠界 `QueryCreditCardPeriodInfo` 核對金額與執行狀態；provider 拒絕查詢時會先回報經單行化與長度限制的 `RtnCode/RtnMsg`，不再誤判為 identity mismatch，也不輸出完整 provider payload。`.github/workflows/ecpay_reconcile.yml` 每日呼叫該 API，API 失敗、findings 或 unresolved events 會使 workflow 失敗，並以 `BILLING_ALERT_TELEGRAM_CHAT_ID` 指定的獨立 Telegram 管理群通知可追查的 issue、subscription/user/event ID 與安全化 detail，GitHub failure email 作為備援。failed/stuck events 也會透過 `BILLING_ALERT_WEBHOOK_URL` 告警。正式 Checkout 仍必須保持關閉，直到 migration、排程、告警、人工補帳與 sandbox/live E2E 全部驗收。

所有 cookie-authenticated billing mutation 在 production 會精確比對 `NEXT_PUBLIC_APP_URL` Origin；production URL 必須是單一 HTTPS origin。Stripe、ECPay 與 Telegram webhook 使用流式 body size cap；billing event 僅保存 allowlist 摘要，管理員可透過 `/api/admin/billing-retention` 清除 30–365 天以前已處理事件（預設 90 天）。

Repository 以 MIT License 開源；貢獻、安全通報與社群行為分別見 `CONTRIBUTING.md`、`SECURITY.md` 與 `CODE_OF_CONDUCT.md`。安全弱點不得透過 public issue 附上 exploit、secret 或 production payload。

### 回測/優化

```bash
python backtest_multi.py            # 多策略日線回測
python pre_market.py --dry-run      # 開盤前觀察清單
python intraday.py --dry-run        # 盤中 1H 確認
```

### 測試

```bash
pytest tests/                       # Python tests
cd services/frontend && npm test    # Frontend Vitest
cd services/frontend && npm run lint
cd services/frontend && npm run build
```

### Commit 前文件一致性檢查

安裝 repository hooks：

```bash
bash scripts/install-hooks.sh
```

安裝後會啟用兩個 hooks：

- `scripts/pre-commit` 在 commit 前檢查 staged files。
- 功能程式碼有修改時，必須同步 staged 根目錄 `README.md`。
- 核心契約、state schema、workflow、部署拓撲或 production module 結構有變更時，必須同步 staged `docs/CODEX_ARCHITECTURE.md`。
- Hook 負責確認文件包含在同一個 commit；文件內容是否與實作一致，仍須在完整 diff review 與 commit 前的獨立 sub-agent review 中確認。
- `scripts/pre-push` 禁止人工或 AI agent 直接 push `main`，並驗證工作 branch 必須使用 `feat/*`、`fix/*`、`refactor/*` 或 `chore/*`，再透過 Pull Request 合併。Tag 與刪除非 main branch 不受命名檢查影響；GitHub Actions 自動持久化 `data/accum_state.json` 是唯一的 main 直推例外。

標準交付流程：

```text
main → 建立工作 branch → 修改/測試 → sub-agent review → commit
     → push 工作 branch → 建立 PR（base: main）→ CI/review → merge
```

---

## 檔案結構

```
config.py                            # 全域設定（62 symbols, 閾值）
core/
├── signal.py                        # StrategySignal schema
├── base_strategy.py                 # BaseStrategy ABC
├── data_provider.py                 # YahooProvider (batch download)
├── indicators.py                    # VP (histogram-based) + ATR + VWAP 等
├── vp_multitf.py                    # VP 多時間框架計算
├── market_context.py                # VIX、SPY 狀態
regime/
├── engine.py                        # RegimeState (backtest 用)
strategies/
├── vp_signals.py                    # VP 策略信號 (backtest 用)
├── vwap_signals.py                  # VWAP 策略信號 (backtest 用)
├── trend_signals.py                 # Trend 策略信號 (backtest 用)
├── accumulation/
│   ├── config.py                    # 累積追蹤閾值
│   ├── detector.py                  # 6 指標日評分 (0-18)
│   ├── phase_classifier.py          # Wyckoff Phase A-E
│   ├── entry_triggers.py            # Spring / LPS / SOS
│   ├── tracker.py                   # State persistence + decay
│   └── notifications.py            # Trigger/Report 格式化
scoring/
├── confidence.py                    # Legacy 評分 (backtest 用)
scan_all.py                          # VP 多時間框架掃描主程式
accumulation.py                      # 累積追蹤主程式
pre_market.py                        # 開盤前觀察清單
intraday.py                          # 盤中確認
backtest_multi.py                    # 多策略回測
notifications/                       # Telegram / Teams 發送
data/
├── scan_results.json                # VP 掃描結果
├── accum_state.json                 # Accumulation 狀態（CI auto-commit）
tests/                               # 137 個 pytest 測試
```

---

## GitHub Actions

| Workflow | 時間 (UTC) | 功能 |
|----------|-----------|------|
| `vp_scanner.yml` | 21:05 Mon-Fri | VP Scan + Accumulation + auto-commit state |
| `pre_market.yml` | 13:00 Mon-Fri | 開盤前觀察清單 |
| `backtest.yml` | 手動觸發 | 回測/優化 |
| `tests.yml` | PR/Push | CI 測試 |

---

## Telegram 通知

### VP Scan 結果

```
📊 VP Multi-TF — 2026-07-13 16:05 ET
🟡 VIX: 15.0 | SPY: above_va

🟢 Bullish (Above VA 2+ TFs):
  AAPL $315.32 — D:129% W:151% M:160%
  AMD $557.89 — D:119% W:197% M:184%

🔴 Bearish (Below VA 2+ TFs):
  AI $8.95 — D:-0% W:-6% M:-8%
  ORCL $140.64 — D:-22% W:-10% M:-12%
```

### Accumulation Trigger Alert

```
⚡ SPRING TRIGGERED — AVGO

Entry: $165.20 | SL: $158.50 | TP: $185.00
R:R: 1:2.9
Phase C (85%) — 跌破 $160.00 後收回 + 量 1.8x median
Action: PILOT BUY 10-25%
```

---

## 設計原則

1. **拍賣理論核心** — VP 顯示公允價值，交易在價格與價值的互動點
2. **多時間框架對齊** — 大方向 + 中期 + 短線三者一致 = 高信心
3. **State Persistence** — Accumulation 狀態跨天累積，CI auto-commit
4. **UI 與計算分離** — Scanner 存 JSON，UI 只讀
5. **策略保留但分離** — VP/VWAP/Trend 信號偵測保留給 backtest 使用
