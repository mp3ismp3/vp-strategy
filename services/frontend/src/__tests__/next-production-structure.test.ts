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

  it("reads production analysis data through server-side Supabase", () => {
    const config = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");

    expect(config).not.toContain("outputFileTracingIncludes");
    for (const routeName of ["scan-results", "chart-data", "accum-state"]) {
      const route = readFileSync(
        resolve(process.cwd(), `src/app/api/data/${routeName}/route.ts`),
        "utf8"
      );
      expect(route).toContain("getSupabaseAdmin");
      expect(route).not.toContain("fs.readFile");
    }
  });
});
