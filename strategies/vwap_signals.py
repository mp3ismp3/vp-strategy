"""VWAP Strategy — Reclaim, Deviation, Anchored VWAP Pullback."""

from core.base_strategy import BaseStrategy
from core.signal import StrategySignal
from core.indicators import calc_vwap_bands, calc_anchored_vwap, find_swing_anchor, calc_atr, calc_vol_ratio


class VWAPSignals(BaseStrategy):
    name = "VWAP"

    def detect(self, df, cfg, market_ctx) -> list:
        if len(df) < cfg["vp_lookback"] + 5:
            return []

        bands = calc_vwap_bands(df, cfg["vp_lookback"])
        if not bands:
            return []

        atr = calc_atr(df, cfg["atr_len"])
        if not atr or atr == 0:
            return []

        vwap, upper, lower = bands["vwap"], bands["upper"], bands["lower"]
        vol_ratio = calc_vol_ratio(df, cfg["vol_ma_len"])

        cur = df.iloc[-1]
        prev = df.iloc[-2]
        ticker = df.attrs.get("symbol", "")
        ts = df.index[-1]
        o, h, l, c = cur["Open"], cur["High"], cur["Low"], cur["Close"]
        pc = prev["Close"]
        bull = c > o
        bear = c < o
        body = abs(c - o)
        wick_dn = min(c, o) - l
        wick_up = h - max(c, o)

        signals = []

        # --- VWAP Reclaim LONG ---
        if pc < vwap and c > vwap and bull and vol_ratio >= 1.2:
            sl = max(vwap - atr * 0.5, c - atr * cfg["max_sl_atr"])
            tp = c + (upper - c) * 0.7
            signals.append(StrategySignal(
                ticker=ticker, timestamp=ts, strategy="VWAP",
                signal_type="VWAP Reclaim", direction="LONG",
                confidence=min(vol_ratio / 2.0, 1.0),
                entry=c, stop=sl, target=tp, holding_type="mid",
                reasons=[f"Price reclaimed VWAP {vwap:.2f}", f"Volume {vol_ratio:.1f}x avg"],
                warnings=[], triggered=True,
            ))

        # --- VWAP Reclaim SHORT ---
        if not cfg["long_only"] and pc > vwap and c < vwap and bear and vol_ratio >= 1.2:
            sl = min(vwap + atr * 0.5, c + atr * cfg["max_sl_atr"])
            tp = c - (c - lower) * 0.7
            signals.append(StrategySignal(
                ticker=ticker, timestamp=ts, strategy="VWAP",
                signal_type="VWAP Reclaim", direction="SHORT",
                confidence=min(vol_ratio / 2.0, 1.0),
                entry=c, stop=sl, target=tp, holding_type="mid",
                reasons=[f"Price lost VWAP {vwap:.2f}", f"Volume {vol_ratio:.1f}x avg"],
                warnings=[], triggered=True,
            ))

        # --- VWAP Deviation LONG (touch -2σ) ---
        if l <= lower + atr * 0.1 and c > lower and bull and body > 0 and wick_dn >= body * 1.5:
            sl = max(lower - atr * 0.5, c - atr * cfg["max_sl_atr"])
            tp = vwap
            # Dynamic confidence: base 0.5 + volume contribution
            dev_confidence = min(0.5 + vol_ratio * 0.15, 1.0)
            signals.append(StrategySignal(
                ticker=ticker, timestamp=ts, strategy="VWAP",
                signal_type="VWAP Deviation", direction="LONG",
                confidence=dev_confidence,
                entry=c, stop=sl, target=tp, holding_type="short",
                reasons=[f"Touched -2σ band {lower:.2f}", f"Rejection wick {wick_dn:.2f}", f"Volume {vol_ratio:.1f}x"],
                warnings=["Mean reversion play — use tight stop"],
                triggered=True,
            ))

        # --- VWAP Deviation SHORT (touch +2σ) ---
        if not cfg["long_only"] and h >= upper - atr * 0.1 and c < upper and bear and body > 0 and wick_up >= body * 1.5:
            sl = min(upper + atr * 0.5, c + atr * cfg["max_sl_atr"])
            tp = vwap
            # Dynamic confidence: base 0.5 + volume contribution
            dev_confidence = min(0.5 + vol_ratio * 0.15, 1.0)
            signals.append(StrategySignal(
                ticker=ticker, timestamp=ts, strategy="VWAP",
                signal_type="VWAP Deviation", direction="SHORT",
                confidence=dev_confidence,
                entry=c, stop=sl, target=tp, holding_type="short",
                reasons=[f"Touched +2σ band {upper:.2f}", f"Rejection wick {wick_up:.2f}", f"Volume {vol_ratio:.1f}x"],
                warnings=["Mean reversion play — use tight stop"],
                triggered=True,
            ))

        # --- Anchored VWAP Pullback LONG ---
        anchor_idx = find_swing_anchor(df)
        avwap = calc_anchored_vwap(df, anchor_idx)
        if avwap and abs(l - avwap) / avwap <= 0.005 and c > avwap and bull and vol_ratio >= 1.2:
            sl = max(avwap - atr * 0.5, c - atr * cfg["max_sl_atr"])
            tp = c + atr * 2.0
            signals.append(StrategySignal(
                ticker=ticker, timestamp=ts, strategy="VWAP",
                signal_type="AVWAP Pullback", direction="LONG",
                confidence=0.65,
                entry=c, stop=sl, target=tp, holding_type="mid",
                reasons=[f"Pullback to AVWAP {avwap:.2f}", "Held support + bullish close", f"Volume {vol_ratio:.1f}x confirms demand"],
                warnings=[], triggered=True,
            ))

        return signals
