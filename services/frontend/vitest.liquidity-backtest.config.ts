import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["scripts/liquidity-backtest.test.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
