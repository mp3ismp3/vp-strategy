import { NextResponse } from "next/server";
import { filterScanItemsForPlan } from "@/lib/preview-access";
import { getServerPlan } from "@/lib/server-entitlement";
import { getSupabaseAdmin } from "@/lib/supabase";
import { serviceUnavailable } from "@/lib/api-response";

interface VolumeProfileFrame {
  poc?: number;
  position?: string;
  position_pct?: number;
  va_touch?: "vah" | "val" | "both" | null;
  va_touch_date?: string | null;
  va_touch_context?: string | null;
  vah?: number;
  val?: number;
}

interface ScanInfo {
  bar_date?: string;
  daily?: VolumeProfileFrame;
  monthly?: VolumeProfileFrame;
  price?: number;
  weekly?: VolumeProfileFrame;
}

interface ScanResults {
  market_ctx?: unknown;
  scan_time?: unknown;
  vp_data?: Record<string, ScanInfo>;
}

export async function GET() {
  const plan = await getServerPlan();
  if (!plan) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { data: row, error } = await getSupabaseAdmin()
      .from("scan_data")
      .select("vp_data, market_ctx, scan_time")
      .eq("id", "latest")
      .maybeSingle();
    if (error) {
      return serviceUnavailable("DATA_SOURCE_UNAVAILABLE", "Scan data is temporarily unavailable", error);
    }
    if (!row) {
      return NextResponse.json({ results: [], error: "Scan data not found" }, { status: 404 });
    }
    const data = row as ScanResults;

    // 轉換格式給前端用
    const vpData = data.vp_data || {};
    const results = filterScanItemsForPlan(Object.entries(vpData).map(([ticker, info]) => {
      const daily = info.daily || {};
      const weekly = info.weekly || {};
      const monthly = info.monthly || {};

      // 判斷 consensus
      const positions = [daily.position, weekly.position, monthly.position];
      const aboveCount = positions.filter((p) => p === "above_va").length;
      const belowCount = positions.filter((p) => p === "below_va").length;

      let consensus = "neutral";
      if (aboveCount >= 2) consensus = "bullish";
      else if (belowCount >= 2) consensus = "bearish";

      return {
        ticker,
        price: info.price || 0,
        bar_date: info.bar_date || null,
        daily: {
          poc: daily.poc || 0,
          vah: daily.vah || 0,
          val: daily.val || 0,
          position: daily.position || "inside_va",
          pct_from_poc: daily.position_pct || 0,
          va_touch: daily.va_touch || null,
          va_touch_date: daily.va_touch_date || null,
          va_touch_context: daily.va_touch_context || null,
        },
        weekly: {
          poc: weekly.poc || 0,
          vah: weekly.vah || 0,
          val: weekly.val || 0,
          position: weekly.position || "inside_va",
          pct_from_poc: weekly.position_pct || 0,
          va_touch: weekly.va_touch || null,
          va_touch_date: weekly.va_touch_date || null,
          va_touch_context: weekly.va_touch_context || null,
        },
        monthly: {
          poc: monthly.poc || 0,
          vah: monthly.vah || 0,
          val: monthly.val || 0,
          position: monthly.position || "inside_va",
          pct_from_poc: monthly.position_pct || 0,
          va_touch: monthly.va_touch || null,
          va_touch_date: monthly.va_touch_date || null,
          va_touch_context: monthly.va_touch_context || null,
        },
        consensus,
        suggestion: "",
      };
    }), plan);

    return NextResponse.json({
      results,
      scan_time: data.scan_time,
      market_ctx: data.market_ctx,
    });
  } catch (error: unknown) {
    return serviceUnavailable("DATA_SOURCE_UNAVAILABLE", "Scan data is temporarily unavailable", error);
  }
}
