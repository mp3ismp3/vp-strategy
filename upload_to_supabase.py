"""
Upload scan data to Supabase — run after scan_all.py + accumulation.py + export_frontend_data.py.

Uploads:
  - data/scan_results.json → scan_data table (single row, overwrite)
  - data/frontend_charts.json → chart_data table (62 rows, upsert)
  - data/accum_state.json → accum_data table (N rows, upsert)

Usage:
    python upload_to_supabase.py
    python upload_to_supabase.py --dry-run
"""

import json
import os
import sys
import math
from pathlib import Path
from datetime import datetime, timezone

from supabase import create_client

DRY_RUN = "--dry-run" in sys.argv
DATA_DIR = Path(__file__).parent / "data"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def get_supabase():
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def clean_json(obj):
    """Replace NaN/Infinity with None for valid JSON."""
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    elif isinstance(obj, dict):
        return {k: clean_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [clean_json(item) for item in obj]
    return obj


def upload_scan_data(supabase):
    """Upload scan_results.json → scan_data table."""
    scan_file = DATA_DIR / "scan_results.json"
    if not scan_file.exists():
        print("  [SKIP] scan_results.json not found")
        return

    data = json.loads(scan_file.read_text())
    data = clean_json(data)

    row = {
        "id": "latest",
        "vp_data": data.get("vp_data", {}),
        "market_ctx": data.get("market_ctx", {}),
        "scan_time": data.get("scan_time"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    if DRY_RUN:
        print(f"  [DRY RUN] Would upsert scan_data: {len(json.dumps(row))} bytes")
        return

    supabase.table("scan_data").upsert(row).execute()
    print(f"  ✓ scan_data uploaded ({len(data.get('vp_data', {}))} symbols)")


def upload_chart_data(supabase):
    """Upload frontend_charts.json → chart_data table (one row per ticker)."""
    chart_file = DATA_DIR / "frontend_charts.json"
    if not chart_file.exists():
        print("  [SKIP] frontend_charts.json not found")
        return

    data = json.loads(chart_file.read_text())
    data = clean_json(data)

    rows = []
    now = datetime.now(timezone.utc).isoformat()
    for ticker, chart_info in data.items():
        rows.append({
            "ticker": ticker,
            "data": chart_info,
            "updated_at": now,
        })

    if DRY_RUN:
        print(f"  [DRY RUN] Would upsert chart_data: {len(rows)} rows")
        return

    # Upsert in batches of 20 (Supabase limit friendly)
    batch_size = 20
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        supabase.table("chart_data").upsert(batch).execute()

    print(f"  ✓ chart_data uploaded ({len(rows)} tickers)")


def upload_accum_data(supabase):
    """Upload accum_state.json → accum_data table (one row per ticker)."""
    accum_file = DATA_DIR / "accum_state.json"
    if not accum_file.exists():
        print("  [SKIP] accum_state.json not found")
        return

    data = json.loads(accum_file.read_text())
    data = clean_json(data)

    rows = []
    now = datetime.now(timezone.utc).isoformat()
    for ticker, state_info in data.items():
        if isinstance(state_info, dict):
            rows.append({
                "ticker": ticker,
                "state": state_info,
                "updated_at": now,
            })

    if DRY_RUN:
        print(f"  [DRY RUN] Would upsert accum_data: {len(rows)} rows")
        return

    batch_size = 20
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        supabase.table("accum_data").upsert(batch).execute()

    print(f"  ✓ accum_data uploaded ({len(rows)} tickers)")


def main():
    print("Uploading data to Supabase...")

    if DRY_RUN:
        print("  (DRY RUN mode)")
        # Still validate files exist
        upload_scan_data(None)
        upload_chart_data(None)
        upload_accum_data(None)
        return

    supabase = get_supabase()
    upload_scan_data(supabase)
    upload_chart_data(supabase)
    upload_accum_data(supabase)

    print("Done.")


if __name__ == "__main__":
    main()
