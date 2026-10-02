import json
from unittest.mock import Mock

import pytest

import upload_to_supabase as uploader


def _scan_payload():
    frame = {
        "poc": 100.0,
        "vah": 105.0,
        "val": 95.0,
        "position": "inside_va",
        "position_pct": 50.0,
    }
    return {
        "scan_time": "2026-10-02T00:36:37+00:00",
        "market_ctx": {},
        "vp_data": {
            "TEST": {
                "price": 100.0,
                "daily": frame,
                "weekly": frame,
                "monthly": frame,
            }
        },
    }


def test_upload_scan_data_rejects_missing_price(monkeypatch, tmp_path):
    payload = _scan_payload()
    payload["vp_data"]["TEST"]["price"] = None
    (tmp_path / "scan_results.json").write_text(json.dumps(payload))
    supabase = Mock()
    monkeypatch.setattr(uploader, "DATA_DIR", tmp_path)

    with pytest.raises(ValueError, match="TEST.price"):
        uploader.upload_scan_data(supabase)

    supabase.table.assert_not_called()


def test_upload_scan_data_rejects_missing_position_pct(monkeypatch, tmp_path):
    payload = _scan_payload()
    payload["vp_data"]["TEST"]["daily"]["position_pct"] = None
    (tmp_path / "scan_results.json").write_text(json.dumps(payload))
    supabase = Mock()
    monkeypatch.setattr(uploader, "DATA_DIR", tmp_path)

    with pytest.raises(ValueError, match="TEST.daily.position_pct"):
        uploader.upload_scan_data(supabase)

    supabase.table.assert_not_called()


def test_upload_scan_data_accepts_valid_payload(monkeypatch, tmp_path):
    (tmp_path / "scan_results.json").write_text(json.dumps(_scan_payload()))
    execute = Mock()
    upsert = Mock(return_value=Mock(execute=execute))
    supabase = Mock()
    supabase.table.return_value = Mock(upsert=upsert)
    monkeypatch.setattr(uploader, "DATA_DIR", tmp_path)
    monkeypatch.setattr(uploader, "DRY_RUN", False)

    uploader.upload_scan_data(supabase)

    supabase.table.assert_called_once_with("scan_data")
    execute.assert_called_once_with()
