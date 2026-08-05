# Change gates

Use this matrix after identifying files in scope. Apply every matching row.

| Scope | Required checks | Extra review gates |
|---|---|---|
| `core/indicators.py`, `core/vp_multitf.py` | `pytest tests/test_indicators.py tests/test_vp_multitf.py` | Pure/vectorized calculation, stable VP return schema, no look-ahead |
| `regime/` | `pytest tests/test_regime.py` | May depend only on core indicators/config; no strategy or scoring import |
| `strategies/vp_signals.py` | `pytest tests/test_strategies.py tests/test_vp_multitf.py` and backtest | Valid `StrategySignal`, `TRACK_MAP`, no cross-strategy import |
| `strategies/vwap_signals.py` | `pytest tests/test_vwap_strategy.py` and backtest | Valid `StrategySignal`, `TRACK_MAP`, no cross-strategy import |
| `strategies/trend_signals.py`, `strategies/inst_trend.py` | `pytest tests/test_trend_strategy.py tests/test_strategies.py` and backtest | Valid `StrategySignal`, `TRACK_MAP`, no cross-strategy import |
| `strategies/accumulation/`, `accumulation.py` | all `tests/test_accumulation_*.py`, `test_phase_classifier.py`, `test_entry_triggers.py` | State round trip, new fields defaulted, no manual state edit |
| `scoring/`, tuned config or strategy thresholds | `pytest tests/test_scoring.py`; relevant strategy tests; `python backtest_multi.py` | Compare metrics; disclose regressions; preserve defaults unless requested |
| `notifications/` | relevant notification tests; dry-run entry point | No real send; Telegram output at most 4096 chars; no secrets in logs |
| `services/frontend/` | commands exposed by `package.json` | Read nested `AGENTS.md` and installed Next.js docs; preserve JSON API contracts |
| `.github/workflows/` | YAML parse/review; relevant local command | Do not change cron times; keep runtime below ten minutes; least privileges |
| `deploy/`, Stripe, Supabase, bot services | available config/build checks | No live deploy or external mutation without explicit request; never expose secrets |

For any non-trivial Python behavior change, run `pytest tests/` after focused checks. If a required command cannot run because dependencies, credentials, network, or services are unavailable, report the exact command and blocker; do not silently substitute inspection for execution.
