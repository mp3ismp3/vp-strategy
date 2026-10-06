import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scannerPage = readFileSync(
  resolve(process.cwd(), "src/app/scanner/page.tsx"),
  "utf8",
);

describe("scanner card value-area badges", () => {
  it("keeps a VAL touch with its timeframe badge while allowing card rows to wrap", () => {
    expect(scannerPage).toContain('`${touch.toUpperCase()} 觸及`');
    expect(scannerPage).toContain("flex flex-wrap gap-1");
    expect(scannerPage).toContain('className="inline-flex items-center gap-1 whitespace-nowrap"');
  });
});
