import pandas as pd
import json
from unittest.mock import Mock
import export_frontend_data as exporter

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


def test_export_attaches_snapshot_time_before_daily_download(monkeypatch, tmp_path):
    df = pd.DataFrame({name: [100.0] * 80 for name in ["Open", "High", "Low", "Close", "Volume"]},
                      index=pd.bdate_range("2026-01-01", periods=80))
    provider = Mock()
    download_times = []
    def download(*args, **kwargs):
        download_times.append(pd.Timestamp.now(tz="UTC"))
        return {"TEST": df}
    provider.batch_daily.side_effect = download
    provider.batch_intraday.return_value = {}
    monkeypatch.setattr(exporter, "YahooProvider", Mock(return_value=provider))
    monkeypatch.setattr(exporter, "SYMBOLS", ["TEST"])
    monkeypatch.setattr(exporter, "DATA_DIR", tmp_path)
    monkeypatch.setattr(exporter, "OUTPUT_FILE", tmp_path / "charts.json")
    monkeypatch.setattr(exporter, "compute_vp_multitf", lambda *a, **k: {
        "price": 100, "daily": {"poc": 100, "vah": 101, "val": 99, "position": "inside_va", "position_pct": 50},
    })
    exporter.main()
    payload = json.loads((tmp_path / "charts.json").read_text())
    captured = pd.Timestamp(payload["TEST"]["daily"]["captured_at"])
    assert captured.tzinfo is not None
    assert captured <= download_times[0]
