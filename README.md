# Multi-Strategy Analysis Platform

基於市場拍賣理論（Market Auction Theory）的多策略交易分析平台。整合兩大獨立系統：

1. **Multi-Strategy Scanner** — 日線級 VP/VWAP/Trend 信號融合，每日找交易機會（0-100 評分）
2. **Accumulation Tracker** — Wyckoff 機構吸籌追蹤，跨天累積狀態，尋找大行情起點

## 系統架構

```
┌─────────────────── Multi-Strategy Scanner ───────────────────┐
│                                                               │
│  YahooProvider.batch_daily(52 symbols, 1y)                    │
│       ↓                                                       │
│  fetch_market_context() → {vix, spy_state, sector_momentum}  │
│       ↓                                                       │
│  detect_regime() → Range / Trend / Expansion / Compression   │
│       ↓                                                       │
│  get_active_strategies(trust > 0.15)                          │
│       ↓                                                       │
│  VP / VWAP / TrendFollowing 各自獨立偵測                       │
│       ↓                                                       │
│  fuse_signals() → 三軌獨立評分 → best_score (0-100)           │
│       ↓                                                       │
│  data/scan_results.json + Telegram                            │
└───────────────────────────────────────────────────────────────┘

┌─────────────────── Accumulation Tracker ─────────────────────┐
│                                                               │
│  yf.download(symbol, 6mo)                                     │
│       ↓                                                       │
│  compute_daily_score() → 6 指標評分 (0-18)                    │
│       ↓                                                       │
│  classify_phase() → Wyckoff Phase A/B/C/D/E                  │
│       ↓                                                       │
│  check_failure() → hard/soft/spring 判定                      │
│       ↓                                                       │
│  tracker.update() → decay scoring + promote/demote/exit       │
│       ↓                                                       │
│  check_triggers() → Spring / LPS / SOS 入場信號              │
│       ↓                                                       │
│  data/accum_state.json (CI auto-commit) + Telegram            │
└───────────────────────────────────────────────────────────────┘
```

---

## Multi-Strategy Scanner

### Regime Engine（市場狀態引擎）

系統先判斷市場狀態，再決定哪些策略可信：

| 狀態 | 判定條件 | VP 信任 | VWAP 信任 | Trend 信任 |
|------|---------|---------|-----------|-----------|
| Range | POC flat + 價格在 VA 內 | 1.0 | 0.8 | 0.3 |
| Trend | POC 遷移 > 0.8% | 0.5 | 0.9 | 1.0 |
| Expansion | VIX ≥ 25 + 價格在 VA 外 | 0.2 | 0.6 | 0.8 |
| Compression | ATR < 0.7x 連續 5+ 天 | 0.7 | 1.0 | 0.4 |

信任度動態歸一化（加總 = 1.0），trust < 0.15 的策略不啟動。

### 策略信號

#### Volume Profile (VP) — 價值區間交易

| 信號 | 方向 | 持有 | 說明 |
|---|---|---|---|
| VA Rejection | LONG/SHORT | 短 1-5天 | 價格碰 Value Area 邊緣 + 反轉 K 線 + 放量 |
| Failed Auction | LONG/SHORT | 短 1-5天 | 突破 VA 失敗拉回（假突破） |
| Breakout Retest | LONG/SHORT | 中 1-4週 | 確認突破後回測支撐，舊壓力變新支撐 |
| Climax Volume | WARNING | — | 成交量 > 2.5x 均量，異常警告（不評分） |

#### VWAP — 均價回歸/偏離交易

| 信號 | 方向 | 持有 | 說明 |
|---|---|---|---|
| VWAP Reclaim | LONG/SHORT | 中 1-4週 | 價格從 VWAP 下方收回上方 + 量確認 |
| VWAP Deviation | LONG/SHORT | 短 1-5天 | 碰到 ±2σ band + 反轉 K 線（均值回歸）|
| AVWAP Pullback | LONG | 中 1-4週 | 回踩 Anchored VWAP 支撐 + 守住 |

#### Trend Following — 趨勢突破交易

| 信號 | 方向 | 持有 | 說明 |
|---|---|---|---|
| Breakout Acceptance | LONG/SHORT | 長 1-3月 | Donchian 突破 + 2日站穩 + 放量 |
| EMA Cross | LONG/SHORT | 長 1-3月 | EMA20 穿越 EMA50 + 價格確認 |
| Compression Breakout | LONG/SHORT | 中 1-4週 | ATR 壓縮後當日 range > 1.5x ATR |

### Signal Fusion Engine（信號融合）

信號分為三軌（short / mid / long），各軌獨立評分：

```
Score = primary_confidence × 100
      + confirmation bonus（同方向其他策略 +10，max +15）
      - veto penalty（反方向策略 -20 each）
      + regime fit bonus（主策略是最受信任的 +10）
```

`best_score` = 三軌中最高分，用於排名。

**評分標籤：**

| 分數 | 標籤 | 建議 |
|------|------|------|
| ≥ 80 | Strong Long/Short | 高信心進場 |
| 60-79 | Moderate | 可進場，正常倉位 |
| 50-59 | Lean | 輕倉試探 |
| 40-49 | Neutral | 觀望 |
| < 40 | Avoid | 不進場 |

### Holding Period Engine（持有時間）

策略決定 base，ATR/VIX 微調：

| 類型 | Base | 高波動 (ATR>1.5x 或 VIX>25) | 低波動 (ATR<0.7x 或 VIX<15) |
|------|------|---------------------------|---------------------------|
| 短線 | 3 天 | ×0.8 = 2天 | ×1.2 = 4天 |
| 中線 | 12 天 | ×0.64 = 8天 | ×1.44 = 17天 |
| 長線 | 45 天 | ×0.64 = 29天 | ×1.44 = 65天 |

---

## Accumulation Tracker（Wyckoff 機構吸籌追蹤）

### 設計目的

追蹤哪些股票正被機構悄悄累積，在突破前提早發現。機構不會一次買完（會推高價格），而是在區間內反覆吸籌，形成特定的價量結構。

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

### Wyckoff Phase（階段判定）

```
A (Stopping)   — 大跌停止，出現 Selling Climax + Stopping Volume
B (Building)   — 區間震盪吸籌，OBV 上升，測試量遞減
C (Spring)     — 假跌破支撐 + 快速收回（洗盤，最佳入場區）
D (Trending)   — Higher Lows 形成 + SOS 放量反彈
E (Markup)     — 突破阻力 + 量確認（已起飛）
```

**Phase 遲滯機制：** 前進（B→C→D→E）立即生效，後退需連續 2 天確認，防止日間跳動。

### State Management（狀態管理）

```
Score ≥ 5        → 加入觀察 (watch)
連續 2 天 ≥ 9    → 升級確認 (confirmed)
連續 2 天 < 9    → 降級回觀察
Decay score < 3  → 自動移除
跌破支撐 + 放量  → 立即移除 (failure)
```

**Decay Scoring：** `new_score = max(今日 raw, 前日 decay × 衰減率)`
- Phase A/B/UNKNOWN: 衰減率 0.85（慢，~15 天到 EXIT）
- Phase C/D/E: 衰減率 0.75（快，~7 天到 EXIT）

### Entry Triggers（入場觸發）

| 觸發 | 適用 Phase | 條件 | 動作 |
|------|-----------|------|------|
| Spring | C | 跌破動態支撐後收回 + 量確認 + 收盤在上半 | PILOT BUY 10-25% |
| LPS | D | 回踩量縮 < 0.7x + 守住前低 + 收盤轉強 | ADD 25-40% |
| SOS Breakout | D/C | 突破阻力 + 量 > 1.5x 或連 2 天站穩 | FULL POSITION |

每個觸發都附帶 Entry / Stop-Loss / Target / R:R 比。

### Failure Detection（失敗偵測）

| 類型 | 條件 | 結果 |
|------|------|------|
| Hard | 收盤 < 主支撐 + 量 > 1.5x + 收在下 25% | 立即移除 |
| Hard | 連續 2 天收盤 < 主支撐 | 立即移除 |
| Soft | 收盤 < 動態支撐 + 量 > 1.2x + 收在下 40% | 累積 2 天後移除 |
| Spring | 盤中跌破支撐但收盤收回 | 不是失敗，清除 failure 狀態 |

---

## 兩系統搭配使用

| | Scanner | Accumulation |
|--|---------|--------------|
| 時間視角 | 今天有沒有信號 | 過去數週的累積過程 |
| 交易類型 | 短/中/長都有 | 中長線 swing |
| 有無記憶 | 無（每天獨立） | 有（state 跨天累積） |
| 入場方式 | 收盤信號 → 隔天做 | 等 trigger → 分批建倉 |

**高信心交易 = Accumulation confirmed + Scanner 高分 + 同方向**

---

## 使用方式

### 安裝

```bash
pip install -r requirements.txt
```

### 多策略掃描

```bash
python scan_all.py              # 掃描 52 檔 → JSON + Telegram + Teams
python scan_all.py --dry-run    # 只印不發
python scan_all.py --guide      # 發送信號使用教學到 Telegram
```

### 累積追蹤

```bash
python accumulation.py              # 掃描全部 + 更新 state + Telegram
python accumulation.py NVDA,AMD     # 只掃特定標的
python accumulation.py --dry-run    # 只印不發
python accumulation.py --debug      # 顯示詳細指標分解
python accumulation.py --phase      # 只顯示 Phase 分類
python accumulation.py --triggers   # 只顯示觸發狀態
```

### Web UI

```bash
streamlit run ui/app.py
```

### 回測/優化

```bash
python backtest_multi.py            # 多策略日線回測
python pre_market.py --dry-run      # 開盤前觀察清單
python intraday.py --dry-run        # 盤中 1H 確認
python optimize.py                  # 參數優化
```

### 測試

```bash
pytest tests/                       # 62+ 個測試
```

---

## Telegram 通知

### 設定

1. 跟 [@BotFather](https://t.me/BotFather) 建立 bot，取得 token
2. 對 bot 發訊息，訪問 `https://api.telegram.org/bot<TOKEN>/getUpdates` 取 chat_id
3. 設定環境變數或 GitHub repo Secrets：
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`

### 通知範例

**Scanner 結果：**
```
📊 Multi-Strategy Scan — 2026-07-07 16:05 ET
Scanned 52 symbols | Signals: 5
🟡 VIX: 17.2 | SPY: above_va

🟢 NVDA — Strong Long (82/100)
   Setup: VA Rejection | R:R 2.8 | Hold: 2-4 days
   Regime: range | short:82, mid:45

🟢 META — Moderate Long (67/100)
   Setup: VWAP Reclaim | R:R 3.1 | Hold: 1-2 weeks
   Regime: trend | mid:67
```

**Accumulation Trigger Alert：**
```
⚡ SPRING TRIGGERED — AVGO

Entry: $165.20 | SL: $158.50 | TP: $185.00
R:R: 1:2.9
Phase C (85%) — 跌破 $160.00 後收回 + 量 1.8x median
Action: PILOT BUY 10-25%
```

**Accumulation Daily Report：**
```
📋 Accumulation Report — 2026-07-07
✅ Confirmed: 3 | 👀 Watch: 8

📈 NVDA → confirmed (12.5 分, Phase B)
🆕 MRVL → watch (7 分, Phase A)
❌ INTC 移除 (分數衰減至下限)
```

---

## 檔案結構

```
config.py                            # 全域設定（52 symbols, 權重, 閾值）
AGENTS.md                            # AI Agent 開發規範
core/
├── signal.py                        # StrategySignal schema + TRACK_MAP
├── base_strategy.py                 # BaseStrategy ABC
├── data_provider.py                 # YahooProvider (batch download)
├── indicators.py                    # 12 個技術指標純函數
├── market_context.py                # VIX、SPY、板塊動能
├── ai_analysis.py                   # Gemini AI 分析（選用）
regime/
├── engine.py                        # RegimeState + 信任度歸一化
strategies/
├── vp_signals.py                    # VP 策略（4 信號）
├── vwap_signals.py                  # VWAP 策略（3 信號）
├── trend_signals.py                 # Trend 策略（3 信號）
├── inst_trend.py                    # 機構趨勢指標
├── accumulation/
│   ├── config.py                    # 累積追蹤閾值設定
│   ├── detector.py                  # 6 指標日評分 (0-18)
│   ├── phase_classifier.py          # Wyckoff Phase A-E
│   ├── entry_triggers.py            # Spring / LPS / SOS
│   ├── tracker.py                   # State persistence + decay
│   └── notifications.py            # Trigger/Proximity/Report 格式化
scoring/
├── fusion.py                        # Signal Fusion Engine (三軌獨立)
├── holding.py                       # Holding Period Engine
├── confidence.py                    # Legacy 1-5 分評分
scan_all.py                          # 多策略掃描主程式
accumulation.py                      # 累積追蹤主程式
pre_market.py                        # 開盤前觀察清單
intraday.py                          # 盤中 1H 確認
backtest_multi.py                    # 多策略回測
ui/                                  # Streamlit (read-only)
notifications/                       # Telegram 發送
data/
├── scan_results.json                # Scanner 結果（不進 git）
├── accum_state.json                 # Accumulation 狀態（CI auto-commit）
tests/                               # 62+ 個 pytest 測試
scripts/
├── pre-commit                       # Git hook（自動 review）
├── install-hooks.sh                 # Hook 安裝腳本
```

---

## GitHub Actions

| Workflow | 時間 (UTC) | 功能 |
|----------|-----------|------|
| `vp_scanner.yml` | 21:05 Mon-Fri | Scanner + Accumulation + auto-commit state |
| `pre_market.yml` | 13:00 Mon-Fri | 開盤前觀察清單 |
| `backtest.yml` | 手動觸發 | 回測/優化 |
| `tests.yml` | PR/Push | CI 測試 |

---

## 參數說明

| 參數 | 預設值 | 說明 |
|---|---|---|
| `vp_lookback` | 60 | VP 計算回看天數 |
| `va_pct` | 0.68 | Value Area 百分比 |
| `atr_len` | 14 | ATR 計算週期 |
| `vol_ma_len` | 21 | 成交量均線週期 |
| `max_sl_atr` | 3.0 | 止損最大 ATR 倍數 |
| `cooldown_bars` | 3 | 同一標的信號冷卻天數 |

---

## 設計原則

1. **Market-State-Centric** — 先判斷環境，再決定策略有效性
2. **統一介面** — 所有策略輸出相同 `StrategySignal` schema
3. **三軌獨立** — Short/Mid/Long 各自評分，不互相污染
4. **State Persistence** — Accumulation 狀態跨天累積，CI auto-commit
5. **UI 與計算分離** — Scanner 存 JSON，UI 只讀（毫秒級載入）
6. **向後相容** — 新功能不破壞現有 API/schema

---

## 掃描標的

52 檔美股：
- Mega Cap Tech（AAPL, MSFT, GOOGL, AMZN, META, NVDA, TSLA）
- 半導體/AI 晶片（AVGO, AMD, INTC, QCOM, MU, MRVL, ARM, TSM, ASML...）
- AI/雲端/軟體（NOW, PLTR, AI, SNOW, DDOG, NET, PANW, CRWD...）
- 雲端基礎設施（ORCL, IBM, INTU, WDAY, TEAM）
- AI 硬體/機器人（DELL, HPE, SMCI, VRT, ANET）
- AI 電力/能源（VST, CEG, TLN, NRG, ETN, PWR, GEV, FSLR）
- ETF（SPY, QQQ）
