from datetime import datetime, timezone

from scan_all import _format_telegram


def test_format_telegram_highlights_value_area_touches():
    message = _format_telegram(
        {
            "AAPL": {
                "price": 100.0,
                "daily": {
                    "position_pct": 50.0,
                    "position": "inside_va",
                    "vah": 105.0,
                    "val": 95.0,
                    "va_touch": "val",
                    "va_touch_date": "2026-01-02",
                    "va_touch_context": "reentered_value",
                },
            }
        },
        {},
        datetime(2026, 1, 2, tzinfo=timezone.utc),
    )

    assert "VAH/VAL 觸及" in message
    assert "AAPL $100.0 — Daily VAL 支撐／收回 VA (105.00/95.00) [2026-01-02]" in message


def test_format_telegram_merges_multiple_timeframe_touches():
    message = _format_telegram(
        {
            "AAPL": {
                "price": 100.0,
                "daily": {"vah": 105.0, "val": 95.0, "position": "inside_va", "va_touch": "val", "va_touch_date": "2026-01-02", "va_touch_context": "reentered_value"},
                "weekly": {"vah": 110.0, "val": 96.0, "position": "inside_va", "va_touch": "val", "va_touch_date": "2026-01-02", "va_touch_context": "reentered_value"},
            }
        },
        {},
        datetime(2026, 1, 2, tzinfo=timezone.utc),
    )

    assert message.count("AAPL $100.0") == 1
    assert "Daily VAL 支撐／收回 VA" in message
    assert "Weekly VAL 支撐／收回 VA" in message


def test_format_telegram_omits_touch_section_when_no_edge_was_tested():
    message = _format_telegram(
        {
            "AAPL": {
                "price": 100.0,
                "daily": {"position_pct": 50.0, "position": "inside_va", "va_touch": None},
            }
        },
        {},
        datetime(2026, 1, 2, tzinfo=timezone.utc),
    )

    assert "VAH/VAL 觸及" not in message
