import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Next.js production structure", () => {
  it("uses the Next.js 16 proxy convention", () => {
    expect(existsSync(resolve(process.cwd(), "src/proxy.ts"))).toBe(true);
    expect(existsSync(resolve(process.cwd(), "src/middleware.ts"))).toBe(false);

    const source = readFileSync(resolve(process.cwd(), "src/proxy.ts"), "utf8");
    expect(source).toContain("export async function proxy(");
  });

  it("keeps runtime JSON reads out of automatic file tracing", () => {
    const config = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");

    expect(config).toContain("outputFileTracingIncludes");
    expect(config).not.toContain("./data/**/*");
    expect(config).toContain(
      '"/api/data/scan-results": ["./data/scan_results.json"]'
    );
    expect(config).toContain(
      '"/api/data/chart-data": ["./data/frontend_charts.json"]'
    );
    expect(config).toContain(
      '"/api/data/accum-state": ["./data/accum_state.json"]'
    );
    for (const [routeName, fileName] of [
      ["scan-results", "scan_results.json"],
      ["chart-data", "frontend_charts.json"],
      ["accum-state", "accum_state.json"],
    ]) {
      const route = readFileSync(
        resolve(process.cwd(), `src/app/api/data/${routeName}/route.ts`),
        "utf8"
      );
      expect(route).toContain(
        `path.join(process.cwd(), "data", "${fileName}")`
      );
      expect(route).toContain("NODE_ENV === \"development\"");
      expect(route).toContain(
        "fs.readFile(/* turbopackIgnore: true */ p, \"utf-8\")"
      );
    }
  });
});
