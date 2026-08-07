import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

interface VolumeProfileFrame {
  poc?: number;
  position?: string;
  position_pct?: number;
  vah?: number;
  val?: number;
}

interface ScanInfo {
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
  try {
    // Try multiple paths: local dev → Vercel serverless
    let raw: string = "";
    const paths = [path.join(process.cwd(), "data", "scan_results.json")];
    if (process.env.NODE_ENV === "development") {
      // Repo-root fallback is local-only and must not expand the production
      // server trace beyond the frontend project.
      paths.unshift(
        path.join(
          /* turbopackIgnore: true */ process.cwd(),
          "../../data/scan_results.json"
        )
      );
    }

    for (const p of paths) {
      try {
        raw = await fs.readFile(/* turbopackIgnore: true */ p, "utf-8");
        break;
      } catch {}
    }

    if (!raw) {
      return NextResponse.json({ results: [], error: "Data file not found" }, { status: 404 });
    }

    const data = JSON.parse(raw) as ScanResults;

    // 轉換格式給前端用
    const vpData = data.vp_data || {};
    const results = Object.entries(vpData).map(([ticker, info]) => {
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error reading scan results:", message);
    return NextResponse.json({ results: [], error: message }, { status: 500 });
  }
}
