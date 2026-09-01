import { NextResponse } from "next/server";
import { getWatchlistContext } from "@/lib/watchlist-server";
import { getAllowedWatchlistTickers, getWatchlistLimit, isTickerAllowedForPlan } from "@/lib/watchlist";
import { buildSymbolAnalysis, loadAnalysisSources } from "@/lib/symbol-analysis";
import { serviceUnavailable } from "@/lib/api-response";

export async function GET() {
  try {
    const context = await getWatchlistContext();
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data, error } = await context.supabase
      .from("user_watchlist_items")
      .select("ticker, sort_order, created_at")
      .eq("user_id", context.user.id)
      .order("sort_order", { ascending: true });
    if (error) throw new Error("WATCHLIST_READ_FAILED");

    const tickers = (data || []).map((item) => item.ticker);
    const sources = await loadAnalysisSources(context.supabase, tickers);
    const limit = getWatchlistLimit(context.user.plan);
    const items = (data || []).map((item, index) => {
      const locked = index >= limit || !isTickerAllowedForPlan(item.ticker, context.user.plan);
      return {
        ...item,
        locked,
        analysis: locked ? null : buildSymbolAnalysis(item.ticker, context.user.plan, sources),
      };
    });
    return NextResponse.json({
      items,
      plan: context.user.plan,
      limit,
      allowedTickers: getAllowedWatchlistTickers(context.user.plan),
    });
  } catch (error) {
    return serviceUnavailable(
      "DASHBOARD_DATA_UNAVAILABLE",
      "Dashboard is temporarily unavailable",
      error
    );
  }
}
