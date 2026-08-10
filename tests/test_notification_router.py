import importlib.util
from datetime import datetime, timezone
from pathlib import Path


def _load_entitlement():
    path = Path(__file__).parents[1] / "services" / "telegram-bot" / "entitlement.py"
    spec = importlib.util.spec_from_file_location("telegram_entitlement_for_test", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


entitlement = _load_entitlement()


def test_canceling_entitlement_expires_without_a_new_web_session():
    user = {
        "plan": "premium",
        "subscription_status": "active",
        "cancel_at_period_end": True,
        "current_period_end": "2026-08-07T00:00:00Z",
    }

    assert not entitlement.has_active_entitlement(
        user, datetime(2026, 8, 7, 0, 0, 1, tzinfo=timezone.utc)
    )


def test_canceling_entitlement_remains_active_before_period_end():
    user = {
        "plan": "pro",
        "subscription_status": "active",
        "cancel_at_period_end": True,
        "current_period_end": "2026-08-08T00:00:00Z",
    }

    assert entitlement.has_active_entitlement(
        user, datetime(2026, 8, 7, 0, 0, 0, tzinfo=timezone.utc)
    )


def test_active_entitlement_expires_even_without_cancel_flag():
    user = {
        "plan": "premium",
        "subscription_status": "active",
        "cancel_at_period_end": False,
        "current_period_end": "2026-08-07T00:00:00Z",
    }
    assert not entitlement.has_active_entitlement(
        user, datetime(2026, 8, 7, 0, 0, 1, tzinfo=timezone.utc)
    )


def test_paid_entitlement_requires_period_end():
    assert not entitlement.has_active_entitlement({
        "plan": "pro",
        "subscription_status": "active",
        "cancel_at_period_end": False,
        "current_period_end": None,
    })


def test_telegram_entitlement_requires_premium():
    base = {
        "subscription_status": "active",
        "current_period_end": "2026-09-01T00:00:00Z",
    }
    now = datetime(2026, 8, 1, tzinfo=timezone.utc)
    assert not entitlement.has_telegram_entitlement({**base, "plan": "pro"}, now)
    assert entitlement.has_telegram_entitlement({**base, "plan": "premium"}, now)
