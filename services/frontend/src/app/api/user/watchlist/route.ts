import { NextRequest, NextResponse } from "next/server";
import { getWatchlistContext } from "@/lib/watchlist-server";
import {
  getAllowedWatchlistTickers,
  getWatchlistLimit,
  validateWatchlistTicker,
} from "@/lib/watchlist";
import { isJsonRequest, isTrustedMutationRequest } from "@/lib/http-security";
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

    return NextResponse.json({
      items: data || [],
      limit: getWatchlistLimit(context.user.plan),
      plan: context.user.plan,
      allowedTickers: getAllowedWatchlistTickers(context.user.plan),
    });
  } catch (error) {
    return serviceUnavailable("WATCHLIST_UNAVAILABLE", "Watchlist is temporarily unavailable", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "Untrusted request origin" }, { status: 403 });
    }
    if (!isJsonRequest(request)) {
      return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
    }
    const context = await getWatchlistContext();
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: { ticker?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (typeof body.ticker !== "string") {
      return NextResponse.json({ error: "Ticker is required" }, { status: 400 });
    }

    const validation = validateWatchlistTicker(body.ticker, context.user.plan);
    if (!validation.ok) {
      const status = validation.reason === "upgrade_required" ? 403 : 404;
      return NextResponse.json({ error: validation.reason }, { status });
    }

    const limit = getWatchlistLimit(context.user.plan);
    const { data, error } = await context.supabase.rpc("add_watchlist_item", {
      target_user_id: context.user.id,
      target_ticker: validation.ticker,
      item_limit: limit,
    });
    if (error) throw new Error("WATCHLIST_CREATE_FAILED");
    const result = data as { status?: string } | null;
    if (result?.status === "limit_reached") {
      return NextResponse.json({ error: "Watchlist limit reached", limit }, { status: 409 });
    }
    return NextResponse.json(result || { status: "created", ticker: validation.ticker }, {
      status: result?.status === "exists" ? 200 : 201,
    });
  } catch (error) {
    return serviceUnavailable("WATCHLIST_UNAVAILABLE", "Watchlist is temporarily unavailable", error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "Untrusted request origin" }, { status: 403 });
    }
    if (!isJsonRequest(request)) {
      return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
    }
    const context = await getWatchlistContext();
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let body: { tickers?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!Array.isArray(body.tickers) || body.tickers.some((ticker) => typeof ticker !== "string")) {
      return NextResponse.json({ error: "Ticker order is required" }, { status: 400 });
    }
    const tickers = body.tickers.map((ticker) => ticker.trim().toUpperCase());
    if (new Set(tickers).size !== tickers.length) {
      return NextResponse.json({ error: "Invalid ticker order" }, { status: 400 });
    }
    const { data, error } = await context.supabase.rpc("reorder_watchlist_items", {
      target_user_id: context.user.id,
      ordered_tickers: tickers,
    });
    if (error || data !== true) {
      return NextResponse.json({ error: "Invalid ticker order" }, { status: 400 });
    }
    return NextResponse.json({ updated: true });
  } catch (error) {
    return serviceUnavailable("WATCHLIST_UNAVAILABLE", "Watchlist is temporarily unavailable", error);
  }
}
