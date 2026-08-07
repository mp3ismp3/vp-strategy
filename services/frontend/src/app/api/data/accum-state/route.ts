import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

interface AccumulationInfo {
  decay_score?: number;
  failing?: boolean;
  phase?: string;
  raw_score?: number;
  resistance?: number;
  support_dynamic?: number;
  support_primary?: number;
  tier?: string;
  triggers_fired?: unknown[];
}

export async function GET() {
  try {
    let raw: string = "";
    const paths = [path.join(process.cwd(), "data", "accum_state.json")];
    if (process.env.NODE_ENV === "development") {
      paths.unshift(
        path.join(
          /* turbopackIgnore: true */ process.cwd(),
          "../../data/accum_state.json"
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
      return NextResponse.json({ states: [], error: "Data file not found" }, { status: 404 });
    }

    const data = JSON.parse(raw) as Record<string, AccumulationInfo>;

    // 轉換 dict → array
    const states = Object.entries(data).map(([ticker, info]) => ({
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error reading accum state:", message);
    return NextResponse.json({ states: [], error: message }, { status: 500 });
  }
}
