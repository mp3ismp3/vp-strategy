import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export async function GET() {
  try {
    let raw: string;
    const localPath = path.join(process.cwd(), "../../data/accum_state.json");
    const publicPath = path.join(process.cwd(), "public/accum_state.json");

    try {
      raw = await fs.readFile(localPath, "utf-8");
    } catch {
      raw = await fs.readFile(publicPath, "utf-8");
    }

    const data = JSON.parse(raw);

    // 轉換 dict → array
    const states = Object.entries(data).map(([ticker, info]: [string, any]) => ({
      ticker,
      phase: info.phase || "UNKNOWN",
      tier: info.tier || "watch",
      decay_score: info.decay_score || 0,
      raw_score: info.raw_score || 0,
      support_primary: info.support_primary || 0,
      support_dynamic: info.support_dynamic || 0,
      resistance: info.resistance || 0,
      failing: info.failing || false,
      triggers_fired: info.triggers_fired || [],
    }));

    return NextResponse.json({ states });
  } catch (error: any) {
    console.error("Error reading accum state:", error.message);
    return NextResponse.json({ states: [], error: error.message }, { status: 500 });
  }
}
