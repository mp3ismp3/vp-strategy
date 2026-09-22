import { configDefaults, defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    // Runtime-data backtests have a dedicated config and must not enter unit tests.
    exclude: [...configDefaults.exclude, "scripts/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
