"""VP + Accumulation Fusion Report — Cross-system signal alignment analysis.

Reads pre-computed data from both systems and produces alignment signals:
- scan_results.json (VP multi-TF positions)
- accum_state.json (Accumulation phase + score)

This is a READ-ONLY analysis layer. It does not modify either system's state.

Usage:
    from fusion_report import compute_fusion_signals
    signals = compute_fusion_signals()
"""

import json
from pathlib import Path
from typing import Optional

DATA_DIR = Path(__file__).parent / "data"
SCAN_RESULTS = DATA_DIR / "scan_results.json"
ACCUM_STATE = DATA_DIR / "accum_state.json"


# ─── Confidence Matrix ───────────────────────────────────────────────────────
# Maps (phase, vp_position) → confidence level and action

CONFIDENCE_MATRIX = {
    # Phase B (Building) — 正在吸籌，等待觸發
    ("B", "below_va"):  {"stars": 3, "label": "吸籌+低位", "action": "觀察，等 Phase C/D trigger"},
    ("B", "inside_va"): {"stars": 2, "label": "吸籌中", "action": "正常觀察，不急進"},
    ("B", "above_va"):  {"stars": 0, "label": "吸籌但價高", "action": "❌ 不追，等回踩"},

    # Phase C (Spring) — 最佳入場時機
    ("C", "below_va"):  {"stars": 5, "label": "⭐ 黃金入場區", "action": "Spring 觸發 → PILOT BUY 10-25%"},
    ("C", "inside_va"): {"stars": 3, "label": "Spring 幅度小", "action": "可做但降 size，觀察是否回落"},
    ("C", "above_va"):  {"stars": 0, "label": "矛盾信號", "action": "❌ Phase C 不該在 VA 上方，可能誤判"},

    # Phase D (Trending) — 趨勢啟動，找回踩
    ("D", "below_va"):  {"stars": 3, "label": "回踩好位", "action": "LPS 觸發 → ADD 25-40%"},
    ("D", "inside_va"): {"stars": 4, "label": "LPS 入場區", "action": "回踩 VA 內，找 POC 支撐進場"},
    ("D", "above_va"):  {"stars": 3, "label": "SOS 追蹤", "action": "突破中，用 trailing stop 跟蹤"},

    # Phase E (Markup) — 已起飛
    ("E", "below_va"):  {"stars": 0, "label": "⚠️ 假突破?", "action": "❌ 已 markup 卻跌回 → 可能失敗"},
    ("E", "inside_va"): {"stars": 2, "label": "回踩觀察", "action": "等價格站回 VAH 再考慮"},
    ("E", "above_va"):  {"stars": 4, "label": "趨勢確認", "action": "已在軌道上，持有或 trailing stop"},

    # Phase A (Stopping) — 剛開始，太早
    ("A", "below_va"):  {"stars": 1, "label": "初期觀察", "action": "剛停止下跌，僅觀察"},
    ("A", "inside_va"): {"stars": 1, "label": "初期觀察", "action": "剛停止下跌，僅觀察"},
    ("A", "above_va"):  {"stars": 0, "label": "不合理", "action": "❌ 剛止跌不該在上方"},

    # UNKNOWN
    ("UNKNOWN", "below_va"):  {"stars": 0, "label": "無結構", "action": "不符吸籌結構，忽略"},
    ("UNKNOWN", "inside_va"): {"stars": 0, "label": "無結構", "action": "不符吸籌結構，忽略"},
    ("UNKNOWN", "above_va"):  {"stars": 0, "label": "無結構", "action": "不符吸籌結構，忽略"},
}


# ─── Multi-TF Direction ──────────────────────────────────────────────────────

def _get_macro_direction(vp_data: dict) -> str:
    """Determine macro direction from weekly + monthly VP.

    Returns: 'bullish', 'bearish', 'neutral'
    """
    weekly = vp_data.get("weekly", {})
    monthly = vp_data.get("monthly", {})

    w_pos = weekly.get("position", "inside_va") if weekly else "inside_va"
    m_pos = monthly.get("position", "inside_va") if monthly else "inside_va"

    above = sum(1 for p in [w_pos, m_pos] if p == "above_va")
    below = sum(1 for p in [w_pos, m_pos] if p == "below_va")

    if above >= 1 and below == 0:
        return "bullish"
    elif below >= 1 and above == 0:
        return "bearish"
    return "neutral"


# ─── Red Flags ───────────────────────────────────────────────────────────────

def _check_red_flags(accum_info: dict, vp_data: dict, macro: str) -> list:
    """Check for contradictions that should block the trade."""
    flags = []

    phase = accum_info.get("phase", "UNKNOWN")
    daily_pos = vp_data.get("daily", {}).get("position", "inside_va") if vp_data.get("daily") else "inside_va"
    daily_pct = vp_data.get("daily", {}).get("position_pct", 50) if vp_data.get("daily") else 50

    # 1. 大方向空 + 吸籌初期 → 可能是假吸籌
    if macro == "bearish" and phase in ("A", "B"):
        flags.append("月/周線 Below VA + 僅 Phase A/B → 大環境不支持，可能假吸籌")

    # 2. Phase E 但跌回 VA 下 → 失敗突破
    if phase == "E" and daily_pos == "below_va":
        flags.append("Phase E 卻在 VA 下方 → 突破可能失敗")

    # 3. Phase C 但在 VA 上方 → 不合邏輯
    if phase == "C" and daily_pos == "above_va":
        flags.append("Phase C (Spring) 卻在 VA 上方 → Phase 判定可能有誤")

    # 4. 嚴重偏離價值
    if daily_pct > 150:
        flags.append(f"日線 VP position {daily_pct:.0f}% → 嚴重偏離價值區，追多危險")

    # 5. Decay score 持續下降（如果有 raw_history）
    raw_hist = accum_info.get("raw_history", [])
    if len(raw_hist) >= 5:
        recent = raw_hist[-5:]
        if all(recent[i] >= recent[i + 1] for i in range(len(recent) - 1)):
            flags.append("近 5 天分數持續下降 → 吸籌動能衰退")

    return flags


# ─── Trigger + VP Alignment ──────────────────────────────────────────────────

def _trigger_vp_alignment(triggers_fired: list, daily_pos: str) -> list:
    """Check if past triggers align with current VP position."""
    alignments = []

    # Map trigger type to ideal VP position
    ideal = {
        "SPRING": ["below_va"],  # Spring should be at/below VA
        "LPS": ["inside_va"],    # LPS is a pullback into VA
        "SOS_BREAKOUT": ["above_va"],  # SOS breaks above
    }

    for trigger in triggers_fired:
        # triggers_fired can be list of dicts {"type": ..., "date": ...} or strings
        if isinstance(trigger, dict):
            trigger_name = trigger.get("type", "")
        else:
            trigger_name = str(trigger)

        trigger_type = trigger_name.upper().replace(" ", "_")
        for key, positions in ideal.items():
            if key in trigger_type:
                if daily_pos in positions:
                    alignments.append(f"✅ {trigger_name} + VP {daily_pos} = 對齊")
                else:
                    alignments.append(f"⚠️ {trigger_name} + VP {daily_pos} = 不完全對齊")
    return alignments


# ─── Stop / Target Suggestions ───────────────────────────────────────────────

def _compute_levels(accum_info: dict, vp_data: dict) -> dict:
    """Compute suggested stop-loss and target levels combining both systems."""
    levels = {}

    # From Accumulation
    sp = accum_info.get("support_primary")
    sd = accum_info.get("support_dynamic")
    res = accum_info.get("resistance")

    # From VP
    daily = vp_data.get("daily", {}) if vp_data else {}
    vah = daily.get("vah")
    val = daily.get("val")
    poc = daily.get("poc")

    # Stop: tighter of (VP VAL, Accumulation support_dynamic)
    stop_candidates = [x for x in [val, sd] if x is not None]
    if stop_candidates:
        levels["stop_loss"] = min(stop_candidates)
        levels["stop_source"] = "VAL" if val and val == levels["stop_loss"] else "Dynamic Support"

    # Hard stop: below primary support
    if sp:
        levels["hard_stop"] = sp

    # Targets
    targets = []
    if poc and val and poc > val:
        targets.append({"level": poc, "label": "TP1: POC", "pct": None})
    if vah:
        targets.append({"level": vah, "label": "TP2: VAH", "pct": None})
    if res and (not vah or res > vah):
        targets.append({"level": res, "label": "TP3: Resistance", "pct": None})

    # Calculate percentage from current price
    price = vp_data.get("price") if vp_data else None
    if price and price > 0:
        for t in targets:
            t["pct"] = round((t["level"] - price) / price * 100, 1)
        if "stop_loss" in levels:
            levels["stop_pct"] = round((levels["stop_loss"] - price) / price * 100, 1)

    levels["targets"] = targets
    return levels


# ─── Main Fusion Computation ─────────────────────────────────────────────────

def compute_fusion_signals(scan_data: Optional[dict] = None,
                           accum_state: Optional[dict] = None) -> list:
    """Compute fusion signals by cross-referencing VP and Accumulation data.

    Args:
        scan_data: VP scan results (or loads from file)
        accum_state: Accumulation state (or loads from file)

    Returns:
        List of fusion signal dicts, sorted by stars (descending).
    """
    # Load data
    if scan_data is None:
        if not SCAN_RESULTS.exists():
            return []
        try:
            scan_data = json.loads(SCAN_RESULTS.read_text())
        except (json.JSONDecodeError, IOError):
            return []

    if accum_state is None:
        if not ACCUM_STATE.exists():
            return []
        try:
            accum_state = json.loads(ACCUM_STATE.read_text())
        except (json.JSONDecodeError, IOError):
            return []

    vp_results = scan_data.get("vp_data", {})
    market_ctx = scan_data.get("market_ctx", {})

    signals = []

    for symbol, accum_info in accum_state.items():
        if not isinstance(accum_info, dict):
            continue

        phase = accum_info.get("phase", "UNKNOWN")
        tier = accum_info.get("tier", "watch")
        decay_score = accum_info.get("decay_score", 0)

        # Get VP data for this symbol
        vp_data = vp_results.get(symbol)
        if vp_data is None:
            # Symbol tracked in accumulation but not in VP scan
            continue

        # Daily VP position
        daily = vp_data.get("daily", {})
        daily_pos = daily.get("position", "inside_va") if daily else "inside_va"
        daily_pct = daily.get("position_pct", 50) if daily else 50

        # Macro direction from weekly + monthly
        macro = _get_macro_direction(vp_data)

        # Lookup confidence matrix
        matrix_key = (phase, daily_pos)
        confidence = CONFIDENCE_MATRIX.get(
            matrix_key,
            {"stars": 0, "label": "未定義", "action": "—"}
        )

        # Red flags
        red_flags = _check_red_flags(accum_info, vp_data, macro)

        # If red flags, cap stars
        effective_stars = confidence["stars"]
        if red_flags:
            effective_stars = min(effective_stars, 2)

        # Macro boost/penalty
        if macro == "bullish" and phase in ("C", "D", "E"):
            effective_stars = min(5, effective_stars + 1)
        elif macro == "bearish" and phase in ("A", "B"):
            effective_stars = max(0, effective_stars - 1)

        # Trigger alignment
        triggers_fired = accum_info.get("triggers_fired", [])
        trigger_alignment = _trigger_vp_alignment(triggers_fired, daily_pos)

        # Levels
        levels = _compute_levels(accum_info, vp_data)

        signals.append({
            "symbol": symbol,
            "phase": phase,
            "tier": tier,
            "decay_score": decay_score,
            "raw_score": accum_info.get("raw_score", 0),
            "daily_position": daily_pos,
            "daily_position_pct": daily_pct,
            "weekly_position": vp_data.get("weekly", {}).get("position", "—") if vp_data.get("weekly") else "—",
            "monthly_position": vp_data.get("monthly", {}).get("position", "—") if vp_data.get("monthly") else "—",
            "macro_direction": macro,
            "stars": effective_stars,
            "label": confidence["label"],
            "action": confidence["action"],
            "red_flags": red_flags,
            "triggers_fired": triggers_fired,
            "trigger_alignment": trigger_alignment,
            "levels": levels,
            "price": vp_data.get("price"),
            "vp_daily": daily,
            "market_ctx": market_ctx,
        })

    # Sort by stars descending, then decay_score descending
    signals.sort(key=lambda x: (-x["stars"], -x["decay_score"]))
    return signals


def load_scan_data() -> Optional[dict]:
    """Load VP scan results from file."""
    if not SCAN_RESULTS.exists():
        return None
    try:
        return json.loads(SCAN_RESULTS.read_text())
    except (json.JSONDecodeError, IOError):
        return None


def load_accum_state() -> Optional[dict]:
    """Load accumulation state from file."""
    if not ACCUM_STATE.exists():
        return None
    try:
        return json.loads(ACCUM_STATE.read_text())
    except (json.JSONDecodeError, IOError):
        return None
