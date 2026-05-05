"""Volume Profile signal detection strategy."""

from strategies import BaseStrategy, Signal
from core.indicators import calc_vp, calc_atr


class VPSignals(BaseStrategy):
    name = "VP"

    def _vix_tp_multiplier(self, market_ctx):
        """Adjust TP distance based on VIX environment."""
        vix = market_ctx.get("vix") if market_ctx else None
        if vix is None:
            return 1.0
        if vix >= 25:
            return 0.8  # High vol: tighter TP (take profit sooner)
        elif vix <= 15:
            return 1.3  # Low vol: wider TP (let it run)
        return 1.0

    def detect(self, df, cfg, market_ctx) -> list:
        if len(df) < cfg["vp_lookback"] + 5:
            return []

        vp = calc_vp(df, cfg["vp_lookback"], cfg["va_pct"])
        if vp is None:
            return []
        atr = calc_atr(df, cfg["atr_len"])
        if atr is None or atr == 0:
            return []

        poc, vah, val = vp["poc"], vp["vah"], vp["val"]
        cur, prev = df.iloc[-1], df.iloc[-2]
        o, h, l, c, v = cur["Open"], cur["High"], cur["Low"], cur["Close"], cur["Volume"]
        ph, pl, pc = prev["High"], prev["Low"], prev["Close"]

        vol_ma = df["Volume"].iloc[-cfg["vol_ma_len"]:].mean()
        vol_ratio = v / vol_ma if vol_ma > 0 else 0
        high_vol = vol_ratio > 1.2
        low_vol = vol_ratio < 0.8
        climax_vol = vol_ratio > 2.5

        body = abs(c - o)
        wick_up = h - max(c, o)
        wick_dn = min(c, o) - l
        bull_close = c > o
        bear_close = c < o
        bull_rejection = body > 0 and wick_dn > body * 1.5 and wick_dn > wick_up * 2 and bull_close
        bear_rejection = body > 0 and wick_up > body * 1.5 and wick_up > wick_dn * 2 and bear_close

        vp5 = calc_vp(df.iloc[:-5], cfg["vp_lookback"], cfg["va_pct"])
        poc_rising = vp5 is not None and (poc - vp5["poc"]) > atr * 0.1
        poc_falling = vp5 is not None and (poc - vp5["poc"]) < -atr * 0.1

        signals = []
        symbol = df.attrs.get("symbol", "")
        m = self._vix_tp_multiplier(market_ctx)

        # Signal 1: VA Rejection
        if c > val and c < poc and bull_rejection and high_vol and l <= val + atr * 0.3 and not poc_falling:
            sl = max(val - atr * 0.5, c - atr * cfg["max_sl_atr"])
            tp = c + (vah - c) * m
            signals.append(Signal(symbol, "LONG", "VP: VA Rejection", c, tp, sl))
        if not cfg["long_only"]:
            if c < vah and c > poc and bear_rejection and high_vol and h >= vah - atr * 0.3 and not poc_rising:
                sl = min(vah + atr * 0.5, c + atr * cfg["max_sl_atr"])
                tp = c - (c - val) * m
                signals.append(Signal(symbol, "SHORT", "VP: VA Rejection", c, tp, sl))

        # Signal 2: Failed Auction
        if pl < val and pc < val and c > val and bull_close and high_vol:
            sl = max(pl - atr * 0.3, c - atr * cfg["max_sl_atr"])
            tp = c + (vah - c) * m
            signals.append(Signal(symbol, "LONG", "VP: Failed Auction", c, tp, sl))
        if not cfg["long_only"]:
            if ph > vah and pc > vah and c < vah and bear_close and high_vol:
                sl = min(ph + atr * 0.3, c + atr * cfg["max_sl_atr"])
                tp = c - (c - val) * m
                signals.append(Signal(symbol, "SHORT", "VP: Failed Auction", c, tp, sl))

        # Signal 3: Breakout Retest
        confirmed_above, confirmed_below = False, False
        for i in range(-10, -2):
            if i + 1 >= 0:
                break
            b1, b2 = df.iloc[i], df.iloc[i + 1]
            if b1["Close"] > vah and b2["Close"] > vah and b1["Volume"] > vol_ma * 1.2:
                confirmed_above, confirmed_below = True, False
            if b1["Close"] < val and b2["Close"] < val and b1["Volume"] > vol_ma * 1.2:
                confirmed_below, confirmed_above = True, False
            if b1["Close"] > val and b1["Close"] < vah:
                confirmed_above = confirmed_below = False

        if confirmed_above and l <= vah + atr * 0.3 and c > vah and bull_close and not low_vol:
            base_tp = poc + 2 * (vah - poc)
            tp = c + (base_tp - c) * m
            sl = max(vah - atr * 0.5, c - atr * cfg["max_sl_atr"])
            signals.append(Signal(symbol, "LONG", "VP: Breakout Retest", c, tp, sl))
        if not cfg["long_only"] and confirmed_below and h >= val - atr * 0.3 and c < val and bear_close and not low_vol:
            base_tp = poc - 2 * (poc - val)
            tp = c - (c - base_tp) * m
            sl = min(val + atr * 0.5, c + atr * cfg["max_sl_atr"])
            signals.append(Signal(symbol, "SHORT", "VP: Breakout Retest", c, tp, sl))

        # Climax volume warning
        if climax_vol:
            signals.append(Signal(symbol, "WARNING", "VP: Climax Volume", c, 0, vol_ratio))

        return signals
