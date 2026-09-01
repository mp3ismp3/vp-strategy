import type { SupabaseClient } from "@supabase/supabase-js";
import { detectFvgs, type FVGGap, type OHLCBar } from "@/lib/fvg";
import type { Plan } from "@/types/user";

interface VPFrame {
  poc?: number;
  vah?: number;
  val?: number;
  position?: string;
  position_pct?: number;
}

interface VPInfo {
  price?: number;
  daily?: VPFrame;
  weekly?: VPFrame;
  monthly?: VPFrame;
}

interface AccumulationInfo {
  phase?: string;
  tier?: string;
  raw_score?: number;
  decay_score?: number;
  failing?: boolean;
  support_primary?: number;
  support_dynamic?: number;
  resistance?: number;
  triggers_fired?: unknown[];
}

interface ChartInfo {
  daily?: { ohlc?: OHLCBar[]; [key: string]: unknown };
  [key: string]: unknown;
}

export interface AnalysisSources {
  scan: { scan_time?: string; vp_data?: Record<string, VPInfo> };
  accumulation: Record<string, AccumulationInfo>;
  charts: Record<string, ChartInfo>;
}

function consensus(info?: VPInfo): "bullish" | "bearish" | "neutral" {
  const positions = [info?.daily?.position, info?.weekly?.position, info?.monthly?.position];
  if (positions.filter((value) => value === "above_va").length >= 2) return "bullish";
  if (positions.filter((value) => value === "below_va").length >= 2) return "bearish";
  return "neutral";
}

function frame(frame?: VPFrame) {
  if (!frame) return null;
  return {
    poc: frame.poc ?? null,
    vah: frame.vah ?? null,
    val: frame.val ?? null,
    position: frame.position ?? "inside_va",
    pct_from_poc: frame.position_pct ?? null,
  };
}

function fvgSummary(gaps: FVGGap[], plan: Plan) {
  const open = gaps.filter((gap) => !gap.filled);
  const summary: {
    bullishOpen: number;
    bearishOpen: number;
    nearest?: FVGGap | null;
    gaps?: FVGGap[];
  } = {
    bullishOpen: open.filter((gap) => gap.type === "bullish").length,
    bearishOpen: open.filter((gap) => gap.type === "bearish").length,
  };
  if (plan !== "free") {
    summary.nearest = open.at(-1) ?? null;
    summary.gaps = gaps;
  }
  return summary;
}

export function buildSymbolAnalysis(ticker: string, plan: Plan, sources: AnalysisSources) {
  const vp = sources.scan.vp_data?.[ticker];
  const accumulation = sources.accumulation[ticker];
  const chart = sources.charts[ticker];
  if (!vp && !accumulation && !chart) return null;

  const accumulationSummary = accumulation ? {
    phase: accumulation.phase ?? "UNKNOWN",
    tier: accumulation.tier ?? "watch",
    raw_score: accumulation.raw_score ?? 0,
    decay_score: accumulation.decay_score ?? 0,
    failing: accumulation.failing ?? false,
    ...(plan === "free" ? {} : {
      support_primary: accumulation.support_primary ?? null,
      support_dynamic: accumulation.support_dynamic ?? null,
      resistance: accumulation.resistance ?? null,
      triggers_fired: accumulation.triggers_fired ?? [],
    }),
  } : null;
  const gaps = detectFvgs(chart?.daily?.ohlc ?? []);

  return {
    ticker,
    price: vp?.price ?? null,
    updatedAt: sources.scan.scan_time ?? null,
    vp: {
      consensus: consensus(vp),
      daily: frame(vp?.daily),
      weekly: frame(vp?.weekly),
      monthly: frame(vp?.monthly),
    },
    accumulation: accumulationSummary,
    fvg: fvgSummary(gaps, plan),
    access: {
      accumulationDetails: plan !== "free",
      fvgDetails: plan !== "free",
    },
  };
}

export async function loadAnalysisSources(
  supabase: SupabaseClient,
  tickers: string[]
): Promise<AnalysisSources> {
  if (tickers.length === 0) return { scan: {}, accumulation: {}, charts: {} };

  const [scanResult, accumulationResult, chartResult] = await Promise.all([
    supabase
      .from("scan_data")
      .select("vp_data, scan_time")
      .eq("id", "latest")
      .maybeSingle(),
    supabase
      .from("accum_data")
      .select("ticker, state")
      .in("ticker", tickers),
    supabase
      .from("chart_data")
      .select("ticker, data")
      .in("ticker", tickers),
  ]);
  if (scanResult.error || accumulationResult.error || chartResult.error) {
    throw new Error("ANALYSIS_SOURCE_UNAVAILABLE");
  }

  const scanRow = scanResult.data as {
    scan_time?: string;
    vp_data?: Record<string, VPInfo>;
  } | null;
  const accumulation = Object.fromEntries(
    (accumulationResult.data || []).map((row) => [row.ticker, row.state as AccumulationInfo])
  );
  const charts = Object.fromEntries(
    (chartResult.data || []).map((row) => [row.ticker, row.data as ChartInfo])
  );
  return {
    scan: { scan_time: scanRow?.scan_time, vp_data: scanRow?.vp_data || {} },
    accumulation,
    charts,
  };
}
