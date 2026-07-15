import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export async function GET() {
  try {
    // Try local data path first (dev), then public dir (Vercel)
    let raw: string;
    const localPath = path.join(process.cwd(), "../../data/scan_results.json");
    const publicPath = path.join(process.cwd(), "public/scan_results.json");

    try {
      raw = await fs.readFile(localPath, "utf-8");
    } catch {
      raw = await fs.readFile(publicPath, "utf-8");
    }

    const data = JSON.parse(raw);

    // 轉換格式給前端用
    const vpData = data.vp_data || {};
    const results = Object.entries(vpData).map(([ticker, info]: [string, any]) => {
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
        daily: {
          poc: daily.poc || 0,
          vah: daily.vah || 0,
          val: daily.val || 0,
          position: daily.position || "inside_va",
          pct_from_poc: daily.position_pct || 0,
        },
        weekly: {
          poc: weekly.poc || 0,
          vah: weekly.vah || 0,
          val: weekly.val || 0,
          position: weekly.position || "inside_va",
          pct_from_poc: weekly.position_pct || 0,
        },
        monthly: {
          poc: monthly.poc || 0,
          vah: monthly.vah || 0,
          val: monthly.val || 0,
          position: monthly.position || "inside_va",
          pct_from_poc: monthly.position_pct || 0,
        },
        consensus,
        suggestion: "",
      };
    });

    return NextResponse.json({
      results,
      scan_time: data.scan_time,
      market_ctx: data.market_ctx,
    });
  } catch (error: any) {
    console.error("Error reading scan results:", error.message);
    return NextResponse.json({ results: [], error: error.message }, { status: 500 });
  }
}
