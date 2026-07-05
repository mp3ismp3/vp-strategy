# Accumulation Tracker v4 — 設計文件

## 問題陳述

現有 `accumulation.py` (v3) 只做單次快照評分，存在三個根本問題：
1. **無進場時機** — 只告訴你「有 accumulation」，不告訴你「什麼時候進場」
2. **無狀態追蹤** — 每次執行從零開始，無法追蹤標的隨時間的吸籌進展
3. **無失敗偵測** — 不知道什麼時候該把標的移出清單

## 設計目標

建立一個 **有狀態的吸籌追蹤系統**：
- 維護一個動態清單（自動偵測、加入、追蹤、降級、移除）
- 每天告訴你清單狀態（每檔處於什麼階段、距離觸發多遠）
- 觸發時獨立通知（不混在日報裡）
- 判斷錯誤就移除（區分 Spring 和真正失敗）

---

## 需求（討論確認）

### [1] 入列 + 確認邏輯

**決策：低門檻入列 + 衰減式評分 + 雙閾值**

| 設計決策 | 內容 |
|----------|------|
| 入列 | 低門檻（少數指標達標即進入觀察層，score ≥ 5） |
| 確認 | 衰減評分上升到確認閾值（score ≥ 9，連續 2 次） |
| 衰減速度 | Phase A/B: 慢衰減 0.85/天 (~10-15 天) / Phase C/D: 快衰減 0.75/天 (~5-7 天) |
| 兩層清單 | 觀察（Watchlist）+ 確認（Confirmed） |
| 清單容量 | 不限，靠衰減機制自然管理 |
| 防抖動 | 升級/降級需連續 2 次超過/低於閾值 |
| 自動退場 | 分數衰減到 EXIT_THRESHOLD (3) 自動移除 |

**衰減公式：**
```
new_score = max(raw_score_today, prev_score × decay_rate)
```
- 如果今天有新證據（raw score 高），覆蓋衰減
- 如果沒有新證據，前次分數自然衰減
- Phase A/B 衰減慢（主力休息幾天正常）
- Phase C/D 衰減快（進場階段動能很重要）

**理由：**
- 不用「連續 N 天」的剛性確認（吸籌有間歇性，洗盤會打斷）
- 不用「寬鬆維持」（避免殭屍標的堆積）
- 用衰減分數讓清單自然呼吸

---

### [2] 進場時機通知

**決策：平時告訴你等什麼 + 觸發當天獨立通知 + 接近觸發預警**

| 通知類型 | 觸發條件 | 格式 |
|----------|---------|------|
| 📋 每日狀態報告 | 每天收盤後固定發送 | 全清單 + 階段 + 距離觸發 + 變動 |
| ⚡ 進場觸發 | 當天偵測到 Spring/LPS/SOS 觸發 | 獨立通知：Entry/SL/TP/RR |
| ⚠️ 接近觸發 | 價格距觸發 < 2% | 獨立預警：觸發價 + 目前差距 |

**通知發送順序：** 觸發 → 預警 → 日報（重要的先發）

**三種進場點：**

| 觸發類型 | 對應 Wyckoff | 條件 | 部位建議 |
|----------|-------------|------|---------|
| Spring | Phase C | 跌破 support_dynamic + 收回 + volume + close 上半 | PILOT 10-25% |
| LPS | Phase D | 回踩 + 量縮 < 0.7x + hold above swing low + close 上半 | ADD 25-40% |
| SOS Breakout | Phase D→E | 收盤 > resistance + 量 > 1.5x 或連續 2 天站穩 | FULL POSITION |

---

### [3] 移除邏輯

**決策：跌破 support + 量增 + 收低 = 失敗 / 分數衰減到下限 = 自然退場**

| 失敗類型 | 條件 | 動作 |
|----------|------|------|
| Hard Failure | 收盤 < Primary Support + 量 > 1.5x median + close < 25% of bar | 直接移除 |
| Hard Failure | 連續 2 天收盤 < Primary Support | 直接移除 |
| Soft Failure | 收盤 < Dynamic Support + 量 > 1.2x median + close < 40% of bar | 標記 failing，連續 2 天移除 |
| Spring (非失敗) | 盤中跌破 support 但收盤收回（Low < support, Close > support） | 不移除，標記 is_spring |
| 自然退場 | 衰減分數 < EXIT_THRESHOLD (3) | 自動移除 |

**Support 雙層設計：**
- Primary Support = SC low（固定，整個 accumulation 的絕對底線）
- Dynamic Support = 最近的 swing low（隨階段上移）
- Phase A/B：support = SC low
- Phase C/D：support = 最近 higher low

---

## 系統架構

```
┌─────────────────────────────────────────────────────────────────┐
│                     Accumulation Tracker v4                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  每日掃描 SYMBOLS (52 檔)                                         │
│       │                                                           │
│       ▼                                                           │
│  detector.py: compute_daily_score()                              │
│  • OBV 分段 slope (加速/新啟動/已結束)                             │
│  • Volume Asymmetry (指數加權)                                    │
│  • ATR Tightening (percentile-based)                             │
│  • Close Position + Buying Streak                                │
│  • Relative Strength (beta-adjusted)                             │
│  → raw_score (0-18) + support/resistance levels                  │
│       │                                                           │
│       ▼                                                           │
│  phase_classifier.py: classify_phase()                           │
│  • Phase E: 突破 resistance + volume                             │
│  • Phase D: Higher lows + SOS rally                              │
│  • Phase C: Spring (跌破+收回) 或接近 spring 區域                  │
│  • Phase B: 區間震盪 + OBV 上升 + 測試量遞減                      │
│  • Phase A: 顯著下跌 + Stopping Volume                           │
│  → phase + confidence + next_event                               │
│       │                                                           │
│       ▼                                                           │
│  check_failure(): Spring vs 真失敗                                │
│  • 盤中刺穿收盤拉回 = Spring ✅                                    │
│  • 跌破 + 量增 + 收低 = 失敗 ❌                                    │
│       │                                                           │
│       ▼                                                           │
│  tracker.py: update() — 衰減評分 + 升降級                         │
│  • new_score = max(raw_today, prev × decay_rate)                 │
│  • 超過 CONFIRM_THRESHOLD × 2 次 → 升級                          │
│  • 低於 EXIT_THRESHOLD → 移除                                     │
│       │                                                           │
│       ▼                                                           │
│  entry_triggers.py: check_triggers()                             │
│  • Spring Entry (Phase C)                                        │
│  • LPS Entry (Phase D)                                           │
│  • SOS Breakout (Phase D→E)                                      │
│  → triggered[] + proximity[] + distance{}                        │
│       │                                                           │
│       ▼                                                           │
│  notifications.py → Telegram                                     │
│  • ⚡ Trigger Alert (獨立)                                       │
│  • ⚠️ Proximity Alert (獨立)                                     │
│  • 📋 Daily Report (固定)                                        │
│       │                                                           │
│       ▼                                                           │
│  tracker.save_state() → data/accum_state.json                    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 檔案結構

```
strategies/accumulation/
├── __init__.py              # Public API exports
├── config.py               # 所有閾值和參數
├── tracker.py              # AccumulationTracker class（狀態 + 衰減）
├── detector.py             # compute_daily_score()（6 指標評分）
├── phase_classifier.py     # classify_phase()（Wyckoff A-E）
├── entry_triggers.py       # check_triggers()（Spring/LPS/SOS）
└── notifications.py        # 三種通知格式

accumulation.py             # 整合入口（完整 pipeline）
data/accum_state.json       # 持久化狀態（gitignored）
```

---

## 狀態持久化結構

`data/accum_state.json`:
```json
{
  "NVDA": {
    "phase": "D",
    "tier": "confirmed",
    "decay_score": 11.2,
    "raw_score": 12,
    "raw_history": [8, 9, 10, 11, 12],
    "entered_date": "2026-07-01",
    "last_updated": "2026-07-05",
    "support_primary": 128.5,
    "support_dynamic": 134.2,
    "resistance": 142.3,
    "promote_streak": 0,
    "demote_streak": 0,
    "failing": false,
    "fail_days": 0,
    "triggers_fired": [
      {"type": "SPRING", "date": "2026-07-02"}
    ],
    "removed_reason": null
  }
}
```

---

## 通知格式

### 每日狀態報告

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 吸籌追蹤報告 — 2026-07-05 16:05 ET
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 市場: 🟢 VIX 16.5 | SPY 上漲趨勢

━━ ⚡ 今日觸發 ━━
🟢 NVDA — SOS_BREAKOUT
   Entry $143.5 | SL $134.0 | TP $156.0 | R:R 1:1.3
   突破 $142.3 + 量 1.8x

━━ ✅ 確認吸籌 (2) ━━
  NVDA | Phase D | 12.0分 | 5天
    距觸發: SOS_BREAKOUT 差 0.0%
  AVGO | Phase D | 10.5分 | 8天
    距觸發: SOS_BREAKOUT 差 1.4%

━━ 👀 觀察中 (3) ━━
  AMD | Ph.C | 7.2分 | 3天
  PLTR | Ph.B | 6.1分 | 12天
  CRM | Ph.A | 5.5分 | 2天

━━ 📋 狀態變動 ━━
  🆕 新增: CRM (Phase A, 5分)
  📈 升級: NVDA → 確認 (12.0分)
  ❌ 移除: GOOGL (連續2天收盤 < 主支撐)

📊 總計: 5 檔追蹤 (✅2 + 👀3)
```

### 進場觸發（獨立通知）

```
⚡ 進場信號 — NVDA

🚀 類型: SOS 突破進場
💰 Entry: $143.5 | SL: $134.0 | TP: $156.0
📊 R:R = 1:1.3
📝 原因: 突破 $142.3 + 量 1.8x
🎯 行動: FULL POSITION
📍 階段: Phase D — 已突破
```

### 接近觸發（獨立預警）

```
⚠️ 接近觸發 — AVGO

類型: SOS 突破
觸發價: $180.0 (目前 $177.5, 差 1.4%)
量能: 量能 85% (需 1.5x median)
💡 建議: 設定價格警報 $180.0
📍 區間吸籌中
```

---

## 偵測邏輯改進（vs v3）

| 指標 | v3 (原版) | v4 (新版) |
|------|----------|----------|
| Spike filter | `np.mean(v)` | `np.median(v)` — 不被 spike 汙染 |
| OBV | 整段 linear regression | 分段 slope (前半 vs 後半) — 區分加速/結束 |
| Volume Asymmetry | 簡單平均 | 指數加權 — 近期比遠期重要 |
| ATR Tightening | 硬切 10/20 天比較 | Percentile rank — 更穩健 |
| Relative Strength | 固定閾值 | Beta-adjusted alpha — 考慮個股 beta |
| Price Position Guard | Discount 乘數 | 移除 — 改由 phase/衰減機制處理 |
| Support | 無 | 雙層 (Primary SC + Dynamic Swing Low) |

---

## 參考框架

| 來源 | 應用到的部分 |
|------|-------------|
| **Wyckoff Method** (5 Phases A-E) | phase_classifier.py — 階段判斷 |
| **Volume Spread Analysis** (Tom Williams) | check_failure() — Stopping Volume / No Supply 判斷 |
| **Minervini VCP** | detector.py — ATR percentile compression |
| **Prop Desk Staged Entry** | entry_triggers.py — Pilot → Add → Full |
| **SqueezeMetrics DIX** | 預留擴充口（目前無免費個股資料） |

---

## 使用方式

```bash
# 完整掃描（主要功能）
python3 accumulation.py --dry-run          # 掃描 + 印出（不發通知）
python3 accumulation.py --notify           # 掃描 + 發 Telegram

# 單股/多股分析
python3 accumulation.py NVDA --debug       # 詳細 component breakdown
python3 accumulation.py NVDA,AVGO --phase  # 只看階段分類
python3 accumulation.py NVDA --triggers    # 只看觸發狀態

# 自訂 lookback
python3 accumulation.py --days 60          # 用 60 天回看
```

---

## 排程（GitHub Actions）

`.github/workflows/vp_scanner.yml` — 每週一至五 21:05 UTC (= 17:05 ET 收盤後):
```yaml
- name: Run accumulation scan
  run: python accumulation.py --notify
```

---

## 未來擴充

| 優先級 | 功能 | 說明 |
|--------|------|------|
| 高 | Backtest 驗證 | 跑歷史資料驗證觸發後勝率 |
| 高 | Walk-forward 優化 | 根據 backtest 結果自動調整閾值 |
| 中 | 多時間框架 | 週線確認方向 + 日線觸發 |
| 中 | 板塊關聯 | 同類股多檔同時 accumulate → 信號更強 |
| 低 | Options flow | 接 API 作為 bonus 加分 |
| 低 | Dark Pool (DIX) | 等有個股級資料再加 |

---

## 測試覆蓋

- `tests/test_accumulation_tracker.py` — 衰減、升降級、失敗、退場 (22 tests)
- `tests/test_accumulation_detector.py` — 評分、OBV、levels (10 tests)
- `tests/test_phase_classifier.py` — 所有 5 phase + UNKNOWN (8 tests)
- `tests/test_entry_triggers.py` — Spring/LPS/SOS + 假信號 (10 tests)
- `tests/test_accumulation_notifications.py` — 格式化 + 截斷 (12 tests)

**Total: 62 tests, all passing.**
