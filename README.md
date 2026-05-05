# Institutional Volume Profile Strategy

基於市場拍賣理論（Market Auction Theory）的 Volume Profile 交易策略，包含 TradingView 指標和自動掃描通知系統。

## 策略信號

| 信號 | 方向 | 說明 |
|---|---|---|
| **VA Rejection** | LONG / SHORT | 價格碰到 Value Area 邊緣反轉，機構在防守 |
| **Failed Auction** | LONG / SHORT | 突破 VA 失敗拉回，假突破反轉 |
| **Breakout Retest** | LONG / SHORT | 確認突破後回測支撐，順勢進場 |
| **Climax Volume** | WARNING | 成交量 > 21 日均量 2.5 倍，異常放量警告 |

每個交易信號附帶 Entry、TP、SL，並分 **60D**（波段）和 **120D**（中長線）兩組 lookback 顯示。

### 動態 TP（根據 VIX 調整）

TP 距離根據波動率環境動態調整：

| VIX 水位 | TP 倍數 | 邏輯 |
|---|---|---|
| VIX ≥ 25 | 0.8x | 高波動，提早獲利 |
| 15 < VIX < 25 | 1.0x | 正常 |
| VIX ≤ 15 | 1.3x | 低波動趨勢明確，讓利潤跑 |

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

### 各維度說明

| 維度 | Bullish 條件 | Bearish 條件 |
|---|---|---|
| **Market Structure** | close > swing high | close < swing low |
| **Volume** | 當天量 > 1.5x 均量 | 同 |
| **VWAP Bias** | close > 20日 VWAP | close < 20日 VWAP |
| **Pullback Holds** | 回踩低點守住 swing high（±0.5%） | 反彈高點壓在 swing low 下 |
| **Liquidity Sweep** | 掃過 swing low 後收回上方 | 掃過 swing high 後收回下方 |

## 檔案結構

```
scanner.py                           # 主程式入口
config.py                            # 全域設定、symbol 清單、板塊映射
core/
├── data.py                          # 數據下載 + cache
├── indicators.py                    # 共用指標（VP、ATR、VWAP、Delta、Swing）
└── market_context.py                # 市場環境（VIX、SPY、板塊動能）
strategies/
├── __init__.py                      # BaseStrategy + Signal dataclass
├── vp_signals.py                    # VP 三大信號
└── inst_trend.py                    # 機構趨勢指標（4 維度）
scoring/
└── confidence.py                    # 信心評分引擎
notifications/
├── telegram.py                      # Telegram 通知
└── webhook.py                       # Webhook（未來 API 擴展）
tests/                               # 測試
.github/workflows/
├── vp_scanner.yml                   # 每日排程
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

## 信心評分系統 (Confidence Score)

每個信號附帶 1-5 分的機構級信心評分，幫助判斷是否值得進場。

### 設計理念

機構交易者不會只看單一指標就進場，而是確認多個維度「對齊」後才行動。評分系統模擬這個決策流程：

1. **大盤環境** — 順勢交易勝率更高，逆大盤方向的信號需要更多確認
2. **波動率狀態** — 高 VIX 適合均值回歸（VA Rejection / Failed Auction），低 VIX 適合趨勢突破（Breakout Retest）
3. **量價驗證** — 量能越大代表機構參與度越高，信號越可靠
4. **多時間框架共識** — 60D 和 120D 同方向 = 短中期結構一致，信心更高

### 評分因子

**🔑 Must-have（Gate，未通過會限制最高分）：**

| 信號類型 | Gate 條件 | 未通過結果 |
|---|---|---|
| VA Rejection / Failed Auction | 量能 >1.5x + Regime=Range | 0 過→cap 2, 1 過→cap 3 |
| Breakout Retest | 量能 >1.5x + 趨勢 BULLISH/BEARISH | 0 過→cap 2, 1 過→cap 3 |
| 任何信號 + Expansion | — | 強制 cap 2 |

**📊 Nice-to-have（加分項）：**

| 因子 | 條件 | 分數 |
|---|---|---|
| VIX | VIX < 20（低波動穩定環境） | +1 |
| 大盤配合 | SPY VA 狀態支持信號方向 | +1 |
| 板塊動能 | 所屬板塊 ETF 10日動能配合 | +1 |
| 60D/120D 同方向 | 兩個 lookback 出現同方向信號 | +1 |
| Delta 方向 | 近10日買賣壓方向配合 | +1 |

**⚠️ Penalty：**

| 因子 | 條件 | 分數 |
|---|---|---|
| 財報前 3 天 | 接近財報日，VP 結構可能失效 | -1 |
| VA 過窄 | (VAH-VAL)/ATR < 1.5，方向不明 | -1 |

總分 clamp 至 1-5 分。

### 使用建議

| 分數 | 建議操作 |
|---|---|
| ⭐⭐⭐⭐⭐ (5) | 高信心，正常倉位進場 |
| ⭐⭐⭐⭐ (4) | 條件良好，可進場 |
| ⭐⭐⭐ (3) | 及格，輕倉或等下一根 K 確認 |
| ⭐⭐ (2) | 條件不足，建議觀望 |
| ⭐ (1) | 多重矛盾，不進場 |

## 執行方式

**GitHub Actions（自動）**：每個交易日 UTC 21:05（美東收盤後）自動執行。

**手動執行**：

```bash
pip install yfinance requests pandas numpy
export TELEGRAM_BOT_TOKEN="your_token"
export TELEGRAM_CHAT_ID="your_chat_id"
python scanner.py
```

**Dry Run（不發送 Telegram）**：

```bash
python scanner.py --dry-run
```

## 通知範例

```
📊 VP Signals — 2026-05-04
Scanned 52 symbols | VIX: 18.5 | SPY: in_va

📏 60D Lookback

🟢 NVDA LONG (VA Rejection) ⭐⭐⭐⭐ (4/5)
   Entry: 125.30 | TP: 132.50 | SL: 121.80
   📊 大盤✅ VIX❌ 量能1.8x✅ 趨勢✅ 板塊✅ 雙LB❌ Delta偏多✅

📏 120D Lookback

✅ No signals
```

## 參數說明

| 參數 | 預設值 | 說明 |
|---|---|---|
| `vp_lookback` | 60 | VP 計算回看天數 |
| `va_pct` | 0.68 | Value Area 百分比（≈1 標準差） |
| `atr_len` | 14 | ATR 計算週期 |
| `vol_ma_len` | 21 | 成交量均線週期 |
| `max_sl_atr` | 3.0 | 止損最大 ATR 倍數 |
| `cooldown_bars` | 3 | 同一標的信號冷卻天數 |

## 雙 Lookback 使用建議

| 情境 | 操作 |
|---|---|
| 60D ✅ + 120D ✅ 同方向 | 高信心，正常倉位 |
| 60D ✅ + 120D ❌ | 短線波段操作 |
| 60D ❌ + 120D ✅ | 小倉位試單，等 60D 確認再加倉 |
| 60D 🟢 + 120D 🔴 方向矛盾 | 不進場，觀望 |
