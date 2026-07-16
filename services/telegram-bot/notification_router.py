"""
Notification Router — 將交易信號私訊給付費用戶。

被 scan_all.py 和 accumulation.py 在 CI 中呼叫。

Usage:
    python notification_router.py --scan     # 發送 VP 掃描結果
    python notification_router.py --accum    # 發送 Accumulation 觸發
    python notification_router.py --dry-run  # 只印不發
"""

import os
import sys
import json
import asyncio
from pathlib import Path
from datetime import datetime, timezone

from dotenv import load_dotenv
from telegram import Bot
from supabase import create_client

load_dotenv()

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
DRY_RUN = "--dry-run" in sys.argv

DATA_DIR = Path(__file__).parent.parent.parent / "data"


def get_supabase():
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def get_subscribers(min_plan: str = "pro") -> list[dict]:
    """取得所有有效訂閱且已綁定 Telegram 的用戶。"""
    supabase = get_supabase()

    plan_hierarchy = {"free": 0, "pro": 1, "premium": 2}
    min_level = plan_hierarchy.get(min_plan, 1)

    result = supabase.table("users").select(
        "telegram_user_id, plan, subscription_status"
    ).not_.is_("telegram_user_id", "null").in_(
        "subscription_status", ["active", "trialing"]
    ).execute()

    subscribers = []
    for user in result.data:
        user_level = plan_hierarchy.get(user["plan"], 0)
        if user_level >= min_level:
            subscribers.append(user)

    return subscribers


async def broadcast(message: str, min_plan: str = "pro"):
    """私訊所有符合資格的訂閱者。"""
    if DRY_RUN:
        print(f"[DRY RUN] Would send to subscribers (min_plan={min_plan}):")
        print(message[:500])
        return

    subscribers = get_subscribers(min_plan)
    if not subscribers:
        print("  No subscribers to notify.")
        return

    bot = Bot(token=BOT_TOKEN)
    sent = 0
    failed = 0

    for user in subscribers:
        try:
            await bot.send_message(
                chat_id=user["telegram_user_id"],
                text=message,
                parse_mode="HTML",
            )
            sent += 1
        except Exception as e:
            print(f"  Failed to send to {user['telegram_user_id']}: {e}")
            failed += 1

    print(f"  Broadcast: {sent} sent, {failed} failed")


def format_scan_summary() -> str:
    """格式化 VP 掃描結果摘要。"""
    scan_file = DATA_DIR / "scan_results.json"
    if not scan_file.exists():
        return ""

    data = json.loads(scan_file.read_text())
    vp_data = data.get("vp_data", {})
    market_ctx = data.get("market_ctx", {})
    scan_time = data.get("scan_time", "")

    # Categorize
    bullish = []
    bearish = []

    for symbol, info in vp_data.items():
        positions = [
            info.get("daily", {}).get("position"),
            info.get("weekly", {}).get("position"),
            info.get("monthly", {}).get("position"),
        ]
        above = positions.count("above_va")
        below = positions.count("below_va")

        if above >= 2:
            pct = info.get("daily", {}).get("position_pct", 0)
            bullish.append((symbol, info.get("price", 0), pct))
        elif below >= 2:
            pct = info.get("daily", {}).get("position_pct", 0)
            bearish.append((symbol, info.get("price", 0), pct))

    # Format message
    msg = f"<b>📊 VP Multi-TF Scan</b>\n"
    if market_ctx.get("vix"):
        vix = market_ctx["vix"]
        emoji = "🟢" if vix < 15 else "🟡" if vix < 25 else "🔴"
        msg += f"{emoji} VIX: {vix:.1f} | SPY: {market_ctx.get('spy_state', '?')}\n"
    msg += "\n"

    if bullish:
        msg += f"<b>🟢 Bullish ({len(bullish)} 檔)</b>\n"
        for sym, price, pct in sorted(bullish, key=lambda x: -x[2])[:10]:
            msg += f"  {sym} ${price:.2f} ({pct:.0f}%)\n"
        msg += "\n"

    if bearish:
        msg += f"<b>🔴 Bearish ({len(bearish)} 檔)</b>\n"
        for sym, price, pct in sorted(bearish, key=lambda x: x[2])[:10]:
            msg += f"  {sym} ${price:.2f} ({pct:.0f}%)\n"

    return msg


def format_accum_triggers() -> str:
    """格式化 Accumulation 觸發信號。"""
    accum_file = DATA_DIR / "accum_state.json"
    if not accum_file.exists():
        return ""

    state = json.loads(accum_file.read_text())

    triggered = []
    for symbol, info in state.items():
        if not isinstance(info, dict):
            continue
        triggers = info.get("triggers_fired", [])
        if triggers:
            triggered.append({
                "symbol": symbol,
                "phase": info.get("phase", "?"),
                "triggers": triggers,
                "support": info.get("support_primary", 0),
                "resistance": info.get("resistance", 0),
            })

    if not triggered:
        return ""

    msg = "<b>⚡ Accumulation Triggers</b>\n\n"
    for item in triggered:
        trigger_names = ', '.join(
            tr['type'] if isinstance(tr, dict) else tr
            for tr in item['triggers']
        )
        msg += (
            f"<b>{item['symbol']}</b> — Phase {item['phase']}\n"
            f"  Triggers: {trigger_names}\n"
            f"  Support: ${item['support']:.2f} | Resistance: ${item['resistance']:.2f}\n\n"
        )

    return msg


async def main():
    if "--scan" in sys.argv:
        msg = format_scan_summary()
        if msg:
            await broadcast(msg, min_plan="pro")
        else:
            print("  No scan data to send.")

    elif "--accum" in sys.argv:
        msg = format_accum_triggers()
        if msg:
            await broadcast(msg, min_plan="pro")
        else:
            print("  No triggers to send.")

    else:
        # Send both
        scan_msg = format_scan_summary()
        if scan_msg:
            await broadcast(scan_msg, min_plan="pro")

        accum_msg = format_accum_triggers()
        if accum_msg:
            await broadcast(accum_msg, min_plan="pro")


if __name__ == "__main__":
    asyncio.run(main())
