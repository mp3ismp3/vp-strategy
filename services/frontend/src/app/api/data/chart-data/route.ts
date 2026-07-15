import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker");

  try {
    let raw: string = "";
    const paths = [
      path.join(process.cwd(), "../../data/frontend_charts.json"),
      path.join(process.cwd(), "data/frontend_charts.json"),
    ];

    for (const p of paths) {
      try {
        raw = await fs.readFile(p, "utf-8");
        break;
      } catch {}
    }

    if (!raw) {
      return NextResponse.json({ error: "Data file not found" }, { status: 404 });
    }

    const data = JSON.parse(raw);

    if (ticker) {
      // Return single symbol
      const symbolData = data[ticker.toUpperCase()];
      if (!symbolData) {
        return NextResponse.json({ error: "Symbol not found" }, { status: 404 });
      }
      return NextResponse.json(symbolData);
    }

    // Return all tickers (without OHLC to keep response small)
    const summary = Object.fromEntries(
      Object.entries(data).map(([sym, info]: [string, any]) => [
        sym,
        { price: info.price, daily: info.daily?.position, weekly: info.weekly?.position, monthly: info.monthly?.position },
      ])
    );
    return NextResponse.json(summary);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
