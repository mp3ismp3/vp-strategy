"""Conservative completion boundary for US regular-session snapshots."""
import pandas as pd


def completed_bars(df, captured_at, weekly=False):
    """Exclude bars unfinished at capture; weekly indices use Sunday's label.

    Early-close sessions deliberately wait for 16:00 New York time. No market
    sessions are synthesized, and the capture time never advances on replay.
    """
    if df is None or df.empty:
        return df
    captured = pd.Timestamp(captured_at)
    if captured.tzinfo is None:
        raise ValueError("captured_at must include a timezone")
    local = captured.tz_convert("America/New_York")
    through = local.date()
    if local.hour < 16:
        through = (local - pd.Timedelta(days=1)).date()
    dates = df.index
    if dates.tz is not None:
        dates = dates.tz_localize(None)
    if weekly:
        dates = dates - pd.Timedelta(days=2)
    return df.loc[dates.date <= through]
