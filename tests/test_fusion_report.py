from fusion_report import _get_macro_direction, compute_fusion_signals


def _scan_data():
    return {
        "scan_time": "2026-10-05T21:05:00-04:00",
        "vp_data": {
            "GOOD": {"price": 100, "daily": {"position": "below_va", "position_pct": 30}, "weekly": {"position": "inside_va"}, "monthly": {"position": "inside_va"}},
            "STALE": {"price": 100, "daily": {"position": "below_va", "position_pct": 30}, "weekly": {"position": "inside_va"}, "monthly": {"position": "inside_va"}},
        },
    }


def test_fusion_uses_shared_matrix_and_conservative_macro_direction():
    assert _get_macro_direction({"weekly": {"position": "above_va"}, "monthly": {"position": "inside_va"}}) == "neutral"
    signals = compute_fusion_signals(_scan_data(), {
        "GOOD": {"phase": "B", "tier": "confirmed", "last_updated": "2026-10-05", "triggers_fired": []},
    })
    assert signals[0]["stars"] == 3


def test_fusion_actionability_requires_current_data_and_current_trigger():
    signals = compute_fusion_signals(_scan_data(), {
        "GOOD": {"phase": "C", "tier": "confirmed", "last_updated": "2026-10-05", "triggers_fired": [{"type": "Spring", "date": "2026-10-05"}]},
        "STALE": {"phase": "C", "tier": "confirmed", "last_updated": "2026-10-04", "triggers_fired": [{"type": "Spring", "date": "2026-10-04"}]},
    })
    by_symbol = {signal["symbol"]: signal for signal in signals}
    assert by_symbol["GOOD"]["actionable"] is True
    assert by_symbol["STALE"]["actionable"] is False
    assert "資料不是同一掃描日" in by_symbol["STALE"]["actionability_reasons"]
