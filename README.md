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

## 檔案結構

```
vp_scanner.py                        # 自動掃描 + Telegram 通知
volume_profile_strategy.pine         # TradingView Pine Script 指標
.github/workflows/vp_scanner.yml    # GitHub Actions 每日排程
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

每個信號附帶 1-5 分的機構級信心評分：

| 因子 | 條件 | 分數 |
|---|---|---|
| 大盤配合 | SPY VA 狀態支持信號方向 | +1 |
| VIX 環境 | 均值回歸信號 VIX≥20 / 突破信號 VIX<20 | +1 |
| 量能強度 | Volume > 1.5x 均量 | +1 |
| POC/趨勢對齊 | POC 20日斜率方向配合 | +1 |
| 板塊動能 | 所屬板塊 ETF 10日動能配合 | +1 |
| 60D/120D 同方向 | 兩個 lookback 出現同方向信號 | +1 |
| Delta 方向 | 近10日買賣壓方向配合 | +1 |
| 財報前 3 天 | 接近財報日，VP 結構可能失效 | -1 |
| VA 過窄 | (VAH-VAL)/ATR < 1.5，方向不明 | -1 |

總分 clamp 至 1-5 分。

## 執行方式

**GitHub Actions（自動）**：每個交易日 UTC 21:05（美東收盤後）自動執行。

**手動執行**：

```bash
pip install yfinance requests pandas numpy
export TELEGRAM_BOT_TOKEN="your_token"
export TELEGRAM_CHAT_ID="your_chat_id"
python vp_scanner.py
```

**Dry Run（不發送 Telegram）**：

```bash
python vp_scanner.py --dry-run
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
