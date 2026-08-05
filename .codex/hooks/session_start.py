#!/usr/bin/env python3
"""Inject a concise project-workflow reminder into Codex sessions."""

import json
import sys


def main() -> None:
    # Consume the event payload so malformed hook input is visible during review.
    json.load(sys.stdin)
    output = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": (
                "For software changes in vp-strategy, use the repo skill "
                "$vp-strategy-workflow from .agents/skills/vp-strategy-workflow. "
                "Follow AGENTS.md and read docs/CODEX_ARCHITECTURE.md before editing. "
                "Work test-first, select affected checks, review the complete diff, "
                "and provide verification evidence before completion."
            ),
        }
    }
    print(json.dumps(output))


if __name__ == "__main__":
    main()
