"""
VP Strategy Scanner — Legacy wrapper.

Now delegates to scan_all.py for the multi-strategy platform.
For backward compatibility, can still be called directly.

Usage:
  python scanner.py            # scan and send Telegram
  python scanner.py --dry-run  # scan and print only
"""

from scan_all import main

if __name__ == "__main__":
    main()
