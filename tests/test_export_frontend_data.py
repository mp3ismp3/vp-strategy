import pandas as pd

from export_frontend_data import DAILY_CHART_BARS, DAILY_FETCH_PERIOD, _df_to_ohlc


def test_daily_chart_exports_one_year_from_a_larger_fetch_window():
    index = pd.date_range("2024-01-01", periods=504, freq="B")
    df = pd.DataFrame({
        "Open": range(504),
        "High": range(1, 505),
        "Low": range(504),
        "Close": range(1, 505),
        "Volume": [1_000] * 504,
    }, index=index)

    result = _df_to_ohlc(df, DAILY_CHART_BARS)

    assert DAILY_FETCH_PERIOD == "2y"
    assert DAILY_CHART_BARS == 252
    assert len(result) == 252
    assert result[0]["time"] == index[-252].strftime("%Y-%m-%d")
