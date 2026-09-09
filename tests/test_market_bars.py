import pandas as pd
from core.market_bars import completed_bars


def test_daily_and_weekly_use_snapshot_new_york_close():
    df = pd.DataFrame({"Close": [1, 2]}, index=pd.to_datetime(["2026-03-06", "2026-03-09"]))
    assert len(completed_bars(df, "2026-03-09T19:59:00Z")) == 1
    assert len(completed_bars(df, "2026-03-09T20:00:00Z")) == 2
    weekly = pd.DataFrame({"Close": [1, 2]}, index=pd.to_datetime(["2026-03-08", "2026-03-15"]))
    assert len(completed_bars(weekly, "2026-03-09T20:00:00Z", weekly=True)) == 1
    assert len(completed_bars(df.iloc[:1], "2026-03-06T20:59:00Z")) == 0


def test_empty_input():
    assert completed_bars(None, "2026-03-09T20:00:00Z") is None
    assert completed_bars(pd.DataFrame(), "2026-03-09T20:00:00Z").empty


def test_scanner_passes_only_completed_daily_and_weekly_data():
    from unittest.mock import patch
    from macd_scan import _scan_symbol
    df = pd.DataFrame({name: [100.0] * 200 for name in ["Open", "High", "Low", "Close", "Volume"]},
                      index=pd.bdate_range(end="2026-03-11", periods=200))
    with patch("macd_scan.detect_macd_divergence", return_value=[]) as detect:
        _scan_symbol(df, captured_at="2026-03-11T20:00:00Z")
    assert len(detect.call_args_list) == 2
    assert str(detect.call_args_list[0].args[0].index[-1].date()) == "2026-03-11"
    assert str(detect.call_args_list[1].args[0].index[-1].date()) == "2026-03-08"
