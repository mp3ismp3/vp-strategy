"""Telegram notification sender."""

import os
import requests

TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")


def send_telegram(message, dry_run=False):
    """Send message to Telegram. Splits at newlines if > 4096 chars."""
    if dry_run or not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        print(f"[{'DRY-RUN' if dry_run else 'NO TELEGRAM'}] Message length: {len(message)}")
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    chunks, current = [], ""
    for line in message.split("\n"):
        if len(current) + len(line) + 1 > 4096:
            chunks.append(current)
            current = line
        else:
            current += ("\n" if current else "") + line
    if current:
        chunks.append(current)
    for chunk in chunks:
        try:
            requests.post(url, json={"chat_id": TELEGRAM_CHAT_ID, "text": chunk, "parse_mode": "HTML"}, timeout=10)
        except Exception as e:
            print(f"Telegram error: {e}")
