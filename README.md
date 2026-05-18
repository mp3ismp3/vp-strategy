# Multi-Strategy Analysis Platform

基於市場拍賣理論（Market Auction Theory）的多策略交易分析平台。以市場狀態為核心（Market-State-Centric），整合 Volume Profile、VWAP、Trend Following 三大策略，透過 Signal Fusion Engine 產生綜合評分與持有時間建議。

## 系統架構

```
Scanner Cron → DataProvider (prepost=False, jitter)
    → Regime Engine (4種市場狀態)
    → Strategy Activation (trust > 0.15 才啟動)
    → VP / VWAP / TrendFollowing (各自獨立出信號)
    → Signal Fusion Engine (歸一化權重, 衝突偵測)
    → scan_results.json
    → Streamlit UI (read-only) + Telegram 通知
```

```
┌─────────────────────────────────────────────────────────────┐
│                    三層通知系統                                │
├─────────────────────────────────────────────────────────────┤
│  📋 開盤前觀察清單 (ET 9:00 AM)                              │
│  ⚡ 盤中 1H 確認 (ET 10:30-15:30，每小時)                    │
│  📊 收盤正式信號 (ET 4:05 PM) — 多策略融合版                  │
└─────────────────────────────────────────────────────────────┘
```

## 策略信號

### Volume Profile (VP)

| 信號 | 方向 | 持有 | 說明 |
|---|---|---|---|
| VA Rejection | LONG/SHORT | 短 1-5天 | 價格碰 Value Area 邊緣反轉 |
| Failed Auction | LONG/SHORT | 短 1-5天 | 突破 VA 失敗拉回（假突破） |
| Breakout Retest | LONG/SHORT | 中 1-4週 | 確認突破後回測支撐 |
| Climax Volume | WARNING | — | 成交量 > 2.5x 均量，異常警告 |

### VWAP

| 信號 | 方向 | 持有 | 說明 |
|---|---|---|---|
| VWAP Reclaim | LONG/SHORT | 中 1-4週 | 價格收回 VWAP 上方 + 量確認 |
| VWAP Deviation | LONG/SHORT | 短 1-5天 | 碰到 ±2σ band 反轉 |
| AVWAP Pullback | LONG | 中 1-4週 | 回踩 Anchored VWAP 支撐 |

### Trend Following

| 信號 | 方向 | 持有 | 說明 |
|---|---|---|---|
| Breakout Acceptance | LONG/SHORT | 長 1-3月 | Donchian 突破 + 2日確認 + 量 |
| EMA Cross | LONG/SHORT | 長 1-3月 | EMA20 穿越 EMA50 + 價格確認 |
| Compression Breakout | LONG/SHORT | 中 1-4週 | ATR 壓縮後爆發 |

## Regime Engine（市場狀態引擎）

系統先判斷市場狀態，再決定哪些策略可信：

| 狀態 | 判定條件 | VP 信任 | VWAP 信任 | Trend 信任 |
|------|---------|---------|-----------|-----------|
| Range | POC flat + 價格在 VA 內 | 1.0 | 0.8 | 0.3 |
| Trend | POC 遷移 > 0.8% | 0.5 | 0.9 | 1.0 |
| Expansion | VIX ≥ 25 + 價格在 VA 外 | 0.2 | 0.6 | 0.8 |
| Compression | ATR < 0.7x 連續 5+ 天 | 0.7 | 1.0 | 0.4 |

信任度動態歸一化（加總 = 1.0），trust < 0.15 的策略不啟動。

## Signal Fusion Engine（信號融合）

```
各策略最高 confidence 信號
    × 歸一化 trust 權重
    = 各策略貢獻分數
    → 加總 = Composite Score (0-100)
    → 方向衝突 penalty -15（僅 active 策略）
    → 加 regime bonus
```

**權重配置（可調）：**
- VP: 0.4
- VWAP: 0.3
- TrendFollowing: 0.2
- Regime bonus: 0.1

**評分標籤：**
| 分數 | 標籤 | 建議 |
|------|------|------|
| ≥ 80 | Strong Long/Short | 高信心進場 |
| 60-79 | Moderate | 可進場 |
| 50-59 | Lean | 輕倉 |
| 40-49 | Neutral | 觀望 |
| < 40 | Avoid | 不進場 |

## Holding Period Engine（持有時間）

策略決定 base，ATR/VIX 微調：

| 類型 | Base | 高波動 (ATR>1.5x 或 VIX>25) | 低波動 (ATR<0.7x 或 VIX<15) |
|------|------|---------------------------|---------------------------|
| 短線 | 3 天 | ×0.8 = 2天 | ×1.2 = 4天 |
| 中線 | 12 天 | ×0.64 = 8天 | ×1.44 = 17天 |
| 長線 | 45 天 | ×0.64 = 29天 | ×1.44 = 65天 |

## 檔案結構

```
config.py                            # 全域設定 + 權重 + Regime 閾值
core/
├── signal.py                        # StrategySignal 統一 schema
├── base_strategy.py                 # BaseStrategy ABC
├── data_provider.py                 # DataProvider ABC + YahooProvider
├── indicators.py                    # 12 個技術指標函數
├── market_context.py                # VIX、SPY、板塊動能
├── ai_analysis.py                   # Gemini AI 分析（選用）
regime/
├── engine.py                        # RegimeState + 策略信任度 + 歸一化
strategies/
├── vp_signals.py                    # VP 三大信號
├── vwap_signals.py                  # VWAP 三大信號
├── trend_signals.py                 # Trend Following 三大信號
├── inst_trend.py                    # 機構趨勢指標
scoring/
├── fusion.py                        # Signal Fusion Engine (0-100)
├── holding.py                       # Holding Period Engine
├── confidence.py                    # 原有 1-5 分評分（backtest 用）
scan_all.py                          # 多策略掃描主程式
scanner.py                           # Legacy wrapper
pre_market.py                        # 開盤前觀察清單
intraday.py                          # 盤中 1H 確認
backtest.py                          # 日線回測
backtest_1h.py                       # 1H 回測
optimize.py                          # 參數優化
ui/
├── app.py                           # Streamlit 入口
├── scanner_page.py                  # Scanner Dashboard（排名表）
├── detail_page.py                   # 單股詳細分析
├── components.py                    # 圖表 + 策略卡片
├── strategy_docs.py                 # 策略說明（中文）
data/
├── scan_results.json                # 掃描結果快取
notifications/
├── telegram.py                      # Telegram 通知
tests/                               # 68 個測試
.github/workflows/
├── vp_scanner.yml                   # 收盤掃描 (UTC 21:05)
├── pre_market.yml                   # 開盤前觀察清單 (UTC 13:00)
├── intraday.yml                     # 盤中確認 (UTC 14:30-19:30)
├── backtest.yml                     # 回測/優化（手動觸發）
├── tests.yml                        # CI 測試
```

## 使用方式

### 安裝

```bash
pip install -r requirements.txt
```

### 多策略掃描（主要功能）

```bash
# 掃描 52 檔 → 存 JSON + 發 Telegram
python scan_all.py

# Dry run（不發通知）
python scan_all.py --dry-run
```

### Web UI

```bash
streamlit run ui/app.py
```

功能：
- **Scanner Dashboard**：排名表（Score / Setup / Direction / Regime / R:R / Holding），可篩選排序
- **Detail Page**：K 線圖（VP 水平線 + VWAP + AVWAP）+ 三策略分析卡片 + Trade Plan

### 原有功能

```bash
python pre_market.py --dry-run      # 開盤前觀察清單
python intraday.py --dry-run        # 盤中 1H 確認
python backtest.py --min-score 3    # 日線回測
python optimize.py                  # 參數優化
```

### 測試

```bash
pytest tests/
```

## 掃描標的

52 檔美股：Mega Cap Tech、半導體/AI 晶片、AI/雲端/軟體、雲端基礎設施、AI 硬體/機器人、ETF（SPY、QQQ）。

## 設定 Telegram 通知

1. 跟 [@BotFather](https://t.me/BotFather) 建立 bot，取得 token
2. 對 bot 發送訊息，訪問 `https://api.telegram.org/bot<TOKEN>/getUpdates` 取得 chat_id
3. 設定環境變數或 GitHub repo Secrets：
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`

## 通知範例

### 多策略掃描結果
```
📊 Multi-Strategy Scan — 2026-05-18 16:05 ET
Scanned 52 symbols | Signals: 5
🟡 VIX: 17.2 | SPY: above_va

🟢 NVDA — Strong Long (82/100)
   Setup: VA Rejection | R:R 2.8 | Hold: 2-4 days
   Regime: range | VP:38.1, VWAP:26.7, TrendFollowing:8.6

🟢 META — Moderate Long (67/100)
   Setup: VWAP Reclaim | R:R 3.1 | Hold: 1-2 weeks
   Regime: trend | VP:10.4, VWAP:33.8, TrendFollowing:25.0
```

## 參數說明

| 參數 | 預設值 | 說明 |
|---|---|---|
| `vp_lookback` | 60 | VP 計算回看天數 |
| `va_pct` | 0.68 | Value Area 百分比 |
| `atr_len` | 14 | ATR 計算週期 |
| `vol_ma_len` | 21 | 成交量均線週期 |
| `max_sl_atr` | 3.0 | 止損最大 ATR 倍數 |
| `cooldown_bars` | 3 | 同一標的信號冷卻天數 |

## 設計原則

1. **Market-State-Centric**：先判斷市場狀態，再決定哪些策略有效
2. **統一介面**：所有策略輸出相同的 `StrategySignal` schema
3. **歸一化權重**：確保 Composite Score 跨 regime 可比
4. **UI 與計算分離**：Scanner 存 JSON，UI 只讀取（毫秒級載入）
5. **向後相容**：原有 backtest/optimize/intraday 功能不受影響
