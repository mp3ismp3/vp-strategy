# CLAUDE.md

Project-level behavioral guidelines for AI agents working on the vp-strategy Multi-Strategy Analysis Platform.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks (typo fixes, obvious one-liners), use judgment.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
- Identify which system (Scanner vs Accumulation) is affected — they are independent.
- Check data flow direction before adding imports.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add a signal" → "Write test, implement detection, add to TRACK_MAP, verify backtest"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

---

## Project-Specific Rules

### Architecture (Strict)

**Data flow is unidirectional:**
```
core/data_provider → core/indicators → regime/engine → strategies/* → scoring/* → JSON/Telegram
```

**Forbidden:**
- No database (system is file-based JSON by design)
- No async/await (synchronous codebase, yfinance doesn't support async)
- No class inheritance > 2 levels
- No cross-strategy imports (`vp_signals` cannot import `vwap_signals`)
- No reverse dependencies (`regime/` cannot import `strategies/`, `strategies/` cannot import `scoring/`)
- No look-ahead bias in strategy calculations
- No modifying `scan_results.json` schema (UI depends on it)
- No modifying existing `accum_state.json` fields (new fields need defaults)
- No changing GitHub Actions cron times (aligned with US market hours)
- No changing `DEFAULT_CFG` / `SCORING_WEIGHTS` / `REGIME_THRESHOLDS` without running backtest

### Schema Contracts

All strategies must return `list[StrategySignal]`:
- `direction`: `"LONG"` / `"SHORT"` / `"NEUTRAL"` / `"WARNING"`
- `holding_type`: `"short"` / `"mid"` / `"long"`
- `confidence`: 0.0–1.0
- New `signal_type` → must add to `TRACK_MAP` in `core/signal.py`

### Testing

Run before committing:
```bash
pytest tests/                              # All tests must pass
pytest tests/test_indicators.py            # After indicator changes
pytest tests/test_accumulation_*.py        # After accumulation changes
pytest tests/test_fusion.py                # After scoring changes
python backtest_multi.py                   # After weight/config changes
```

- Use synthetic data in tests, never call `yf.download`
- Mock external APIs (yfinance, Telegram)
- New functions must have corresponding tests

### Performance

- Use `YahooProvider.batch_daily()` for bulk downloads
- Vectorized numpy/pandas operations only (no `iterrows()`)
- Telegram messages ≤ 4096 chars
- Workflows must finish within 10 minutes

### Git

- One commit = one thing (never mix feature + refactor + fix)
- Format: `type: 簡短描述` (feat/fix/refactor/chore/test)
- Branch: `feat/xxx`, `fix/xxx`, `refactor/xxx`
- `data/accum_state.json` — CI auto-commit only, don't edit manually
- Sub-agent review required before every commit

---

**These guidelines are working if:** fewer unnecessary changes in diffs, architecture boundaries stay clean, backtest metrics don't regress, and state files remain backward-compatible.
