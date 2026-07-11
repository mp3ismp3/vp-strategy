"""Microsoft Teams notification sender via Incoming Webhook (Adaptive Card)."""

import os
import requests

TEAMS_WEBHOOK_URL = os.environ.get("TEAMS_WEBHOOK_URL", "")


def send_teams(message: str, title: str = "", dry_run: bool = False):
    """Send a message to Microsoft Teams via Incoming Webhook.

    Uses Adaptive Card format for better formatting.
    Splits messages > 28KB (Teams payload limit) into multiple cards.

    Args:
        message: Plain text or markdown message content.
        title: Optional card title.
        dry_run: If True, only print to console.
    """
    if dry_run or not TEAMS_WEBHOOK_URL:
        label = "DRY-RUN" if dry_run else "NO TEAMS WEBHOOK"
        print(f"[{label}] Teams message ({len(message)} chars): {title or '(no title)'}")
        return

    # Teams Adaptive Card payload limit is ~28KB, split if needed
    chunks = _split_message(message, max_chars=25000)

    for i, chunk in enumerate(chunks):
        card_title = title if len(chunks) == 1 else f"{title} ({i+1}/{len(chunks)})"
        payload = _build_adaptive_card(chunk, card_title)
        try:
            resp = requests.post(
                TEAMS_WEBHOOK_URL,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=15,
            )
            if resp.status_code not in (200, 202):
                print(f"Teams error: {resp.status_code} — {resp.text[:200]}")
        except Exception as e:
            print(f"Teams error: {e}")


def send_teams_card(card_payload: dict, dry_run: bool = False):
    """Send a raw Adaptive Card payload to Teams.

    Use this for custom card layouts (e.g., tables, action buttons).
    """
    if dry_run or not TEAMS_WEBHOOK_URL:
        print(f"[{'DRY-RUN' if dry_run else 'NO TEAMS WEBHOOK'}] Teams card payload")
        return

    try:
        resp = requests.post(
            TEAMS_WEBHOOK_URL,
            json=card_payload,
            headers={"Content-Type": "application/json"},
            timeout=15,
        )
        if resp.status_code not in (200, 202):
            print(f"Teams error: {resp.status_code} — {resp.text[:200]}")
    except Exception as e:
        print(f"Teams error: {e}")


def _build_adaptive_card(text: str, title: str = "") -> dict:
    """Build an Adaptive Card payload for Teams Workflow webhook."""
    body = []
    if title:
        body.append({
            "type": "TextBlock",
            "size": "Medium",
            "weight": "Bolder",
            "text": title,
        })
    body.append({
        "type": "TextBlock",
        "text": text,
        "wrap": True,
        "fontType": "Monospace",
        "size": "Small",
    })

    return {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "contentUrl": None,
            "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "type": "AdaptiveCard",
                "version": "1.4",
                "body": body,
            },
        }],
    }


def _split_message(message: str, max_chars: int = 25000) -> list:
    """Split message into chunks, breaking at newlines."""
    if len(message) <= max_chars:
        return [message]

    chunks = []
    current = ""
    for line in message.split("\n"):
        if len(current) + len(line) + 1 > max_chars:
            chunks.append(current)
            current = line
        else:
            current += ("\n" if current else "") + line
    if current:
        chunks.append(current)
    return chunks
