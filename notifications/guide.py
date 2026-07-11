"""Signal usage guide generator — 信號使用教學訊息."""


def format_signal_guide() -> str:
    """Generate a formatted signal usage guide for Teams/Telegram notification.

    Returns a plain-text guide explaining all 9 signals and how to act on them.
    """
    return """📖 信號使用教學 — Multi-Strategy Scanner

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔵 短線信號（Short Track）持有 1-5 天
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ VA Rejection（價值區反彈）
   觸發：碰 Value Area 邊緣 + 反轉 K 線 + 放量
   做法：反方向進場，目標對面 VA 邊緣
   止損：VA 邊緣外 0.5x ATR
   適合：盤整市場 (Range)

2️⃣ Failed Auction（假突破）
   觸發：昨天突破 VA，今天收回來 + 放量
   做法：反突破方向進場（空頭/多頭陷阱）
   止損：昨天極值外
   適合：盤整市場 (Range)

3️⃣ VWAP Deviation（均價偏離回歸）
   觸發：碰 VWAP ±2σ band + 反轉 K 線
   做法：做回歸，目標回到 VWAP
   止損：band 外 0.5x ATR（要緊！）
   適合：盤整/壓縮，⚠️ 趨勢市場慎用

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🟡 中線信號（Mid Track）持有 1-4 週
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

4️⃣ Breakout Retest（突破回測）
   觸發：確認突破 VA 後回踩邊緣 + 守住
   做法：順突破方向進場（舊壓力=新支撐）
   止損：回破 VA 邊緣 0.5x ATR
   適合：趨勢啟動期

5️⃣ VWAP Reclaim（均價收復）
   觸發：收盤從 VWAP 一邊跨到另一邊 + 放量
   做法：跟隨收復方向，目標 VWAP band
   止損：VWAP ± 0.5x ATR
   適合：趨勢/壓縮市場

6️⃣ AVWAP Pullback（錨定均價回踩）
   觸發：回踩 Anchored VWAP + 守住 + 收陽 + 放量
   做法：只做多，目標 entry + 2x ATR
   止損：AVWAP - 0.5x ATR
   適合：上升趨勢中的回踩

7️⃣ Compression Breakout（壓縮突破）
   觸發：ATR 壓縮 5+ 天後，今天 range > 1.5x ATR
   做法：看收盤位置決定方向（上70%=多，下30%=空）
   止損：今日極值外 0.3x ATR
   適合：壓縮轉擴張的第一根 K 線

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 長線信號（Long Track）持有 1-3 個月
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

8️⃣ Breakout Acceptance（通道突破確認）
   觸發：突破 20 日 Donchian + 連 2 天站穩 + 放量
   做法：跟隨突破方向，目標通道寬等距投射
   止損：通道邊緣 - 0.5x ATR
   適合：趨勢啟動

9️⃣ EMA Cross（均線交叉）
   觸發：EMA20 穿越 EMA50 + 價格確認 + 放量
   做法：跟隨交叉方向，長期持有
   止損：EMA50 或 swing low 外
   適合：大趨勢轉向

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 通知評分怎麼看
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Q:80+ = Strong → 高信心進場
Q:60-79 = Moderate → 正常倉位
Q:50-59 = Lean → 輕倉試探
Q:<50 = 不通知（系統已過濾）

R:R = 風報比（> 1.5 才值得做）
Hold = 預估持有時間
Regime = 當前市場狀態（決定哪些信號可信）
Bias = 方向性偏見（↑多/↓空/→中性）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 操作原則
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• 收到通知 → 隔天開盤進場（信號基於收盤計算）
• 同檔多軌道同方向 → 加碼信心
• 不同軌道方向相反 → 觀望（系統已降低分數）
• Accumulation confirmed + Scanner 同方向 = 最高信心
• 永遠先看 R:R，至少 > 1.5 才進場
"""


def format_signal_guide_short() -> str:
    """Generate a shorter quick-reference version of the guide."""
    return """📖 信號快速參考

短線 (1-5天):
• VA Rejection — 碰VA邊緣反彈
• Failed Auction — 假突破回收
• VWAP Deviation — 碰±2σ回歸

中線 (1-4週):
• Breakout Retest — 突破後回測
• VWAP Reclaim — 收復均價
• AVWAP Pullback — 趨勢中回踩
• Compression Breakout — 壓縮爆發

長線 (1-3月):
• Breakout Acceptance — Donchian突破站穩
• EMA Cross — 均線交叉確認

評分: Q:80+=強 | 60-79=中 | 50-59=弱
R:R > 1.5 才值得做 | 隔天開盤進場
"""
