"""Generic webhook notification (placeholder for future API/webhook platform)."""


def send_webhook(url, payload, headers=None):
    """Send signal payload to a webhook URL."""
    import requests
    headers = headers or {"Content-Type": "application/json"}
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=10)
        return resp.status_code == 200
    except Exception as e:
        print(f"Webhook error: {e}")
        return False
