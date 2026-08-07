import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/data/scan-results": ["./data/scan_results.json"],
    "/api/data/chart-data": ["./data/frontend_charts.json"],
    "/api/data/accum-state": ["./data/accum_state.json"],
  },
};

export default nextConfig;
