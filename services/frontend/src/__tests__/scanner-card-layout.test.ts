import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scannerPage = readFileSync(
  resolve(process.cwd(), "src/app/scanner/page.tsx"),
  "utf8",
);

describe("scanner card value-area badges", () => {
  it("summarizes card touches instead of repeating a badge for every timeframe", () => {
    expect(scannerPage).toContain("summarizeValueAreaTouches");
    expect(scannerPage).toContain("positionBadge(r.daily, false)");
    expect(scannerPage).toContain("positionBadge(r.weekly, false)");
    expect(scannerPage).toContain("positionBadge(r.monthly, false)");
    expect(scannerPage).toContain("flex flex-wrap gap-1");
  });
});
