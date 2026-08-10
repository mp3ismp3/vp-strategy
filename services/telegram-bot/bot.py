"""
VP Strategy Telegram Bot — 私訊制通知。

功能：
1. /start {bind_token} — 用戶綁定 Telegram
2. /status — 查看訂閱狀態
3. broadcast_signal() — 被 CI 呼叫，私訊所有付費用戶

Usage:
    python bot.py              # 啟動 bot（長駐）
    python bot.py --send-test  # 發送測試訊息
"""

import os
import sys
import asyncio
import logging
from datetime import datetime, timezone

from dotenv import load_dotenv
from telegram import Update, Bot
from telegram.ext import Application, CommandHandler, ContextTypes
from supabase import create_client
from entitlement import has_telegram_entitlement

load_dotenv()

# ─── Config ───
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)


def get_supabase():
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# ─── Command Handlers ───

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /start {bind_token} — 綁定用戶 Telegram。"""
    if not update.message or not update.effective_user:
        return

    args = context.args
    telegram_user_id = update.effective_user.id
    telegram_username = update.effective_user.username or ""

    if not args:
        await update.message.reply_text(
            "👋 歡迎使用 VP Strategy Bot！\n\n"
            "請到網站的「帳號設定」頁面點擊「綁定 Telegram」，\n"
            "取得綁定碼後輸入：\n\n"
            "/start <綁定碼>"
        )
        return

    bind_token = args[0]
    supabase = get_supabase()

    # 驗證 token
    result = supabase.table("telegram_bind_tokens").delete().eq(
        "token", bind_token
    ).gt("expires_at", datetime.now(timezone.utc).isoformat()).execute()

    if not result.data:
        await update.message.reply_text("❌ 綁定碼無效或已過期。請重新產生。")
        return

    token_record = result.data[0]
    email = token_record["email"]

    user_result = supabase.table("users").select(
        "plan, subscription_status, current_period_end, cancel_at_period_end"
    ).eq("email", email).execute()
    user = user_result.data[0] if user_result.data else None
    if not user or not has_telegram_entitlement(user):
        await update.message.reply_text(
            "❌ Telegram 即時信號僅提供 Premium 方案。\n\n"
            "請升級 Premium 後重新產生綁定碼。"
        )
        return

    supabase.table("users").update({
        "telegram_user_id": telegram_user_id,
        "telegram_username": telegram_username,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("email", email).execute()

    if user:
        await update.message.reply_text(
            f"✅ 綁定成功！（{email}）\n\n"
            f"你的方案：{user['plan'].upper()}\n"
            f"即時交易信號將直接私訊給你。📈"
        )


async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /status — 查看訂閱狀態。"""
    if not update.message or not update.effective_user:
        return

    telegram_user_id = update.effective_user.id
    supabase = get_supabase()

    result = supabase.table("users").select(
        "email, plan, subscription_status, current_period_end, cancel_at_period_end"
    ).eq("telegram_user_id", telegram_user_id).execute()

    if not result.data:
        await update.message.reply_text(
            "❌ 尚未綁定帳號。\n請到網站「帳號設定」進行綁定。"
        )
        return

    user = result.data[0]
    status_emoji = "✅" if has_telegram_entitlement(user) else "❌"

    await update.message.reply_text(
        f"📊 <b>VP Strategy 訂閱狀態</b>\n\n"
        f"Email: {user['email']}\n"
        f"方案: {user['plan'].upper()}\n"
        f"狀態: {status_emoji} {user['subscription_status']}\n"
        f"到期: {user.get('current_period_end', '—')}",
        parse_mode="HTML",
    )


# ─── Bot 啟動 ───

def main():
    if not BOT_TOKEN:
        print("ERROR: TELEGRAM_BOT_TOKEN not set")
        sys.exit(1)

    app = Application.builder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("status", status_command))

    logger.info("Bot started. Listening for commands...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
