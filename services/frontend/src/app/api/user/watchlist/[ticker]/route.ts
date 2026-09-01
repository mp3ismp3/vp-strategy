import { NextResponse } from "next/server";
import { getWatchlistContext } from "@/lib/watchlist-server";
import { normalizeTicker } from "@/lib/watchlist";
import { isTrustedMutationRequest } from "@/lib/http-security";
import { serviceUnavailable } from "@/lib/api-response";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ ticker: string }> }
) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "Untrusted request origin" }, { status: 403 });
    }
    const current = await getWatchlistContext();
    if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { ticker } = await context.params;
    const normalized = normalizeTicker(ticker);
    const { error } = await current.supabase
      .from("user_watchlist_items")
      .delete()
      .eq("user_id", current.user.id)
      .eq("ticker", normalized);
    if (error) throw new Error("WATCHLIST_DELETE_FAILED");
    return NextResponse.json({ deleted: true, ticker: normalized });
  } catch (error) {
    return serviceUnavailable("WATCHLIST_UNAVAILABLE", "Watchlist is temporarily unavailable", error);
  }
}
