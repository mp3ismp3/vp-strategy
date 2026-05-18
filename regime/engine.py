"""Regime Engine — Market state detection + strategy trust allocation.

Determines current market regime and which strategies are trustworthy.
Acts as an upper-layer filter before signal generation.
"""

from dataclasses import dataclass, field
import numpy as np

from core.indicators import calc_vp, calc_atr
from config import REGIME_THRESHOLDS, REGIME_STRATEGY_TRUST


@dataclass
class RegimeState:
    regime: str                          # "range" / "trend" / "expansion" / "compression"
    confidence: float                    # 0.0 - 1.0
    raw_trust: dict = field(default_factory=dict)
    normalized_trust: dict = field(default_factory=dict)


def _poc_shift(df, cfg):
    """Calculate POC shift over recent 3 days vs lookback."""
    lb = cfg["vp_lookback"]
    if len(df) < lb + 5:
        return 0.0
    vp_now = calc_vp(df, lb, cfg["va_pct"])
    vp_prev = calc_vp(df.iloc[:-3], lb, cfg["va_pct"])
    if not vp_now or not vp_prev or vp_prev["poc"] == 0:
        return 0.0
    return abs(vp_now["poc"] - vp_prev["poc"]) / vp_prev["poc"]


def _atr_compression_days(df, atr_len=14, lookback=20, threshold=0.7):
    """Count consecutive recent days where ATR < threshold * avg ATR."""
    if len(df) < lookback + atr_len + 5:
        return 0
    h, l, c = df["High"].values, df["Low"].values, df["Close"].values
    tr = np.maximum(h[1:] - l[1:], np.maximum(np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])))
    if len(tr) < lookback + atr_len:
        return 0
    # Rolling ATR
    atrs = []
    for i in range(atr_len, len(tr) + 1):
        atrs.append(np.mean(tr[i - atr_len:i]))
    if len(atrs) < lookback:
        return 0
    avg_atr = np.mean(atrs[-lookback:])
    if avg_atr == 0:
        return 0
    # Count consecutive compressed days from most recent
    count = 0
    for a in reversed(atrs):
        if a < threshold * avg_atr:
            count += 1
        else:
            break
    return count


def _is_price_outside_va(df, cfg):
    """Check if current price is outside Value Area."""
    vp = calc_vp(df, cfg["vp_lookback"], cfg["va_pct"])
    if not vp:
        return False
    last_close = float(df["Close"].iloc[-1])
    return last_close > vp["vah"] or last_close < vp["val"]


def _normalize_trust(raw: dict) -> dict:
    """Normalize trust values so they sum to 1.0."""
    total = sum(raw.values())
    if total == 0:
        n = len(raw)
        return {k: 1.0 / n for k in raw} if n > 0 else {}
    return {k: v / total for k, v in raw.items()}


def detect_regime(df, cfg: dict, market_ctx: dict) -> RegimeState:
    """Detect market regime and compute strategy trust allocation.

    Logic:
      1. Compression: ATR < 0.7x avg for 5+ days
      2. Expansion: VIX >= 25 + price outside VA + ATR expanding
      3. Trend: POC migrating (>0.8%) + price outside VA or inst_trend confirmed
      4. Range: POC flat (<0.3%) + price in VA (default)
    """
    thresholds = REGIME_THRESHOLDS
    vix = market_ctx.get("vix")

    # Check compression first (specific condition)
    comp_days = _atr_compression_days(
        df, cfg["atr_len"], 20, thresholds["atr_compression"]
    )
    if comp_days >= thresholds["atr_compression_days"]:
        regime = "compression"
        confidence = min(comp_days / 10.0, 1.0)
    else:
        poc_shift = _poc_shift(df, cfg)
        outside_va = _is_price_outside_va(df, cfg)

        # Expansion: high VIX + outside VA
        if vix is not None and vix >= thresholds["vix_high"] and outside_va:
            regime = "expansion"
            confidence = min(vix / 40.0, 1.0)
        # Trend: POC migrating
        elif poc_shift > thresholds["poc_migrating_pct"]:
            regime = "trend"
            confidence = min(poc_shift / 0.02, 1.0)
        # Range: POC flat
        elif poc_shift < thresholds["poc_flat_pct"]:
            regime = "range"
            confidence = 1.0 - poc_shift / thresholds["poc_flat_pct"]
        else:
            # Ambiguous — lean range
            regime = "range"
            confidence = 0.5

    raw_trust = REGIME_STRATEGY_TRUST.get(regime, REGIME_STRATEGY_TRUST["range"]).copy()
    normalized_trust = _normalize_trust(raw_trust)

    return RegimeState(
        regime=regime,
        confidence=confidence,
        raw_trust=raw_trust,
        normalized_trust=normalized_trust,
    )


def get_active_strategies(regime_state: RegimeState, threshold: float = 0.15) -> list:
    """Return list of strategy names with normalized_trust > threshold."""
    return [k for k, v in regime_state.normalized_trust.items() if v > threshold]
