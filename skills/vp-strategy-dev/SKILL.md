---
name: vp-strategy-dev
description: Development guidelines for the vp-strategy Multi-Strategy Analysis Platform. Use when writing, reviewing, or modifying code in this Market Auction Theory trading analysis system to maintain architecture integrity, data flow direction, and backward compatibility.
license: MIT
---

# VP-Strategy Development Skill

Domain-specific development guidelines for the Multi-Strategy Analysis Platform (Market Auction Theory). Combines Karpathy's 4 behavioral principles with project-specific architecture rules.

## Core Principles

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

**Domain-specific:**
- Understand which system you're modifying (Scanner vs Accumulation Tracker) — they are independent.
- Check the data flow direction before adding imports. Violations cause circular imports.
- If a change affects scoring weights or config defaults, say so — these are backtest-calibrated.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

**Domain-specific:**
- No database (SQLite, Postgres, etc.) — system is file-based JSON by design.
- No async/await — entire codebase is synchronous, yfinance doesn't support async.
- No class inheritance beyond 2 levels (`BaseStrategy → ConcreteStrategy` is the max).
- Use vectorized numpy/pandas operations, not `iterrows()` loops.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

**Domain-specific:**
- Don't change `DEFAULT_CFG`, `SCORING_WEIGHTS`, or `REGIME_THRESHOLDS` defaults without running backtest.
- Don't modify `scan_results.json` schema — UI layer depends on it.
- Don't modify existing fields in `accum_state.json` — new fields must have default values.
- Don't change GitHub Actions cron times — they align with US market close.
- One commit = one thing. Never mix feature + refactor + fix.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add a signal" → "Implement detection, add to TRACK_MAP, write test, run backtest"
- "Fix scoring" → "Write test reproducing wrong score, fix, verify backtest Sharpe"
- "Modify tracker" → "Ensure save/load round-trip, run accumulation test suite"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

**Domain-specific verification:**
- New indicators: `pytest tests/test_indicators.py`
- Strategy changes: `pytest tests/test_strategies.py` + `python backtest_multi.py`
- Accumulation changes: `pytest tests/test_accumulation_*.py tests/test_phase_classifier.py tests/test_entry_triggers.py`
- Fusion/scoring changes: `pytest tests/test_fusion.py`
- Any change: `pytest tests/` must pass

---

## Architecture Rules

### Data Flow (Strict Unidirectional)

```
core/data_provider → core/indicators → regime/engine → strategies/* → scoring/* → JSON/Telegram
```

No reverse dependencies. Violating this causes circular imports.

### Module Boundaries

| Module | Can Import From | Cannot Import From |
|--------|----------------|-------------------|
| `core/` | stdlib, numpy, pandas, yfinance | regime/, strategies/, scoring/ |
| `regime/` | core/indicators, config | strategies/, scoring/ |
| `strategies/*` | core/, regime/, config | other strategies, scoring/ |
| `scoring/` | core/signal, config | strategies/, regime/ |
| `notifications/` | stdlib, requests | strategies/, scoring/ |

**Strategies are isolated** — `vp_signals` cannot import `vwap_signals` or `trend_signals`.

### Schema Contracts

**StrategySignal** (all strategies must return `list[StrategySignal]`):
- Required: ticker, timestamp, strategy, signal_type, direction, confidence, entry, stop, target, holding_type
- `direction`: `"LONG"` / `"SHORT"` / `"NEUTRAL"` / `"WARNING"`
- `holding_type`: `"short"` / `"mid"` / `"long"` (maps to TRACK_MAP)
- `confidence`: 0.0–1.0 (Fusion multiplies by 100)
- New `signal_type` must be added to `TRACK_MAP` in `core/signal.py`

**FusionResult**:
- `best_score`: int 0-100 (scanner ranking basis)
- `direction`, `label`, `best_track`, `best_setup` — all backward-compatible aliases

**AccumulationTracker state** (per symbol):
- New fields must have default values (backward compat with existing `accum_state.json`)
- Write with `json.dumps(indent=2, ensure_ascii=False)`

### Prohibited Actions

- No look-ahead bias in strategy calculations (no future data)
- No new dependencies without confirming `requirements.txt` has no alternative
- No Telegram messages > 4096 chars (API hard limit)
- No manual edits to `data/accum_state.json` (CI auto-commits)
- No `data/scan_results.json` in git

---

## Common Operations

### Adding a Technical Indicator
1. Pure function in `core/indicators.py`
2. Test in `tests/test_indicators.py`
3. Import in the strategy that needs it

### Adding a Strategy Signal
1. Detection logic in `strategies/*_signals.py`
2. Return `StrategySignal` with valid `signal_type`
3. Add `signal_type` to `TRACK_MAP` in `core/signal.py`
4. Add test
5. Run `python backtest_multi.py` — Sharpe must not regress

### Adding a New Strategy Class
1. Create class in `strategies/` inheriting `BaseStrategy`
2. Implement `detect(df, cfg, market_ctx) → list[StrategySignal]`
3. Add instance to `STRATEGIES` in `scan_all.py`
4. Add trust values to all 4 regimes in `config.py` `REGIME_STRATEGY_TRUST`
5. Add weight to `SCORING_WEIGHTS` (rebalance to sum = 1.0)
6. Backtest to verify

### Modifying Accumulation Tracker
1. Edit `strategies/accumulation/tracker.py`
2. Run `pytest tests/test_accumulation_tracker.py`
3. Verify `save_state` / `load_state` round-trip
4. New state fields require default values

---

## Testing Standards

- Use synthetic data (`_make_df()` helpers), never call `yf.download` in tests
- Mock external APIs (yfinance, Telegram) — tests must not require network
- Cover happy path + edge cases (empty DataFrame, insufficient data)
- New functions must have corresponding tests

---

## Git & CI

- Branch: `feat/xxx`, `fix/xxx`, `refactor/xxx`
- Commit: `type: 簡短描述` (feat/fix/refactor/chore/test)
- `data/accum_state.json` — CI auto-commit only
- `data/scan_results.json` — not in git
- Sub-agent review required before every commit (see AGENTS.md protocol)

---

**These guidelines are working if:** architecture boundaries stay clean, backtest metrics don't regress, state files remain backward-compatible, and diffs contain only what was requested.
