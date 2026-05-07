# Institutional Volume Profile Strategy

基於市場拍賣理論（Market Auction Theory）的 Volume Profile 交易策略，包含 TradingView 指標和自動掃描通知系統。

## 系統架構

```
┌─────────────────────────────────────────────────────────────┐
│                    三層通知系統                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📋 開盤前觀察清單 (ET 9:00 AM)                              │
│  ├─ 掃描 52 檔，找昨收接近 VA 邊緣 (2%) 的標的               │
│  ├─ 標示關鍵位 + 可能觸發的信號類型                           │
│  └─ 不篩選，全部列出                                        │
│                                                             │
│  ⚡ 盤中 1H 確認 (ET 10:30-15:30，每小時)                    │
│  ├─ 用日線 VP 結構 + 1H K 線確認                             │
│  ├─ 篩選：量能 ≥ 1.2x + 信心 ≥ 3 + 順趨勢                  │
│  └─ 建議輕倉，收盤確認後加倉                                 │
│                                                             │
│  📊 收盤正式信號 (ET 4:05 PM)                                │
│  ├─ 完整日 K 線確認，最可靠                                   │
│  ├─ 不篩選，全部發送，附評分 1-5                             │
│  └─ 隔天開盤進場                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 策略信號

| 信號 | 方向 | 說明 |
|---|---|---|
| **VA Rejection** | LONG / SHORT | 價格碰到 Value Area 邊緣反轉，機構在防守 |
| **Failed Auction** | LONG / SHORT | 突破 VA 失敗拉回，假突破反轉 |
| **Breakout Retest** | LONG / SHORT | 確認突破後回測支撐，順勢進場 |
| **Climax Volume** | WARNING | 成交量 > 21 日均量 2.5 倍，異常放量警告 |

每個交易信號附帶 Entry、TP、SL，並分 **60D**（波段）和 **120D**（中長線）兩組 lookback 顯示。

### 動態 TP（根據 VIX 調整）

| VIX 水位 | TP 倍數 | 邏輯 |
|---|---|---|
| VIX ≥ 25 | 0.8x | 高波動，提早獲利 |
| 15 < VIX < 25 | 1.0x | 正常 |
| VIX ≤ 15 | 1.3x | 低波動趨勢明確，讓利潤跑 |

## 盤中 1H 確認邏輯

VP 結構用日線計算（不變），觸發確認用 1H K 線：

| 信號 | 1H 確認條件 |
|---|---|
| VA Rejection LONG | 1H 低點碰 VAL ±0.5% + 陽線 + 下影線 ≥ 實體 0.8x + 量 ≥ 1.2x |
| VA Rejection SHORT | 1H 高點碰 VAH ±0.5% + 陰線 + 上影線 ≥ 實體 0.8x + 量 ≥ 1.2x |
| Failed Auction LONG | 前 1H 收在 VAL/PDL 下 + 當前收回上方 + 陽線 + 量 ≥ 1.2x |
| Failed Auction SHORT | 前 1H 收在 VAH/PDH 上 + 當前收回下方 + 陰線 + 量 ≥ 1.2x |
| Breakout Retest LONG | 1H 低點在 VAH ± 0.5 ATR + 收在 VAH 上 + 陽線 + 量 ≥ 1.2x |
| Breakout Retest SHORT | 1H 高點在 VAL ± 0.5 ATR + 收在 VAL 下 + 陰線 + 量 ≥ 1.2x |

**盤中篩選條件：**
- 量能：1H 成交量 > 20 期均量 × 1.2（機構標準）
- 信心：評分 ≥ 3 分
- 趨勢：不發逆趨勢信號（LONG + 日線 BEARISH → 過濾）
- 使用已收完的 K 線（`iloc[-2]`），不看未完成的

## 機構趨勢指標 (Institutional Trend)

判斷整體方向性偏差，用於信心評分。採用**階層式邏輯**（模擬機構決策流程）：

### 決策流程

```
1. 結構突破了嗎？（close > swing high / < swing low）
   └─ 沒有 → NEUTRAL，不論其他條件
   
2. 突破有量嗎？（volume > 1.5x 均量）
   └─ 沒有 → NEUTRAL（結構突破但無量 = 弱信號）
   └─ 有 → 確認方向，進入加分階段

3. 加分條件：
   ├─ VWAP 配合？（收盤在 VWAP 正確側）→ +1
   ├─ 回踩守住？（pullback 不破突破點）→ +1
   └─ 流動性掃描？（掃完 swing point 反轉）→ +1
```

### 判定標準

| 條件 | 結果 |
|---|---|
| 結構突破 + 放量（score ≥ 2） | **BULLISH / BEARISH** |
| 結構突破但無量（score = 1） | NEUTRAL |
| 無結構突破 | NEUTRAL |

## 信心評分系統 (Confidence Score)

每個信號附帶 1-5 分的機構級信心評分。

**🔑 Must-have（Gate）：**

| 信號類型 | Gate 條件 | 未通過結果 |
|---|---|---|
| VA Rejection / Failed Auction | 量能 >1.5x + Regime=Range | 0 過→cap 2, 1 過→cap 3 |
| Breakout Retest | 量能 >1.5x + 趨勢 BULLISH/BEARISH | 0 過→cap 2, 1 過→cap 3 |
| 任何信號 + Expansion | — | 強制 cap 2 |

**📊 Nice-to-have（加分項）：**

| 因子 | 條件 | 分數 |
|---|---|---|
| VIX | 均值回歸: VIX≥20 / 突破: VIX<20 | +1 |
| 大盤配合 | SPY VA 狀態支持信號方向 | +1 |
| 板塊動能 | 所屬板塊 ETF 10日動能配合 | +1 |
| 60D/120D 同方向 | 兩個 lookback 出現同方向信號 | +1 |
| Delta 方向 | 近10日買賣壓方向配合 | +1 |

**⚠️ Penalty：**

| 因子 | 條件 | 分數 |
|---|---|---|
| 財報前 3 天 | 接近財報日，VP 結構可能失效 | -1 |
| VA 過窄 | (VAH-VAL)/ATR < 1.5，方向不明 | -1 |

### 使用建議

| 分數 | 建議操作 |
|---|---|
| ⭐⭐⭐⭐⭐ (5) | 高信心，正常倉位進場 |
| ⭐⭐⭐⭐ (4) | 條件良好，可進場 |
| ⭐⭐⭐ (3) | 及格，輕倉或等下一根 K 確認 |
| ⭐⭐ (2) | 條件不足，建議觀望 |
| ⭐ (1) | 多重矛盾，不進場 |

## 回測系統

三種模式，在 GitHub Actions 手動觸發：

### backtest — 日線策略回測

```bash
python backtest.py --days 120 --min-score 3 --vp-lookback 60 --va-pct 0.68
```

- 進場：信號隔天開盤價（模擬真實操作）
- 出場：先碰 TP = WIN，先碰 SL = LOSS，超過 max_hold 天以收盤結算
- 可選篩選：`--min-score 3`（只測你會進場的信號）
- 可調參數：`--vp-lookback`, `--va-pct`, `--max-sl-atr`

### backtest_1h — 盤中 1H 策略回測

```bash
python backtest_1h.py --symbols NVDA,AAPL
```

- 資料：yfinance 60 天 1H K 線
- 進場：信號 K 線收盤價
- 最大持倉：6 根 1H（6 小時）
- 含 0.05% 滑點

### optimize — 參數自動優化

```bash
python optimize.py --symbols NVDA,AAPL,MSFT
```

- Grid search：lookback × va_pct × max_sl_atr（36 組合）
- 防過擬合：70% train / 30% test（out-of-sample）
- 含交易成本（0.05% 滑點）
- 輸出 Top 10 參數 + 過擬合警告

## 檔案結構

```
scanner.py                           # 收盤信號掃描（主程式）
pre_market.py                        # 開盤前觀察清單
intraday.py                          # 盤中 1H 確認信號
backtest.py                          # 日線回測
backtest_1h.py                       # 1H 回測
optimize.py                          # 參數優化
config.py                            # 全域設定、symbol 清單、板塊映射
core/
├── data.py                          # 數據下載 + cache
├── indicators.py                    # VP、ATR、VWAP、Delta、Swing
└── market_context.py                # 市場環境（VIX、SPY、板塊動能）
strategies/
├── __init__.py                      # BaseStrategy + Signal dataclass
├── vp_signals.py                    # VP 三大信號
└── inst_trend.py                    # 機構趨勢指標
scoring/
└── confidence.py                    # 信心評分引擎
notifications/
└── telegram.py                      # Telegram 通知
tests/                               # 測試
.github/workflows/
├── vp_scanner.yml                   # 收盤掃描 (UTC 21:05)
├── pre_market.yml                   # 開盤前觀察清單 (UTC 13:00)
├── intraday.yml                     # 盤中確認 (UTC 14:30-19:30)
├── backtest.yml                     # 回測/優化（手動觸發）
└── tests.yml                        # CI 測試
volume_profile_strategy.pine         # TradingView Pine Script 指標
```

## 掃描標的

52 檔美股，涵蓋：Mega Cap Tech、半導體/AI 晶片、AI/雲端/軟體、雲端基礎設施、AI 硬體/機器人、ETF（SPY、QQQ）。

## 設定 Telegram 通知

1. 跟 [@BotFather](https://t.me/BotFather) 建立 bot，取得 token
2. 對 bot 發送訊息，訪問 `https://api.telegram.org/bot<TOKEN>/getUpdates` 取得 chat_id
3. 設定 GitHub repo Secrets：
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`

## 執行方式

**GitHub Actions（自動）**：

| 排程 | 時間 | 功能 |
|---|---|---|
| pre_market.yml | ET 9:00 AM | 開盤前觀察清單 |
| intraday.yml | ET 10:30-15:30 每小時 | 盤中 1H 確認 |
| vp_scanner.yml | ET 4:05 PM | 收盤正式信號 |

**手動執行**：

```bash
pip install yfinance requests pandas numpy
export TELEGRAM_BOT_TOKEN="your_token"
export TELEGRAM_CHAT_ID="your_chat_id"

python pre_market.py          # 觀察清單
python intraday.py            # 盤中確認
python scanner.py             # 收盤信號
python backtest.py --min-score 3  # 回測
python optimize.py            # 參數優化
```

**Dry Run（不發送 Telegram）**：

```bash
python scanner.py --dry-run
python intraday.py --dry-run
python pre_market.py --dry-run
```

## 通知範例

### 開盤前觀察清單
```
📋 今日觀察清單 — 2026-05-07

以下標的接近 VA 關鍵位，今日可能觸發信號：

🟢 NVDA (60D) — 距 VAL 1.2%
   關鍵位: 121.80 | 昨收: 123.26
   若觸發 → VA Rejection LONG

共 3 個觀察目標
```

### 盤中 1H 確認
```
⚡ 盤中確認 — 2026-05-07 11:30 ET

1H K 線確認 | 信心 ≥ 3 | 量能 ≥ 1.2x

🟢 NVDA 做多 (VA Rejection) [60D] ⭐⭐⭐⭐ (4/5)
   ▸ Entry: 122.30 | TP: 128.50 | SL: 120.55
   ▸ R:R = 1:3.5
   🔑 量能✅ 趨勢✅
   📊 大盤✅ VIX✅ 板塊✅ Delta偏多✅
   ⚠️ 盤中輕倉，收盤確認後加倉
```

### 收盤正式信號
```
📊 VP Signals — 2026-05-07
Scanned 52 symbols
🟡 VIX: 17.2 | SPY: Above VA ↑

────────────────────
📏 60D Lookback

🟢 NVDA 做多 (VA Rejection) ⭐⭐⭐⭐ (4/5)
   ▸ Entry: 123.50
   ▸ TP: 128.50 (+5.00)
   ▸ SL: 120.80 (-2.70)
   ▸ R:R = 1:1.9
   🔑 量能✅ 趨勢✅ | Range
   📊 大盤✅ VIX✅ 板塊✅ Delta偏多✅
```

## 雙 Lookback 使用建議

| 情境 | 操作 |
|---|---|
| 60D ✅ + 120D ✅ 同方向 | 高信心，正常倉位 |
| 60D ✅ + 120D ❌ | 短線波段操作 |
| 60D ❌ + 120D ✅ | 小倉位試單，等 60D 確認再加倉 |
| 60D 🟢 + 120D 🔴 方向矛盾 | 不進場，觀望 |

## 參數說明

| 參數 | 預設值 | 說明 |
|---|---|---|
| `vp_lookback` | 60 | VP 計算回看天數 |
| `va_pct` | 0.68 | Value Area 百分比（≈1 標準差） |
| `atr_len` | 14 | ATR 計算週期 |
| `vol_ma_len` | 21 | 成交量均線週期 |
| `max_sl_atr` | 3.0 | 止損最大 ATR 倍數 |
| `cooldown_bars` | 3 | 同一標的信號冷卻天數 |
