"""Trend Following Strategy — Breakout Acceptance, EMA Cross, Compression Breakout."""

from core.base_strategy import BaseStrategy
from core.signal import StrategySignal
from core.indicators import calc_donchian, calc_ema, calc_atr, calc_vol_ratio, is_atr_compressed, find_swing_points


class TrendSignals(BaseStrategy):
    name = "TrendFollowing"

    def detect(self, df, cfg, market_ctx) -> list:
        if len(df) < 60:
            return []

        atr = calc_atr(df, cfg["atr_len"])
        if not atr or atr == 0:
            return []

        donchian = calc_donchian(df.iloc[:-1], 20)  # exclude today for breakout ref
        vol_ratio = calc_vol_ratio(df, cfg["vol_ma_len"])
        ema20 = calc_ema(df["Close"], 20)
        ema50 = calc_ema(df["Close"], 50)

        cur = df.iloc[-1]
        ticker = df.attrs.get("symbol", "")
        ts = df.index[-1]
        c = cur["Close"]
        o = cur["Open"]
        bull = c > o
        bear = c < o

        signals = []

        # --- Breakout Acceptance LONG ---
        if donchian and c > donchian["upper"]:
            # Strict confirmation: 2 consecutive closes above + no pullback below level
            prev1 = df.iloc[-2]["Close"]
            prev1_low = df.iloc[-2]["Low"]
            prev2_close = df.iloc[-3]["Close"] if len(df) > 3 else 0
            # All 3 conditions: close above, prev close above, prev low didn't breach level
            acceptance = (prev1 > donchian["upper"] and
                         prev1_low > donchian["upper"] - atr * 0.1 and
                         vol_ratio > 1.3)
            if acceptance:
                sl = max(donchian["upper"] - atr * 0.5, c - atr * cfg["max_sl_atr"])
                tp = c + (donchian["upper"] - donchian["lower"])  # measured move
                signals.append(StrategySignal(
                    ticker=ticker, timestamp=ts, strategy="TrendFollowing",
                    signal_type="Breakout Acceptance", direction="LONG",
                    confidence=min(vol_ratio / 2.5, 1.0),
                    entry=c, stop=sl, target=tp, holding_type="long",
                    reasons=[
                        f"Broke Donchian high {donchian['upper']:.2f}",
                        f"2 days accepted (low held above level)",
                        f"Volume {vol_ratio:.1f}x avg",
                    ],
                    warnings=[], triggered=True,
                ))

        # --- Breakout Acceptance SHORT ---
        if not cfg["long_only"] and donchian and c < donchian["lower"]:
            prev1 = df.iloc[-2]["Close"]
            prev1_high = df.iloc[-2]["High"]
            acceptance = (prev1 < donchian["lower"] and
                         prev1_high < donchian["lower"] + atr * 0.1 and
                         vol_ratio > 1.3)
            if acceptance:
                sl = min(donchian["lower"] + atr * 0.5, c + atr * cfg["max_sl_atr"])
                tp = c - (donchian["upper"] - donchian["lower"])
                signals.append(StrategySignal(
                    ticker=ticker, timestamp=ts, strategy="TrendFollowing",
                    signal_type="Breakout Acceptance", direction="SHORT",
                    confidence=min(vol_ratio / 2.5, 1.0),
                    entry=c, stop=sl, target=tp, holding_type="long",
                    reasons=[
                        f"Broke Donchian low {donchian['lower']:.2f}",
                        f"2 days accepted (high held below level)",
                        f"Volume {vol_ratio:.1f}x avg",
                    ],
                    warnings=[], triggered=True,
                ))

        # --- EMA Cross LONG ---
        if ema20 and ema50 and ema20 > ema50 and c > ema20 and bull and vol_ratio >= 1.2:
            # Check EMA20 just crossed above EMA50 (within last 3 bars)
            prev_ema20 = calc_ema(df["Close"].iloc[:-3], 20)
            prev_ema50 = calc_ema(df["Close"].iloc[:-3], 50)
            if prev_ema20 and prev_ema50 and prev_ema20 <= prev_ema50:
                # Stop based on EMA50 or recent swing low (whichever is higher/tighter)
                _, swing_lows = find_swing_points(df.tail(30), 5)
                swing_low_sl = float(swing_lows[-1][1]) - atr * 0.3 if swing_lows else ema50 - atr * 0.5
                sl = max(min(ema50 - atr * 0.5, swing_low_sl), c - atr * cfg["max_sl_atr"])
                tp = c + atr * 3.0
                signals.append(StrategySignal(
                    ticker=ticker, timestamp=ts, strategy="TrendFollowing",
                    signal_type="EMA Cross", direction="LONG",
                    confidence=0.6,
                    entry=c, stop=sl, target=tp, holding_type="long",
                    reasons=[f"EMA20 ({ema20:.2f}) crossed above EMA50 ({ema50:.2f})", f"Price above EMA20"],
                    warnings=[],
                    triggered=True,
                ))

        # --- EMA Cross SHORT ---
        if not cfg["long_only"] and ema20 and ema50 and ema20 < ema50 and c < ema20 and bear and vol_ratio >= 1.2:
            prev_ema20 = calc_ema(df["Close"].iloc[:-3], 20)
            prev_ema50 = calc_ema(df["Close"].iloc[:-3], 50)
            if prev_ema20 and prev_ema50 and prev_ema20 >= prev_ema50:
                # Stop based on EMA50 or recent swing high (whichever is lower/tighter)
                swing_highs, _ = find_swing_points(df.tail(30), 5)
                swing_high_sl = float(swing_highs[-1][1]) + atr * 0.3 if swing_highs else ema50 + atr * 0.5
                sl = min(max(ema50 + atr * 0.5, swing_high_sl), c + atr * cfg["max_sl_atr"])
                tp = c - atr * 3.0
                signals.append(StrategySignal(
                    ticker=ticker, timestamp=ts, strategy="TrendFollowing",
                    signal_type="EMA Cross", direction="SHORT",
                    confidence=0.6,
                    entry=c, stop=sl, target=tp, holding_type="long",
                    reasons=[f"EMA20 ({ema20:.2f}) crossed below EMA50 ({ema50:.2f})", f"Price below EMA20"],
                    warnings=[],
                    triggered=True,
                ))

        # --- Compression Breakout ---
        if is_atr_compressed(df.iloc[:-1], cfg["atr_len"], 20, 0.7):
            # ATR was compressed, check if today expanded
            current_range = cur["High"] - cur["Low"]
            if current_range > atr * 1.5:
                # Use close position within the bar for reliable direction
                # Close in upper 30% = LONG, lower 30% = SHORT, middle = skip
                bar_close_pos = (c - cur["Low"]) / current_range
                if bar_close_pos >= 0.7:
                    direction = "LONG"
                elif bar_close_pos <= 0.3:
                    direction = "SHORT"
                else:
                    direction = None  # Indecisive (doji-like), skip signal

                if direction and (not cfg["long_only"] or direction == "LONG"):
                    if direction == "LONG":
                        sl = max(cur["Low"] - atr * 0.3, c - atr * cfg["max_sl_atr"])
                        tp = c + atr * 2.5
                    else:
                        sl = min(cur["High"] + atr * 0.3, c + atr * cfg["max_sl_atr"])
                        tp = c - atr * 2.5
                    signals.append(StrategySignal(
                        ticker=ticker, timestamp=ts, strategy="TrendFollowing",
                        signal_type="Compression Breakout", direction=direction,
                        confidence=0.7,
                        entry=c, stop=sl, target=tp, holding_type="mid",
                        reasons=["ATR was compressed 5+ days", f"Today range {current_range:.2f} > 1.5x ATR",
                                 f"Close position {bar_close_pos:.0%} confirms {direction}"],
                        warnings=[],
                        triggered=True,
                    ))

        return signals
