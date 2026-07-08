"""Accumulation Notifications — Telegram formatting.

Three notification types:
1. Daily Report — full list status (fixed schedule)
2. Trigger Alert — independent ⚡ notification when entry fires
3. Proximity Alert — ⚠️ warning when approaching trigger level
"""

from datetime import datetime, timezone, timedelta

ET = timezone(timedelta(hours=-4))


def format_daily_report(tracker, trigger_results, market_ctx=None):
    """Format the daily accumulation status report.
    
    Args:
        tracker: AccumulationTracker instance (after updates)
        trigger_results: dict of symbol -> check_triggers() output
        market_ctx: dict with vix, spy_state (from market_context.py)
    
    Returns:
        str: Formatted Telegram message (HTML)
    """
    now = datetime.now(ET)
    date_str = now.strftime("%Y-%m-%d %H:%M ET")

    lines = []
    lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    lines.append(f"🔍 <b>吸籌追蹤報告</b> — {date_str}")
    lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    lines.append("")

    # ─── Market Context ───
    if market_ctx:
        vix = market_ctx.get("vix")
        spy_state = market_ctx.get("spy_state", "unknown")
        vix_str = f"{vix:.1f}" if vix else "N/A"
        vix_emoji = "🟢" if vix and vix < 18 else "🟡" if vix and vix < 25 else "🔴"
        lines.append(f"📊 市場: {vix_emoji} VIX {vix_str} | SPY {spy_state}")
        lines.append("")

    # ─── Triggered Today ───
    all_triggered = []
    for symbol, tr in trigger_results.items():
        for t in tr.get("triggered", []):
            all_triggered.append((symbol, t))

    lines.append("━━ ⚡ 今日觸發 ━━")
    if all_triggered:
        for symbol, t in all_triggered:
            lines.append(f"🟢 <b>{symbol}</b> — {t['type']}")
            lines.append(f"   Entry ${t['entry']} | SL ${t['stop']} | TP ${t['target']} | R:R 1:{t['rr']}")
            lines.append(f"   {t.get('reason', '')}")
    else:
        lines.append("  無")
    lines.append("")

    # ─── Confirmed Tier ───
    confirmed = tracker.get_confirmed()
    lines.append(f"━━ ✅ 確認吸籌 ({len(confirmed)}) ━━")
    if confirmed:
        for item in confirmed:
            sym = item["symbol"]
            phase = item["phase"]
            score = item["decay_score"]
            raw = item.get("raw_score", 0)
            days = _days_since(item.get("entered_date", ""))

            # Score trend from history
            history = item.get("raw_history", [])
            trend_arrow = ""
            if len(history) >= 3:
                recent_avg = sum(history[-3:]) / 3
                older_avg = sum(history[-6:-3]) / 3 if len(history) >= 6 else recent_avg
                if recent_avg > older_avg + 0.5:
                    trend_arrow = "📈"
                elif recent_avg < older_avg - 0.5:
                    trend_arrow = "📉"
                else:
                    trend_arrow = "➡️"

            # Get trigger distance
            tr = trigger_results.get(sym, {})
            dist = tr.get("distance", {})
            nearest = dist.get("nearest_trigger", "—")
            pct_away = dist.get("price_away_pct")
            dist_str = f"{nearest} 差 {pct_away:.1f}%" if pct_away is not None else "—"

            failing_str = " ⚠️" if item.get("failing") else ""
            lines.append(
                f"  <b>{sym}</b> | Phase {phase} | "
                f"{score:.1f}分(今日{raw}) {trend_arrow} | "
                f"追蹤 <b>{days}天</b>{failing_str}"
            )
            lines.append(f"    距觸發: {dist_str}")
    else:
        lines.append("  (空)")
    lines.append("")

    # ─── Watch Tier ───
    watchlist = tracker.get_watchlist()
    lines.append(f"━━ 👀 觀察中 ({len(watchlist)}) ━━")
    if watchlist:
        # If too many, only show top items
        show_count = min(len(watchlist), 10)
        for item in watchlist[:show_count]:
            sym = item["symbol"]
            phase = item["phase"]
            score = item["decay_score"]
            raw = item.get("raw_score", 0)
            days = _days_since(item.get("entered_date", ""))

            # Score trend
            history = item.get("raw_history", [])
            trend_arrow = ""
            if len(history) >= 3:
                recent_avg = sum(history[-3:]) / 3
                older_avg = sum(history[-6:-3]) / 3 if len(history) >= 6 else recent_avg
                if recent_avg > older_avg + 0.5:
                    trend_arrow = "↑"
                elif recent_avg < older_avg - 0.5:
                    trend_arrow = "↓"
                else:
                    trend_arrow = "→"

            lines.append(f"  {sym} | Ph.{phase} | {score:.1f}(今日{raw}){trend_arrow} | {days}天")
        if len(watchlist) > show_count:
            lines.append(f"  ...及另外 {len(watchlist) - show_count} 檔")
    else:
        lines.append("  (空)")
    lines.append("")

    # ─── Changes ───
    changes = tracker.get_changes()
    if changes:
        lines.append("━━ 📋 狀態變動 ━━")
        for ch in changes:
            ch_type = ch["type"]
            sym = ch["symbol"]
            if ch_type == "added":
                lines.append(f"  🆕 新增: {sym} (Phase {ch['phase']}, {ch['score']}分)")
            elif ch_type == "promoted":
                lines.append(f"  📈 升級: {sym} → 確認 ({ch['score']:.1f}分)")
            elif ch_type == "demoted":
                lines.append(f"  📉 降級: {sym} → 觀察 ({ch['score']:.1f}分)")
            elif ch_type == "removed":
                days = _days_since(ch.get("entered_date", ""))
                days_str = f", 追蹤{days}天" if days > 0 else ""
                lines.append(f"  ❌ 移除: {sym} ({ch.get('reason', '')}{days_str})")

    # ─── Summary footer ───
    lines.append("")
    total = tracker.count
    lines.append(f"📊 總計: {total} 檔追蹤 (✅{tracker.confirmed_count} + 👀{tracker.watch_count})")

    msg = "\n".join(lines)

    # Truncate if too long for Telegram
    if len(msg) > 3800:
        msg = _truncate_report(lines)

    return msg


def format_trigger_alert(symbol, trigger, phase_info=None):
    """Format an independent trigger notification.
    
    Args:
        symbol: Ticker symbol
        trigger: dict from check_triggers() triggered list
        phase_info: dict from classify_phase() (optional)
        
    Returns:
        str: Formatted Telegram message (HTML)
    """
    trigger_type = trigger["type"]
    emoji_map = {"SPRING": "🌊", "LPS": "📐", "SOS_BREAKOUT": "🚀"}
    emoji = emoji_map.get(trigger_type, "⚡")

    type_zh = {
        "SPRING": "Spring 進場",
        "LPS": "LPS 回踩進場",
        "SOS_BREAKOUT": "SOS 突破進場",
    }

    lines = [
        f"⚡ <b>進場信號 — {symbol}</b>",
        "",
        f"{emoji} 類型: <b>{type_zh.get(trigger_type, trigger_type)}</b>",
        f"💰 Entry: ${trigger['entry']} | SL: ${trigger['stop']} | TP: ${trigger['target']}",
        f"📊 R:R = 1:{trigger['rr']}",
        f"📝 原因: {trigger.get('reason', '')}",
        f"🎯 行動: {trigger.get('action', '')}",
    ]

    if phase_info:
        lines.append(f"📍 階段: Phase {phase_info.get('phase', '?')} — {phase_info.get('next_event', '')}")

    return "\n".join(lines)


def format_proximity_alert(symbol, proximity, phase_info=None):
    """Format a proximity alert notification.
    
    Args:
        symbol: Ticker symbol
        proximity: dict from check_triggers() proximity list
        phase_info: dict from classify_phase() (optional)
        
    Returns:
        str: Formatted Telegram message (HTML)
    """
    trigger_type = proximity["type"]
    type_zh = {
        "SPRING": "Spring",
        "LPS": "LPS 回踩",
        "SOS_BREAKOUT": "SOS 突破",
    }

    lines = [
        f"⚠️ <b>接近觸發 — {symbol}</b>",
        "",
        f"類型: {type_zh.get(trigger_type, trigger_type)}",
        f"觸發價: ${proximity['trigger_price']} (目前 ${proximity['current']}, 差 {proximity['pct_away']:.1f}%)",
        f"量能: {proximity.get('vol_status', '')}",
        f"💡 建議: 設定價格警報 ${proximity['trigger_price']}",
    ]

    if phase_info:
        lines.append(f"📍 {phase_info.get('description', '')}")

    return "\n".join(lines)


def _days_since(date_str):
    """Calculate days since a date string (YYYY-MM-DD)."""
    if not date_str:
        return 0
    try:
        entered = datetime.strptime(date_str, "%Y-%m-%d").date()
        return (datetime.now(ET).date() - entered).days
    except (ValueError, TypeError):
        return 0


def _truncate_report(lines):
    """Truncate report to fit Telegram's 4096 char limit."""
    # Keep header, triggered, confirmed, trim watchlist
    result = []
    in_watch = False
    watch_count = 0

    for line in lines:
        if "👀 觀察中" in line:
            in_watch = True
            result.append(line)
            continue

        if in_watch:
            if line.startswith("━━") or line.startswith("📊"):
                in_watch = False
                if watch_count > 3:
                    result.append(f"  ...({watch_count - 3} 檔省略)")
                result.append(line)
            elif watch_count < 3:
                result.append(line)
                watch_count += 1
            else:
                watch_count += 1
        else:
            result.append(line)

    msg = "\n".join(result)
    if len(msg) > 4000:
        msg = msg[:3990] + "\n...(已截斷)"
    return msg
