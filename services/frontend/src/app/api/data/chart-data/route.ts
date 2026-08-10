import { NextRequest, NextResponse } from "next/server";
import { FREE_TICKERS } from "@/lib/preview-access";
import { getServerPlan } from "@/lib/server-entitlement";
import { getSupabaseAdmin } from "@/lib/supabase";

interface ChartInfo {
  daily?: { position?: string };
  monthly?: { position?: string };
  price?: number;
  weekly?: { position?: string };
  [key: string]: unknown;
}

export async function GET(req: NextRequest) {
  const plan = await getServerPlan();
  if (!plan) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ticker = req.nextUrl.searchParams.get("ticker");
  const includeData = req.nextUrl.searchParams.get("include") === "data";

  try {
    const supabase = getSupabaseAdmin();

    if (ticker) {
      const normalizedTicker = ticker.toUpperCase();
      if (plan === "free" && !FREE_TICKERS.includes(normalizedTicker as typeof FREE_TICKERS[number])) {
        return NextResponse.json({ error: "Upgrade required" }, { status: 403 });
      }
      // Return single symbol
      const { data: row, error } = await supabase
        .from("chart_data")
        .select("data")
        .eq("ticker", normalizedTicker)
        .single();
      if (error || !row?.data) {
        return NextResponse.json({ error: "Symbol not found" }, { status: 404 });
      }
      return NextResponse.json(row.data);
    }

    const { data: rows, error } = await supabase.from("chart_data").select("ticker, data");
    if (error || !rows) return NextResponse.json({ error: "Chart data not found" }, { status: 404 });
    const data = Object.fromEntries(
      rows.map((row) => [row.ticker, row.data as ChartInfo])
    ) as Record<string, ChartInfo>;
    const visibleEntries = plan === "free"
      ? Object.entries(data).filter(([sym]) => FREE_TICKERS.includes(sym as typeof FREE_TICKERS[number]))
      : Object.entries(data);
    if (includeData) {
      return NextResponse.json(Object.fromEntries(visibleEntries));
    }
    const summary = Object.fromEntries(
      visibleEntries.map(([sym, info]) => [
        sym,
        { price: info.price, daily: info.daily?.position, weekly: info.weekly?.position, monthly: info.monthly?.position },
      ])
    );
    return NextResponse.json(summary);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
