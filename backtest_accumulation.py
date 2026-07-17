"""
Accumulation Tracker Walk-Forward Backtest.

Validates Spring/LPS/SOS trigger signals with proper out-of-sample testing.

Design:
  - Walk-forward: rolling train/test windows with final holdout
  - Parameter robustness: sweep ENTRY_THRESHOLD × CONFIRM_THRESHOLD
  - No look-ahead bias: entry at next-day Open after trigger
  - SL/TP from trigger return values (consistent with live)
  - Bootstrap confidence intervals for statistical significance

Usage:
    python backtest_accumulation.py
    python backtest_accumulation.py --symbols NVDA,AMD,AAPL
    python backtest_accumulation.py --robustness
    python backtest_accumulation.py --days 750
"""

import argparse
from dataclasses import dataclass
from copy import deepcopy

import numpy as np
import pandas as pd
import yfinance as yf

from config import SYMBOLS
from core.indicators import calc_vp
from strategies.accumulation.config import (
    DECAY_RATE_FAST,
    DECAY_RATE_SLOW,
)
from strategies.accumulation.detector import compute_daily_score
from strategies.accumulation.phase_classifier import classify_phase
from strategies.accumulation.entry_triggers import check_triggers


# ─── Configuration ───────────────────────────────────────────────────────────

@dataclass
class BacktestConfig:
    """Minimal config — only parameters that matter for the sweep."""
    # Walk-forward windows
    train_days: int = 365
    test_days: int = 180
    step_days: int = 90
    holdout_days: int = 180     # Final out-of-sample holdout

    # The 2 free parameters (swept in robustness test)
    entry_threshold: int = 7
    confirm_threshold: int = 11

    # Fixed constants (not swept — domain knowledge)
    promotion_streak: int = 2   # Anti-jitter, always 2
    slippage_pct: float = 0.05
    max_hold_spring: int = 30
    max_hold_lps: int = 20
    max_hold_sos: int = 15


@dataclass
class Trade:
    symbol: str
    trigger_type: str       # "SPRING", "LPS", "SOS_BREAKOUT"
    phase: str
    tier: str
    decay_score: float
    entry_price: float
    stop_loss: float
    target: float
    entry_date: str
    exit_date: str = ""
    exit_price: float = 0.0
    pnl_pct: float = 0.0
    pnl_r: float = 0.0
    hold_days: int = 0
    result: str = ""        # "WIN", "LOSS", "TIMEOUT"


# ─── Core Engine ─────────────────────────────────────────────────────────────

class AccumulationBacktester:
    def __init__(self, config: BacktestConfig):
        self.config = config

    def download_data(self, symbols: list[str], total_days: int = 1000) -> dict:
        """Download historical data for all symbols + SPY."""
        print(f"  Downloading {len(symbols)} symbols ({total_days} days)...")
        data = {}
        period = f"{total_days}d"

        spy_df = yf.download("SPY", period=period, progress=False)
        if isinstance(spy_df.columns, pd.MultiIndex):
            spy_df.columns = spy_df.columns.get_level_values(0)
        data["__SPY__"] = spy_df

        for sym in symbols:
            try:
                df = yf.download(sym, period=period, progress=False)
                if isinstance(df.columns, pd.MultiIndex):
                    df.columns = df.columns.get_level_values(0)
                if df is not None and len(df) >= 120:
                    data[sym] = df
            except Exception:
                pass

        print(f"  Downloaded {len(data) - 1}/{len(symbols)} symbols")
        return data

    def precompute_signals(self, df: pd.DataFrame, spy_df: pd.DataFrame,
                           start_idx: int, end_idx: int) -> list[dict]:
        """
        Pre-compute daily scores, phases, and triggers for every bar.
        This is the expensive part — only needs to run ONCE per symbol.
        
        Returns list of dicts (one per bar from start_idx to end_idx).
        """
        signals = []
        pending_triggers_precompute = []

        for i in range(start_idx, end_idx):
            entry = {"idx": i, "raw_score": 0, "phase": "UNKNOWN",
                     "support_primary": 0, "support_dynamic": 0,
                     "resistance": 0, "triggered": [], "pending_out": [],
                     "vp_position": "unknown", "spy_above_ema50": True,
                     "rsi2": 50.0}

            if i < 60:
                signals.append(entry)
                continue

            df_slice = df.iloc[:i + 1]
            spy_slice = spy_df.iloc[:i + 1] if len(spy_df) > i else spy_df

            try:
                # ─── RSI(2) ───
                if len(df_slice) >= 3:
                    closes = df_slice["Close"].values.astype(float)
                    # RSI with period=2
                    deltas = np.diff(closes[-3:])  # last 2 changes
                    gains = np.where(deltas > 0, deltas, 0)
                    losses = np.where(deltas < 0, -deltas, 0)
                    avg_gain = np.mean(gains) if len(gains) > 0 else 0
                    avg_loss = np.mean(losses) if len(losses) > 0 else 0.0001
                    if avg_loss == 0:
                        entry["rsi2"] = 100.0
                    else:
                        rs = avg_gain / avg_loss
                        entry["rsi2"] = 100.0 - (100.0 / (1.0 + rs))
                # ─── VP Position (daily 60-bar) ───
                if len(df_slice) >= 60:
                    vp = calc_vp(df_slice, 60, 0.68)
                    if vp:
                        price = float(df_slice["Close"].iloc[-1])
                        if price > vp["vah"]:
                            entry["vp_position"] = "above_va"
                        elif price < vp["val"]:
                            entry["vp_position"] = "below_va"
                        else:
                            entry["vp_position"] = "inside_va"

                # ─── SPY EMA50 ───
                if len(spy_slice) >= 50:
                    spy_close = spy_slice["Close"].values.astype(float)
                    ema = spy_close[0]
                    mult = 2.0 / 51.0
                    for k in range(1, len(spy_close)):
                        ema = spy_close[k] * mult + ema * (1 - mult)
                    entry["spy_above_ema50"] = spy_close[-1] > ema

                result = compute_daily_score(df_slice.tail(130), spy_slice.tail(130))
                if not isinstance(result, dict):
                    signals.append(entry)
                    continue

                raw_score = result.get("raw_score", 0)
                sp = result.get("support_primary", 0)
                sd = result.get("support_dynamic", 0)
                res = result.get("resistance", 0)

                entry["raw_score"] = raw_score
                entry["support_primary"] = sp
                entry["support_dynamic"] = sd
                entry["resistance"] = res

                # Phase classification
                phase_result = classify_phase(df_slice.tail(130), sp, sd, res)
                if isinstance(phase_result, dict):
                    entry["phase"] = phase_result.get("phase", "UNKNOWN")

                # Triggers (with pending from previous bar)
                triggers_result = check_triggers(
                    df_slice.tail(60), entry["phase"],
                    sp, sd, res,
                    pending_triggers=pending_triggers_precompute,
                )
                if isinstance(triggers_result, dict):
                    entry["triggered"] = triggers_result.get("triggered", [])
                    pending_triggers_precompute = triggers_result.get("pending", [])
                    entry["pending_out"] = pending_triggers_precompute
            except Exception:
                pass

            signals.append(entry)

        return signals

    def replay_with_thresholds(self, df: pd.DataFrame, signals: list[dict],
                               start_idx: int, end_idx: int,
                               cfg: BacktestConfig,
                               confirmed_only: bool = False,
                               use_filters: bool = False,
                               rsi_threshold: float = 0) -> list[Trade]:
        """
        Replay pre-computed signals with different threshold params.
        
        If confirmed_only=True, only generates trades when tier == "confirmed".
        If use_filters=True, applies VP position + SPY EMA50 filters.
        If rsi_threshold > 0, only enters when RSI(2) <= threshold (e.g. 20).
        """
        trades = []
        tracking = False
        decay_score = 0.0
        promote_streak = 0
        tier = "watch"
        phase = "UNKNOWN"

        for si, sig in enumerate(signals):
            i = sig["idx"]
            raw_score = sig["raw_score"]
            phase = sig["phase"]

            # Entry/exit tracking
            if not tracking:
                if raw_score >= cfg.entry_threshold:
                    tracking = True
                    decay_score = float(raw_score)
                continue

            # Decay (phase-based)
            if phase in ("C", "D", "E"):
                dr = DECAY_RATE_FAST
            else:
                dr = DECAY_RATE_SLOW
            decay_score = max(float(raw_score), decay_score * dr)

            # Exit
            if decay_score < 3:
                tracking = False
                decay_score = 0.0
                promote_streak = 0
                tier = "watch"
                continue

            # Promotion
            if decay_score >= cfg.confirm_threshold:
                promote_streak += 1
            else:
                promote_streak = 0
            if promote_streak >= cfg.promotion_streak:
                tier = "confirmed"

            # Tier filter: skip watch if confirmed_only
            if confirmed_only and tier != "confirmed":
                continue

            # Process triggers
            triggered_list = sig.get("triggered", [])
            if not triggered_list:
                continue

            # ─── VP + SPY Filters (research-based) ───
            if use_filters:
                # Filter 1: SPY trend — only block in severe downtrend
                # (SPY below EMA50 AND falling > 3% in 10 days = crash, skip)
                # Mild pullbacks are fine — accumulation thrives in dips
                if not sig.get("spy_above_ema50", True):
                    # Only block if SPY is significantly below EMA50
                    # We already set spy_above_ema50 = False when below,
                    # but accumulation signals during mild corrections are valuable
                    # So we only filter LPS/SOS, not Spring (Spring IS the dip buy)
                    trig_type_check = triggered_list[0].get("type", "") if triggered_list else ""
                    if "SPRING" not in trig_type_check:
                        continue  # Block LPS/SOS in downtrend, allow Spring

                # Filter 2: VP position must MATCH trigger type
                # Spring = wash out → best at/below VAL or inside VA (near value)
                # LPS    = pullback → best inside VA (fair value zone)
                # SOS    = breakout → should NOT be below VA
                vp_pos = sig.get("vp_position", "unknown")
                if vp_pos != "unknown" and triggered_list:
                    first_type = triggered_list[0].get("type", "")
                    # Spring when above_va = price already extended, not a real wash out
                    if "SPRING" in first_type and vp_pos == "above_va":
                        continue
                    # SOS below_va = not a real breakout
                    if "SOS" in first_type and vp_pos == "below_va":
                        continue

            for trig in triggered_list:
                if not isinstance(trig, dict):
                    continue
                trig_type = trig.get("type", "")

                # ─── RSI(2) Filter ───
                # Only enter when short-term is oversold (panic selling exhausted)
                if rsi_threshold > 0:
                    rsi_val = sig.get("rsi2", 50.0)
                    # Spring/LPS: require RSI oversold (confirms wash out)
                    # SOS: skip RSI filter (breakout doesn't need oversold)
                    if "SPRING" in trig_type or "LPS" in trig_type:
                        if rsi_val > rsi_threshold:
                            continue

                if "SPRING" in trig_type:
                    max_hold = cfg.max_hold_spring
                elif "LPS" in trig_type:
                    max_hold = cfg.max_hold_lps
                else:
                    max_hold = cfg.max_hold_sos

                # Entry at next-day Open
                entry_bar_idx = i + 1
                if entry_bar_idx >= len(df):
                    continue
                entry_price = float(df.iloc[entry_bar_idx]["Open"])
                entry_price *= (1 + cfg.slippage_pct / 100)

                sl = trig.get("stop", sig["support_primary"])
                tp = trig.get("target", sig["resistance"])

                risk = entry_price - sl
                reward = tp - entry_price
                if risk <= 0 or reward / risk < 1.0:
                    continue

                trade = self._simulate_trade(
                    df, entry_bar_idx, entry_price, sl, tp,
                    max_hold, trig_type, phase, tier, decay_score
                )
                if trade:
                    trades.append(trade)

        return trades

    def simulate_tracking(self, df: pd.DataFrame, spy_df: pd.DataFrame,
                          start_idx: int, end_idx: int,
                          cfg: BacktestConfig,
                          confirmed_only: bool = False,
                          use_filters: bool = False,
                          rsi_threshold: float = 0) -> list[Trade]:
        """
        Full simulation (precompute + replay). Used for single runs.
        """
        signals = self.precompute_signals(df, spy_df, start_idx, end_idx)
        return self.replay_with_thresholds(
            df, signals, start_idx, end_idx, cfg,
            confirmed_only=confirmed_only, use_filters=use_filters,
            rsi_threshold=rsi_threshold,
        )

    def _simulate_trade(self, df: pd.DataFrame, entry_idx: int,
                        entry: float, sl: float, tp: float,
                        max_hold: int, trig_type: str,
                        phase: str, tier: str, decay_score: float) -> Trade | None:
        """Simulate a single trade from entry_idx forward."""
        if entry_idx + 1 >= len(df):
            return None

        risk = entry - sl
        if risk <= 0:
            return None

        symbol = df.attrs.get("symbol", "")
        trade = Trade(
            symbol=symbol,
            trigger_type=trig_type,
            phase=phase,
            tier=tier,
            decay_score=decay_score,
            entry_price=entry,
            stop_loss=sl,
            target=tp,
            entry_date=str(df.index[entry_idx].date()),
        )

        for j in range(1, min(max_hold + 1, len(df) - entry_idx)):
            bar = df.iloc[entry_idx + j]
            low = float(bar["Low"])
            high = float(bar["High"])

            # Stop loss hit
            if low <= sl:
                trade.exit_price = sl
                trade.pnl_pct = (sl - entry) / entry * 100
                trade.pnl_r = -1.0
                trade.result = "LOSS"
                trade.hold_days = j
                trade.exit_date = str(df.index[entry_idx + j].date())
                return trade

            # Target hit
            if high >= tp:
                trade.exit_price = tp
                trade.pnl_pct = (tp - entry) / entry * 100
                trade.pnl_r = (tp - entry) / risk
                trade.result = "WIN"
                trade.hold_days = j
                trade.exit_date = str(df.index[entry_idx + j].date())
                return trade

        # Timeout: exit at close of last day
        last_idx = min(entry_idx + max_hold, len(df) - 1)
        exit_price = float(df.iloc[last_idx]["Close"])
        trade.exit_price = exit_price
        trade.pnl_pct = (exit_price - entry) / entry * 100
        trade.pnl_r = (exit_price - entry) / risk
        trade.result = "WIN" if exit_price > entry else "LOSS"
        trade.hold_days = last_idx - entry_idx
        trade.exit_date = str(df.index[last_idx].date())
        return trade

    def walk_forward(self, data: dict, symbols: list[str],
                     cfg: BacktestConfig, exclude_holdout: bool = True,
                     precomputed: dict = None,
                     confirmed_only: bool = False,
                     use_filters: bool = False,
                     rsi_threshold: float = 0) -> dict:
        """
        Run walk-forward backtest across rolling windows.
        
        If precomputed is provided, skips expensive score computation.
        If exclude_holdout=True, reserves the last holdout_days for final validation.
        """
        spy_df = data.get("__SPY__")
        if spy_df is None or len(spy_df) < 200:
            return {"trades": [], "windows": []}

        max_len = max(len(data[sym]) for sym in symbols if sym in data)

        # Reserve holdout
        if exclude_holdout:
            usable_bars = max_len - cfg.holdout_days
        else:
            usable_bars = max_len

        # Generate rolling windows
        windows = []
        start = 0
        while start + cfg.train_days + cfg.test_days <= usable_bars:
            windows.append({
                "train_start": start,
                "train_end": start + cfg.train_days,
                "test_start": start + cfg.train_days,
                "test_end": start + cfg.train_days + cfg.test_days,
            })
            start += cfg.step_days

        if not windows:
            split = int(usable_bars * 0.7)
            windows = [{
                "train_start": 0,
                "train_end": split,
                "test_start": split,
                "test_end": usable_bars,
            }]

        print(f"  Walk-forward: {len(windows)} windows "
              f"(holdout={'reserved' if exclude_holdout else 'included'})")

        all_trades = []
        window_results = []

        for wi, w in enumerate(windows):
            window_trades = []

            for sym in symbols:
                if sym not in data or sym == "__SPY__":
                    continue
                df = data[sym]
                if len(df) < w["test_end"]:
                    continue
                df.attrs["symbol"] = sym

                # Use precomputed signals if available, otherwise compute
                if precomputed and sym in precomputed:
                    signals = precomputed[sym]
                    # Filter signals to window range
                    window_signals = [s for s in signals
                                      if w["train_start"] <= s["idx"] < w["test_end"]]
                    trades = self.replay_with_thresholds(
                        df, window_signals, w["train_start"], w["test_end"], cfg,
                        confirmed_only=confirmed_only,
                        use_filters=use_filters,
                        rsi_threshold=rsi_threshold,
                    )
                else:
                    trades = self.simulate_tracking(
                        df, spy_df,
                        start_idx=w["train_start"],
                        end_idx=w["test_end"],
                        cfg=cfg,
                        confirmed_only=confirmed_only,
                        use_filters=use_filters,
                        rsi_threshold=rsi_threshold,
                    )

                # Only count trades that ENTERED during test period
                test_start_date = str(df.index[w["test_start"]].date())
                for t in trades:
                    t.symbol = sym
                    if t.entry_date >= test_start_date:
                        window_trades.append(t)

            # Window metrics
            if window_trades:
                wr = sum(1 for t in window_trades if t.result == "WIN") / len(window_trades) * 100
                exp = float(np.mean([t.pnl_r for t in window_trades]))
            else:
                wr = 0.0
                exp = 0.0

            window_results.append({
                "window": wi + 1,
                "trades": len(window_trades),
                "win_rate": round(wr, 1),
                "expectancy": round(exp, 3),
            })
            all_trades.extend(window_trades)

        return {"trades": all_trades, "windows": window_results}

    def holdout_test(self, data: dict, symbols: list[str],
                     cfg: BacktestConfig,
                     confirmed_only: bool = False,
                     use_filters: bool = False,
                     rsi_threshold: float = 0) -> dict:
        """Run on final holdout period (never seen during walk-forward)."""
        spy_df = data.get("__SPY__")
        if spy_df is None:
            return {"trades": [], "windows": []}

        max_len = max(len(data[sym]) for sym in symbols if sym in data)
        holdout_start = max_len - cfg.holdout_days
        holdout_end = max_len

        # Use pre-holdout period as warmup for tracker state
        warmup_start = max(0, holdout_start - cfg.train_days)

        print(f"  Holdout: bars {holdout_start}-{holdout_end} "
              f"(warmup from {warmup_start})")

        all_trades = []
        for sym in symbols:
            if sym not in data or sym == "__SPY__":
                continue
            df = data[sym]
            if len(df) < holdout_end:
                continue
            df.attrs["symbol"] = sym

            trades = self.simulate_tracking(
                df, spy_df,
                start_idx=warmup_start,
                end_idx=holdout_end,
                cfg=cfg,
                confirmed_only=confirmed_only,
                use_filters=use_filters,
                rsi_threshold=rsi_threshold,
            )

            holdout_start_date = str(df.index[holdout_start].date())
            for t in trades:
                t.symbol = sym
                if t.entry_date >= holdout_start_date:
                    all_trades.append(t)

        return {"trades": all_trades, "windows": []}

    def robustness_sweep(self, data: dict, symbols: list[str]) -> list[dict]:
        """
        Sweep ENTRY_THRESHOLD × CONFIRM_THRESHOLD.
        PROMOTION_STREAK fixed at 2.
        
        Optimization: pre-computes all signals ONCE, then replays with
        different threshold params (10-20x faster than recomputing).
        """
        print("\n  Running parameter robustness sweep...")
        print("  (ENTRY_THRESHOLD × CONFIRM_THRESHOLD, PROMOTION_STREAK=2 fixed)")
        print("  Pre-computing signals (one-time cost)...\n")

        spy_df = data.get("__SPY__")
        max_len = max(len(data[sym]) for sym in symbols if sym in data)
        usable_bars = max_len - self.config.holdout_days

        # Pre-compute signals for ALL symbols ONCE
        precomputed = {}
        for sym in symbols:
            if sym not in data or sym == "__SPY__":
                continue
            df = data[sym]
            if len(df) < usable_bars:
                continue
            df.attrs["symbol"] = sym
            print(f"    Pre-computing {sym}...", end=" ", flush=True)
            signals = self.precompute_signals(df, spy_df, 0, usable_bars)
            precomputed[sym] = signals
            n_triggers = sum(1 for s in signals if s.get("triggered"))
            print(f"{len(signals)} bars, {n_triggers} trigger events")

        print(f"\n  Pre-computation done: {len(precomputed)} symbols")
        print(f"  Now sweeping thresholds...\n")

        results = []
        entry_values = [5, 6, 7, 8, 9]
        confirm_values = [9, 10, 11, 12, 13]
        combos = [(e, c) for e in entry_values for c in confirm_values if e < c]
        total = len(combos)

        for done, (entry_t, confirm_t) in enumerate(combos, 1):
            cfg = deepcopy(self.config)
            cfg.entry_threshold = entry_t
            cfg.confirm_threshold = confirm_t

            result = self.walk_forward(
                data, symbols, cfg, exclude_holdout=True,
                precomputed=precomputed, confirmed_only=True,
            )
            trades = result["trades"]

            if len(trades) >= 10:
                pnls = [t.pnl_r for t in trades]
                wr = sum(1 for t in trades if t.result == "WIN") / len(trades) * 100
                exp = float(np.mean(pnls))
                sharpe = exp / float(np.std(pnls)) if np.std(pnls) > 0 else 0
            else:
                wr = 0.0
                exp = 0.0
                sharpe = 0.0

            results.append({
                "entry_threshold": entry_t,
                "confirm_threshold": confirm_t,
                "trades": len(trades),
                "win_rate": round(wr, 1),
                "expectancy": round(exp, 3),
                "sharpe": round(sharpe, 3),
            })

            print(f"    [{done}/{total}] E={entry_t} C={confirm_t}: "
                  f"{len(trades)} trades, WR={wr:.1f}%, "
                  f"Exp={exp:+.2f}R, Sharpe={sharpe:.2f}")

        return results


def bootstrap_ci(trades: list[Trade], n_iter: int = 2000,
                 ci: float = 95.0) -> dict:
    """Bootstrap confidence interval for expectancy and win rate."""
    if len(trades) < 10:
        return {"expectancy_ci": (0, 0, 0), "wr_ci": (0, 0, 0), "significant": False}

    pnls = np.array([t.pnl_r for t in trades])
    wins = np.array([1 if t.result == "WIN" else 0 for t in trades])
    n = len(pnls)

    exp_samples = []
    wr_samples = []

    rng = np.random.default_rng(42)
    for _ in range(n_iter):
        idx = rng.integers(0, n, size=n)
        exp_samples.append(float(np.mean(pnls[idx])))
        wr_samples.append(float(np.mean(wins[idx])) * 100)

    alpha = (100 - ci) / 2
    exp_ci = (
        float(np.percentile(exp_samples, alpha)),
        float(np.median(exp_samples)),
        float(np.percentile(exp_samples, 100 - alpha)),
    )
    wr_ci = (
        float(np.percentile(wr_samples, alpha)),
        float(np.median(wr_samples)),
        float(np.percentile(wr_samples, 100 - alpha)),
    )

    # Significant if lower bound of expectancy > 0
    significant = exp_ci[0] > 0

    return {
        "expectancy_ci": exp_ci,
        "wr_ci": wr_ci,
        "significant": significant,
    }


# ─── Reporting ───────────────────────────────────────────────────────────────

def print_report(result: dict, config: BacktestConfig, label: str = "WALK-FORWARD"):
    """Print comprehensive backtest report."""
    trades = result["trades"]
    windows = result.get("windows", [])

    print(f"\n{'='*65}")
    print(f"  ACCUMULATION TRACKER — {label} REPORT")
    print(f"{'='*65}")

    if not trades:
        print("  ❌ No trades generated.")
        return

    total = len(trades)
    wins = [t for t in trades if t.result == "WIN"]
    losses = [t for t in trades if t.result == "LOSS"]
    win_rate = len(wins) / total * 100

    pnls = [t.pnl_r for t in trades]
    expectancy = float(np.mean(pnls))
    total_r = sum(pnls)
    sharpe = expectancy / float(np.std(pnls)) if np.std(pnls) > 0 else 0
    avg_hold = float(np.mean([t.hold_days for t in trades]))

    # Max drawdown in R
    cumulative = np.cumsum(pnls)
    peak = np.maximum.accumulate(cumulative)
    dd = cumulative - peak
    max_dd = abs(float(np.min(dd))) if len(dd) > 0 else 0

    print(f"\n  Config: ENTRY={config.entry_threshold}, "
          f"CONFIRM={config.confirm_threshold}, STREAK=2 (fixed)")
    if windows:
        print(f"  Windows: {len(windows)} | Total Trades: {total}")
    else:
        print(f"  Total Trades: {total}")

    print(f"\n  {'─'*60}")
    print(f"  Win Rate:    {win_rate:.1f}%")
    print(f"  Expectancy:  {expectancy:+.3f}R")
    print(f"  Sharpe:      {sharpe:.2f}")
    print(f"  Total R:     {total_r:+.1f}R")
    print(f"  Max DD:      {max_dd:.1f}R")
    print(f"  Avg Hold:    {avg_hold:.0f} days")

    if wins:
        print(f"  Avg Win:     +{np.mean([t.pnl_r for t in wins]):.2f}R")
    if losses:
        print(f"  Avg Loss:    {np.mean([t.pnl_r for t in losses]):.2f}R")

    # Bootstrap CI
    ci = bootstrap_ci(trades)
    print(f"\n  {'─'*60}")
    print(f"  Bootstrap 95% CI:")
    print(f"    Expectancy: [{ci['expectancy_ci'][0]:+.3f}, "
          f"{ci['expectancy_ci'][2]:+.3f}]R  "
          f"(median {ci['expectancy_ci'][1]:+.3f}R)")
    print(f"    Win Rate:   [{ci['wr_ci'][0]:.1f}%, {ci['wr_ci'][2]:.1f}%]")
    sig_emoji = "✅" if ci["significant"] else "❌"
    print(f"    Statistically significant: {sig_emoji} "
          f"{'Yes (lower bound > 0)' if ci['significant'] else 'No (lower bound ≤ 0)'}")

    # By trigger type
    print(f"\n  {'─'*60}")
    print(f"  {'Trigger':<20} {'Trades':>7} {'WR':>7} {'Exp':>8} {'Avg Hold':>9}")
    print(f"  {'─'*20} {'─'*7} {'─'*7} {'─'*8} {'─'*9}")

    for trig in ["SPRING", "LPS", "SOS_BREAKOUT"]:
        tt = [t for t in trades if trig in t.trigger_type]
        if tt:
            t_wr = sum(1 for t in tt if t.result == "WIN") / len(tt) * 100
            t_exp = float(np.mean([t.pnl_r for t in tt]))
            t_hold = float(np.mean([t.hold_days for t in tt]))
            print(f"  {trig:<20} {len(tt):>7} {t_wr:>6.1f}% "
                  f"{t_exp:>+7.3f}R {t_hold:>8.0f}d")

    # By tier
    print(f"\n  {'─'*60}")
    for tier_name in ["watch", "confirmed"]:
        tt = [t for t in trades if t.tier == tier_name]
        if tt:
            t_wr = sum(1 for t in tt if t.result == "WIN") / len(tt) * 100
            t_exp = float(np.mean([t.pnl_r for t in tt]))
            print(f"  {tier_name:<12}: {len(tt)} trades | "
                  f"WR {t_wr:.1f}% | Exp {t_exp:+.3f}R")

    # Window consistency
    if windows:
        print(f"\n  {'─'*60}")
        print(f"  Walk-Forward Window Consistency:")
        positive_windows = sum(1 for w in windows if w["expectancy"] > 0)
        print(f"  Positive windows: {positive_windows}/{len(windows)}")
        for w in windows:
            emoji = "✅" if w["expectancy"] > 0 else "❌"
            print(f"    {emoji} W{w['window']}: {w['trades']} trades, "
                  f"WR={w['win_rate']:.1f}%, Exp={w['expectancy']:+.3f}R")

    print(f"\n{'='*65}\n")


def print_robustness(results: list[dict]):
    """Print robustness sweep as heatmap table."""
    print(f"\n{'='*65}")
    print(f"  PARAMETER ROBUSTNESS — Sharpe by (Entry, Confirm)")
    print(f"  PROMOTION_STREAK = 2 (fixed)")
    print(f"{'='*65}\n")

    entry_vals = sorted(set(r["entry_threshold"] for r in results))
    confirm_vals = sorted(set(r["confirm_threshold"] for r in results))

    # Header
    header_label = "E\\C"
    print(f"  {header_label:<6}", end="")
    for c in confirm_vals:
        print(f"{'C=' + str(c):>10}", end="")
    print()
    print(f"  {'─'*6}", end="")
    for _ in confirm_vals:
        print(f"{'─'*10}", end="")
    print()

    best_sharpe = max((r["sharpe"] for r in results), default=0)

    for e in entry_vals:
        print(f"  E={e:<3}", end="")
        for c in confirm_vals:
            r = next((x for x in results
                      if x["entry_threshold"] == e and x["confirm_threshold"] == c), None)
            if r:
                sharpe = r["sharpe"]
                marker = " ★" if sharpe == best_sharpe and sharpe > 0 else ""
                print(f"{sharpe:>8.2f}{marker}", end="")
            else:
                print(f"{'—':>10}", end="")
        print()

    # Find stable plateau
    print(f"\n  {'─'*60}")
    good = [r for r in results if r["sharpe"] > best_sharpe * 0.7 and r["trades"] >= 20]
    if good:
        print(f"\n  🏔️  Stable plateau (Sharpe > {best_sharpe * 0.7:.2f}, trades ≥ 20):")
        for r in sorted(good, key=lambda x: -x["sharpe"])[:5]:
            print(f"    E={r['entry_threshold']}, C={r['confirm_threshold']}: "
                  f"Sharpe={r['sharpe']:.2f}, WR={r['win_rate']}%, "
                  f"{r['trades']} trades, Exp={r['expectancy']:+.3f}R")
    else:
        print("\n  ⚠️  No stable plateau found (all Sharpe < threshold or too few trades)")

    print(f"\n{'='*65}\n")


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Accumulation Tracker Walk-Forward Backtest"
    )
    parser.add_argument("--symbols", type=str, default="",
                        help="Comma-separated symbols (default: top 30)")
    parser.add_argument("--days", type=int, default=900,
                        help="Total history days (default: 900)")
    parser.add_argument("--robustness", action="store_true",
                        help="Run ENTRY × CONFIRM parameter sweep")
    parser.add_argument("--entry-threshold", type=int, default=7,
                        help="ENTRY_THRESHOLD (default: 7)")
    parser.add_argument("--confirm-threshold", type=int, default=11,
                        help="CONFIRM_THRESHOLD (default: 11)")
    parser.add_argument("--confirmed-only", action="store_true",
                        help="Only trade when tier=confirmed (skip watch tier)")
    parser.add_argument("--filters", action="store_true",
                        help="Apply VP position + SPY EMA50 filters")
    parser.add_argument("--rsi", type=float, default=0,
                        help="RSI(2) threshold for entry (e.g. 20, 30). 0=disabled")
    args = parser.parse_args()

    symbols = args.symbols.split(",") if args.symbols else SYMBOLS[:30]
    symbols = [s.strip() for s in symbols if s.strip()]

    config = BacktestConfig(
        entry_threshold=args.entry_threshold,
        confirm_threshold=args.confirm_threshold,
    )

    backtester = AccumulationBacktester(config)

    print(f"\n{'━'*65}")
    print(f"  Accumulation Tracker — Walk-Forward Backtest")
    print(f"  Symbols: {len(symbols)} | History: {args.days} days")
    print(f"  ENTRY={config.entry_threshold} | CONFIRM={config.confirm_threshold} "
          f"| STREAK=2 (fixed)")
    print(f"  Holdout: last {config.holdout_days} days reserved")
    print(f"{'━'*65}")

    # Download data
    data = backtester.download_data(symbols, total_days=args.days)

    if args.robustness:
        # Parameter sweep (walk-forward region only, confirmed tier only)
        results = backtester.robustness_sweep(data, symbols)
        print_robustness(results)

        # Run holdout with best plateau parameters
        good = [r for r in results if r["trades"] >= 20]
        if good:
            best = max(good, key=lambda x: x["sharpe"])
            print(f"  Running holdout validation with best params: "
                  f"E={best['entry_threshold']}, C={best['confirm_threshold']}...")
            holdout_cfg = deepcopy(config)
            holdout_cfg.entry_threshold = best["entry_threshold"]
            holdout_cfg.confirm_threshold = best["confirm_threshold"]

            holdout_result = backtester.holdout_test(
                data, symbols, holdout_cfg, confirmed_only=args.confirmed_only
            )
            print_report(holdout_result, holdout_cfg, label="HOLDOUT VALIDATION")
    else:
        # Single run: walk-forward + holdout
        confirmed_only = args.confirmed_only
        use_filters = args.filters
        rsi_threshold = args.rsi
        result = backtester.walk_forward(
            data, symbols, config, confirmed_only=confirmed_only,
            use_filters=use_filters, rsi_threshold=rsi_threshold,
        )
        print_report(result, config, label="WALK-FORWARD")

        # Final holdout
        print(f"\n{'━'*65}")
        print(f"  Running final holdout validation...")
        holdout_result = backtester.holdout_test(
            data, symbols, config, confirmed_only=confirmed_only,
            use_filters=use_filters, rsi_threshold=rsi_threshold,
        )
        print_report(holdout_result, config, label="HOLDOUT (UNSEEN DATA)")


if __name__ == "__main__":
    main()
