"""Accumulation Tracker v4 — Configuration.

All thresholds and parameters for the accumulation detection system.
"""

# ─── Scoring Thresholds ───
MAX_SCORE = 21          # Maximum raw score (7 indicators × 3 points each)
ENTRY_THRESHOLD = 7     # Minimum score to enter watchlist (tightened from 5)
CONFIRM_THRESHOLD = 11  # Score needed to promote to confirmed tier (tightened from 9)
EXIT_THRESHOLD = 4      # Score below which symbol is auto-removed

# ─── Decay Rates ───
# Exponential decay: new_score = max(raw_today, prev_score * decay_rate)
# Phase A/B: slow decay (~10-15 days to reach EXIT from CONFIRM)
# Phase C/D: fast decay (~5-7 days to reach EXIT from CONFIRM)
DECAY_RATE_SLOW = 0.85  # For Phase A, B, UNKNOWN
DECAY_RATE_FAST = 0.75  # For Phase C, D, E

# ─── Anti-Jitter (Hysteresis) ───
PROMOTION_STREAK = 2    # Consecutive scans above CONFIRM_THRESHOLD to promote
DEMOTION_STREAK = 2     # Consecutive scans below CONFIRM_THRESHOLD to demote

# ─── Failure Detection ───
HARD_FAIL_DAYS = 2      # Days below primary support for hard failure
SOFT_FAIL_DAYS = 2      # Days of soft failure before removal
VOLUME_SURGE_MULT = 1.2 # Volume > this × median = selling pressure (soft)
VOLUME_HARD_MULT = 1.5  # Volume > this × median = heavy selling (hard)
CLOSE_POS_FAIL = 0.40   # Close in lower 40% of bar = bearish close (soft)
CLOSE_POS_HARD_FAIL = 0.25  # Close in lower 25% = very bearish (hard)

# ─── Proximity Alerts ───
PROXIMITY_PRICE_PCT = 2.0   # Alert when price within 2% of trigger level
PROXIMITY_VOL_PCT = 80.0    # Alert when volume at 80%+ of required threshold

# ─── Entry Trigger Parameters ───
SPRING_LOOKBACK = 10        # Days to look back for support breach (aligned with phase classifier)
SPRING_VOL_MULT = 1.3       # Volume > 1.3x median on recovery day (confirms demand)
LPS_VOL_MULT = 0.7          # Volume < 0.7x median on pullback (low volume)
SOS_VOL_MULT = 1.5          # Volume > 1.5x median on breakout
SOS_CONFIRM_DAYS = 2        # Days above resistance for confirmation
MAX_STOP_LOSS_PCT = 0.08    # Maximum stop-loss distance (8% of entry price)

# ─── Market Environment Gate ───
# Triggers are suppressed when market conditions are hostile
VIX_BLOCK_ALL = 30          # VIX >= 30: block ALL triggers (extreme fear)
VIX_BLOCK_SPRING_LPS = 25   # VIX 25-30: block Spring/LPS, allow only SOS
SPY_EMA_PERIOD = 50         # SPY must be above EMA(50) for full confidence

# ─── Trigger Confirmation ───
TRIGGER_CONFIRM_DAYS = 2    # Spring/LPS need next-day hold above support to confirm

# ─── Watch Limits ───
MAX_WATCH_DAYS = 30         # Auto-remove if in watch tier for 30+ days without promotion

# ─── Sector Correlation ───
MAX_SAME_SECTOR_TRIGGERS = 3  # Max simultaneous triggers from same sector

# ─── Detection Parameters ───
DEFAULT_LOOKBACK = 40       # Default lookback period for scoring
SWING_LOOKBACK = 5          # Swing point detection window
VOL_MEDIAN_WINDOW = 20      # Window for volume median calculation

# ─── State File ───
STATE_FILE = "data/accum_state.json"
