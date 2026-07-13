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
streamlit run ui/app.py
```

兩個頁面：
- **Scanner** — VP 多時間框架 K 線圖 + VP 直方圖 + 操作建議
- **Accumulation** — 追蹤中標的的 K 線 + OBV + 支撐壓力

### 回測/優化

```bash
python backtest_multi.py            # 多策略日線回測
python pre_market.py --dry-run      # 開盤前觀察清單
python intraday.py --dry-run        # 盤中 1H 確認
```

### 測試

```bash
pytest tests/                       # 137 個測試
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
ui/
├── app.py                           # Streamlit 主程式 + 導航
├── scanner_page.py                  # VP 多 TF 圖表
├── accumulation_page.py             # Accumulation 視覺化
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
