import { NextResponse } from "next/server";
import { getWatchlistContext } from "@/lib/watchlist-server";
import { validateWatchlistTicker } from "@/lib/watchlist";
import { buildSymbolAnalysis, loadAnalysisSources } from "@/lib/symbol-analysis";
import { serviceUnavailable } from "@/lib/api-response";

export async function GET(
  _request: Request,
  context: { params: Promise<{ ticker: string }> }
) {
  try {
    const current = await getWatchlistContext();
    if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { ticker } = await context.params;
    const validation = validateWatchlistTicker(ticker, current.user.plan);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.reason }, {
        status: validation.reason === "upgrade_required" ? 403 : 404,
      });
    }
    const result = buildSymbolAnalysis(
      validation.ticker,
      current.user.plan,
      await loadAnalysisSources(current.supabase, [validation.ticker])
    );
    if (!result) return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return serviceUnavailable(
      "SYMBOL_ANALYSIS_UNAVAILABLE",
      "Analysis is temporarily unavailable",
      error
    );
  }
}
