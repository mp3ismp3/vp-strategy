import { describe, expect, it, vi } from "vitest";
import { loadAnalysisSources } from "@/lib/symbol-analysis";

function createSupabase(options?: { chartError?: unknown }) {
  const scanQuery: Record<string, ReturnType<typeof vi.fn>> = {};
  scanQuery.select = vi.fn(() => scanQuery);
  scanQuery.eq = vi.fn(() => scanQuery);
  scanQuery.maybeSingle = vi.fn().mockResolvedValue({
    data: { vp_data: { NVDA: { price: 120 } }, scan_time: "2026-09-01T21:05:00Z" },
    error: null,
  });

  const accumQuery: Record<string, ReturnType<typeof vi.fn>> = {};
  accumQuery.select = vi.fn(() => accumQuery);
  accumQuery.in = vi.fn().mockResolvedValue({
    data: [{ ticker: "NVDA", state: { phase: "D", decay_score: 11 } }],
    error: null,
  });

  const chartQuery: Record<string, ReturnType<typeof vi.fn>> = {};
  chartQuery.select = vi.fn(() => chartQuery);
  chartQuery.in = vi.fn().mockResolvedValue({
    data: [{ ticker: "NVDA", data: { daily: { ohlc: [] } } }],
    error: options?.chartError ?? null,
  });

  return {
    from: vi.fn((table: string) => {
      if (table === "scan_data") return scanQuery;
      if (table === "accum_data") return accumQuery;
      if (table === "chart_data") return chartQuery;
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

describe("production symbol analysis source", () => {
  it("loads only requested ticker rows from server-side Supabase tables", async () => {
    const supabase = createSupabase();

    const sources = await loadAnalysisSources(supabase as never, ["NVDA"]);

    expect(supabase.from.mock.calls.map(([table]) => table)).toEqual([
      "scan_data",
      "accum_data",
      "chart_data",
    ]);
    expect(sources).toMatchObject({
      scan: { vp_data: { NVDA: { price: 120 } } },
      accumulation: { NVDA: { phase: "D" } },
      charts: { NVDA: { daily: { ohlc: [] } } },
    });
  });

  it("fails closed when an analysis table cannot be read", async () => {
    const supabase = createSupabase({ chartError: { message: "unavailable" } });

    await expect(loadAnalysisSources(supabase as never, ["NVDA"]))
      .rejects.toThrow("ANALYSIS_SOURCE_UNAVAILABLE");
  });
});
