"""
Register Telegram webhook URL with Telegram API.

Run once after deployment:
    python setup_telegram_webhook.py

This tells Telegram to POST all bot updates to your Vercel URL.
"""

import os
import sys
import requests

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
WEBHOOK_SECRET = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
WEBHOOK_URL = os.environ.get("NEXT_PUBLIC_APP_URL", "https://vp-strategy-nu.vercel.app")

if not BOT_TOKEN:
    print("ERROR: Set TELEGRAM_BOT_TOKEN environment variable")
    sys.exit(1)
if not WEBHOOK_SECRET:
    print("ERROR: Set TELEGRAM_WEBHOOK_SECRET environment variable")
    sys.exit(1)

url = f"https://api.telegram.org/bot{BOT_TOKEN}/setWebhook"
webhook_endpoint = f"{WEBHOOK_URL}/api/telegram/webhook"

print(f"Setting webhook to: {webhook_endpoint}")

response = requests.post(url, json={"url": webhook_endpoint, "secret_token": WEBHOOK_SECRET})
result = response.json()

if result.get("ok"):
    print(f"✅ Webhook set successfully!")
    print(f"   Description: {result.get('description')}")
else:
    print(f"❌ Failed: {result}")
    sys.exit(1)
