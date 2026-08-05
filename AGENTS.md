# AGENTS.md — AI Agent 開發規範

## Codex 開發 Workflow

進行任何程式碼、測試、設定、部署或 CI 變更時，使用 repo skill `$vp-strategy-workflow`（`.agents/skills/vp-strategy-workflow/`）。依 skill 完成需求定義、最小設計、test-first 實作、受影響測試、完整 diff review 與驗證交付。專案 `.codex/hooks.json` 會在 Codex session 啟動與 compaction 後提醒載入此 workflow。

每次開始修改前，先閱讀 [`docs/CODEX_ARCHITECTURE.md`](docs/CODEX_ARCHITECTURE.md)；若程式碼與文件不一致，以程式碼為準，並在同一次變更中同步更新架構文件。

每次修正功能（含 bug fix）或新增功能時，必須在同一次變更中同步更新根目錄 [`README.md`](README.md)，至少記錄受影響功能的行為、使用方式或限制；交付前確認 README 與實作一致。純重構、測試內部調整或只改文件時不適用。

`scripts/pre-commit` 會阻擋 production code 與 `README.md` 未同時 staged 的 commit；架構敏感變更另要求 staged `docs/CODEX_ARCHITECTURE.md`。Hook 只驗證文件有進入同一個 commit，內容一致性由完整 diff review 與 commit 前 sub-agent review 判定。

## 專案概述

Market Auction Theory 交易分析平台。Python 3.11。Python 分析與 tracker state 採文件式 JSON 儲存；Web 產品層另使用既有 Supabase 提供發布、認證與訂閱資料。

核心有兩個獨立的分析系統：
1. **VP Position Viewer**（`scan_all.py`）— 日線/周線/月線 Volume Profile，顯示價格相對公允價值位置
2. **Accumulation Tracker**（`accumulation.py`）— Wyckoff 機構吸籌追蹤，有 state persistence + decay scoring

## 系統資料流

```
┌─────────────────── VP Position Viewer ───────────────────────┐
│                                                               │
│  YahooProvider.batch_daily(config.SYMBOLS, 1y)                │
│       ↓                                                       │
│  fetch_market_context() → {vix, spy_state}                    │
│       ↓                                                       │
│  compute_vp_multitf(df, 0.68)                                 │
│  → calc_vp(daily, 60) / calc_vp(weekly, 52) / calc_vp(monthly, 12) │
│  → histogram-based: bin prices → find POC → expand VA         │
│       ↓                                                       │
│  Multi-TF position: above_va / inside_va / below_va           │
│       ↓                                                       │
│  data/scan_results.json + Telegram                            │
└───────────────────────────────────────────────────────────────┘

┌─────────────────── Accumulation Tracker ─────────────────────┐
│                                                               │
│  yf.download(symbol, 6mo)                                     │
│       ↓                                                       │
│  compute_daily_score(df, spy_df) → raw_score(0-18) + levels  │
│       ↓                                                       │
│  classify_phase(df, sp, sd, res) → A/B/C/D/E/UNKNOWN        │
│       ↓                                                       │
│  check_failure(df, sp, sd) → hard/soft/spring                │
│       ↓                                                       │
│  tracker.update(symbol, score, phase, levels)                 │
│       ↓  (handles entry/decay/promote/demote/exit)            │
│       ↓                                                       │
│  check_triggers(df, phase, levels) → Spring/LPS/SOS signals  │
│       ↓                                                       │
│  tracker.save_state() → data/accum_state.json (CI auto-commit)│
│       ↓                                                       │
│  Telegram: trigger alerts + proximity alerts + daily report   │
└───────────────────────────────────────────────────────────────┘
```

## 最小改動原則

1. **只改需要改的** — 修 bug 不要順便重構周圍的 code，加功能不要改現有介面
2. **保持向後相容** — `StrategySignal`、`AccumulationTracker` 的 public API 不能 breaking change
3. **一個 commit 一件事** — 不要在同一個 commit 混合 feature + refactor + fix
4. **不引入新依賴** — 除非功能無法用現有 lib 實現，必須先確認 requirements.txt 裡沒有替代方案
5. **不改 config 預設值** — `DEFAULT_CFG`、`SCORING_WEIGHTS`、`REGIME_THRESHOLDS` 的預設值是經過 backtest 調出來的，改了要跑 `python backtest_multi.py` 驗證

## 架構限制

### 禁止事項
- 不把 Python 分析結果或 tracker state 遷移到 database（SQLite、Postgres 等）— 這一層維持 JSON；Web 層可使用既有 Supabase，但不得讓策略計算直接依賴它
- 不加 async/await — 整個 codebase 是同步的，yfinance 不支援 async
- 不加 class inheritance chain 超過 2 層 — `BaseStrategy → VPSignals` 就是上限
- 不改 `scan_results.json` 的 schema — UI 層依賴這個格式
- 不改 `accum_state.json` 的現有欄位 — 新增欄位必須有 default 值
- 不改 GitHub Actions 的 cron 時間 — 對應美股交易時段，改了會錯過收盤數據
- 不在策略計算中使用 future data（look-ahead bias）
- 策略之間不能互相 import（`vp_signals` 不能 import `vwap_signals`）
- `regime/` 不能 import `strategies/`，`strategies/` 不能 import `scoring/`

### 必須遵守
- 所有策略必須 return `list[StrategySignal]`（見 `core/signal.py`）
- 新策略必須繼承 `BaseStrategy` 並實作 `detect(df, cfg, market_ctx) → list[StrategySignal]`
- `StrategySignal` 必填欄位：ticker, timestamp, strategy, signal_type, direction, confidence, entry, stop, target, holding_type
- `direction` 只能是 `"LONG"` / `"SHORT"` / `"NEUTRAL"` / `"WARNING"`
- `holding_type` 只能是 `"short"` / `"mid"` / `"long"`，對應 `TRACK_MAP` 分軌
- `confidence` 範圍 0.0–1.0，Fusion 會乘以 100 轉成 score
- 所有金額用 `float`，保留 2 位小數；分數用 `int` 或 `float`，不用 `Decimal`
- Telegram 訊息長度 ≤ 4096 字元（API 限制），超過要截斷
- State 文件寫入用 `json.dumps(indent=2, ensure_ascii=False)`

## 核心 Schema 速查

### StrategySignal（core/signal.py）
```python
@dataclass
class StrategySignal:
    ticker: str           # "NVDA"
    timestamp: datetime
    strategy: str         # "VP" / "VWAP" / "TrendFollowing" / "VP: VA Rejection"
    signal_type: str      # 必須在 TRACK_MAP 中有對應
    direction: str        # "LONG" / "SHORT" / "NEUTRAL" / "WARNING"
    confidence: float     # 0.0-1.0
    entry: float
    stop: float
    target: float
    holding_type: str     # "short" / "mid" / "long"
    reasons: List[str]
    warnings: List[str]
    triggered: bool       # False = informational only (不進 fusion scoring)
```

### TRACK_MAP（信號分軌）
```
short: VA Rejection, Failed Auction, VWAP Deviation, Climax Volume
mid:   Breakout Retest, VWAP Reclaim, AVWAP Pullback, Compression Breakout
long:  Breakout Acceptance, EMA Cross
```

### RegimeState（regime/engine.py）
```python
regime: "range" / "trend" / "expansion" / "compression"
normalized_trust: {"VP": 0.48, "VWAP": 0.38, "TrendFollowing": 0.14}  # sums to 1.0
```

### AccumulationTracker State（per symbol）
```python
{
    "phase": "B",           # A/B/C/D/E/UNKNOWN
    "tier": "watch",        # "watch" / "confirmed"
    "decay_score": 8.5,     # 持續衰減，max(raw_today, prev * decay_rate)
    "raw_score": 10,        # 當天原始分 0-18
    "support_primary": 140.0,
    "support_dynamic": 145.0,
    "resistance": 160.0,
    "promote_streak": 0,    # 連續 N 天 above CONFIRM_THRESHOLD(9) → promote
    "demote_streak": 0,
    "failing": False,
    "triggers_fired": [],
}
```

## 目錄與模組職責

| 目錄 | 職責 | 修改注意 |
|------|------|---------|
| `core/` | 資料 provider + 純指標計算 + VP 多 TF | `data_provider.py` 有網路/cache IO；指標函數保持低副作用，改了跑對應 core tests |
| `regime/` | 市場狀態判斷 | 只能依賴 `core/indicators.py` + `config.py`，backtest 用 |
| `strategies/` | 信號產生 | 每個策略獨立，不能互相 import，backtest 用 |
| `strategies/accumulation/` | Wyckoff 累積追蹤 | 有 state persistence，改 tracker 要跑全部 `test_accumulation_*.py` |
| `scoring/` | Legacy 評分 | backtest 用，改動要跑 backtest 驗證 |
| `services/frontend/` | Next.js Web UI | 展示與產品 gate；分析資料來自 JSON/Supabase API |
| `notifications/` | Telegram 通知 | 只負責格式化 + 發送 |
| `tests/` | pytest 測試 | 新功能必須有對應測試 |

## 資料流方向（嚴格單向）

主要分析方向是 `core → regime/strategies → entry points → JSON/通知`。精確允許關係以 `docs/CODEX_ARCHITECTURE.md` 的依賴矩陣為準；其中 legacy `scoring/confidence.py` 目前允許依賴 `strategies/inst_trend.py`，但 strategies 不得反向 import scoring。

## 測試規範

- 跑測試：`pytest tests/`
- 新增函數必須有測試，覆蓋 happy path + edge case（空 DataFrame、insufficient data）
- 測試中使用 synthetic data（`_make_df()` helper），不要 call `yf.download`
- Mock 外部 API（yfinance、Telegram）— 測試不能依賴網路
- Accumulation 相關改動要跑：
  - `pytest tests/test_accumulation_tracker.py`
  - `pytest tests/test_accumulation_detector.py`
  - `pytest tests/test_phase_classifier.py`
  - `pytest tests/test_entry_triggers.py`
  - `pytest tests/test_accumulation_notifications.py`

## 常見操作的正確做法

### 新增一個技術指標
1. 在 `core/indicators.py` 新增純函數
2. 在 `tests/test_indicators.py` 加測試
3. 在需要的 strategy 中 import 使用

### 新增一個策略信號
1. 在對應的 `strategies/*_signals.py` 中新增 detection logic
2. 確保 return `StrategySignal` 格式，`signal_type` 必須加進 `core/signal.py` 的 `TRACK_MAP`
3. 加測試
4. 跑 `python backtest_multi.py` 看 Sharpe 有沒有提升

### 修改 Accumulation Tracker
1. 改 `strategies/accumulation/tracker.py`
2. 跑 `pytest tests/test_accumulation_tracker.py`
3. 確認 `save_state` / `load_state` round-trip 正常
4. State schema 新增欄位要給 default 值（向後相容舊 state）

### 修改通知格式
1. 改 `notifications/telegram.py` 或 `strategies/accumulation/notifications.py`
2. 確認訊息 ≤ 4096 字元
3. 用 `--dry-run` 測試，不要直接發

### 修改 VP Scanner
1. VP 計算邏輯在 `core/indicators.py` 的 `calc_vp()`
2. 多時間框架在 `core/vp_multitf.py`
3. 主流程在 `scan_all.py`
4. 改了要跑 `pytest tests/test_indicators.py`
5. 不改 `calc_vp` 的回傳格式（`{"poc", "vah", "val"}`）

## Git 規範

- Branch naming: `feat/xxx`、`fix/xxx`、`refactor/xxx`
- Commit message 格式: `type: 簡短描述`（feat/fix/refactor/chore/test）
- `data/accum_state.json` 由 CI 自動 commit，手動不要改
- `data/scan_results.json` 不進 git

## AI Agent Commit Protocol（強制）

**每次 commit 前必須執行 sub-agent review，無例外。**

流程：
1. Agent 完成修改
2. Agent 開 sub-agent（reviewer 角色）review 本次所有改動
3. Reviewer 依據以下 checklist 逐項確認：
   - [ ] 是否違反資料流方向（單向依賴）
   - [ ] 是否有跨策略 import
   - [ ] 新欄位是否有 default 值（向後相容）
   - [ ] StrategySignal 格式是否正確（必填欄位、direction/holding_type 值域）
   - [ ] 新 signal_type 是否已加入 TRACK_MAP
   - [ ] config 預設值是否被改動（需 backtest 驗證）
   - [ ] 測試是否通過（跑受影響的 test files）
   - [ ] 是否引入新依賴（需確認必要性）
   - [ ] 功能修正或新增是否已同步更新 `README.md`
   - [ ] commit 是否只做一件事（不混合 feature + refactor + fix）
   - [ ] 訊息格式是否正確（type: 描述）
4. Reviewer 回報 PASS / FAIL + 原因
5. PASS → 執行 commit
6. FAIL → 修正後重新 review

## 效能注意事項

- `yf.download` 很慢（每 symbol ~1-2s），用 `YahooProvider.batch_daily()` batch 下載
- DataFrame 計算用 vectorized numpy，不要 for loop iterrows
- `scan_all.py` 掃描 `config.SYMBOLS` 約 2-3 分鐘，不要加太多重計算
- `accumulation.py` 掃描同一份 `config.SYMBOLS`，每檔獨立下載（約 2 分鐘）
- GitHub Actions 免費額度有限，workflow 不要跑超過 10 分鐘
- `calc_vp` 和 `find_swing_points` 是最常被呼叫的，改動要注意效能

## 環境變數

| 變數 | 用途 | 必要性 |
|------|------|--------|
| `TELEGRAM_BOT_TOKEN` | Telegram 通知 | 選用（dry-run 不需要）|
| `TELEGRAM_CHAT_ID` | Telegram 目標群組 | 選用 |
| `TEAMS_WEBHOOK_URL` | Microsoft Teams Incoming Webhook | 選用 |
| `GEMINI_API_KEY` | AI 分析（選用功能）| 選用 |

## GitHub Actions Workflows

| Workflow | 時間 (UTC) | 功能 |
|----------|-----------|------|
| `vp_scanner.yml` | 21:05 Mon-Fri | scanner + accumulation + auto-commit state |
| `pre_market.yml` | 13:00 Mon-Fri | 開盤前觀察清單 |
| `backtest.yml` | 手動 | 回測/優化 |
| `tests.yml` | PR/push | CI 測試 |
