import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Include data files in serverless function bundle
  outputFileTracingIncludes: {
    "/api/data/*": ["./data/**/*"],
  },
};

export default nextConfig;
