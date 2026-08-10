from datetime import datetime, timezone


def has_active_entitlement(user: dict, now: datetime | None = None) -> bool:
    if user.get("plan") == "free" or user.get("subscription_status") not in ("active", "trialing"):
        return False
    period_end = user.get("current_period_end")
    if not period_end:
        return False
    try:
        expires_at = datetime.fromisoformat(period_end.replace("Z", "+00:00"))
    except (AttributeError, TypeError, ValueError):
        return False
    return expires_at > (now or datetime.now(timezone.utc))


def has_telegram_entitlement(user: dict, now: datetime | None = None) -> bool:
    return user.get("plan") == "premium" and has_active_entitlement(user, now)
