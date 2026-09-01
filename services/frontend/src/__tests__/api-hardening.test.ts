import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

import { apiError, serviceUnavailable } from "@/lib/api-response";
import { getClientIp, shouldFailClosedOnRateLimitError } from "@/proxy";

describe("API error responses", () => {
  it("uses a stable error envelope without exposing internal errors", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = apiError("DATA_SOURCE_UNAVAILABLE", "Data is temporarily unavailable", 503, {
      internalError: new Error("postgres password=secret"),
      retryAfter: 30,
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(await response.json()).toEqual({
      error: {
        code: "DATA_SOURCE_UNAVAILABLE",
        message: "Data is temporarily unavailable",
        requestId: expect.any(String),
      },
    });
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain("secret");
    consoleSpy.mockRestore();
  });

  it("returns a retryable gateway dependency failure", async () => {
    const response = serviceUnavailable("RATE_LIMIT_UNAVAILABLE", "Request protection is temporarily unavailable");
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
  });
});

describe("portable gateway trust boundary", () => {
  const request = new NextRequest("https://app.example.com/api/data/scan-results", {
    headers: {
      "x-real-ip": "198.51.100.10",
      "x-forwarded-for": "203.0.113.8, 10.0.0.1",
    },
  });

  it("trusts Vercel's normalized client header only in Vercel mode", () => {
    expect(getClientIp(request, { TRUSTED_PROXY_MODE: "vercel" })).toBe("198.51.100.10");
  });

  it("trusts the first forwarded address only when explicitly configured", () => {
    expect(getClientIp(request, { TRUSTED_PROXY_MODE: "x-forwarded-for" })).toBe("203.0.113.8");
  });

  it("does not trust forwarded headers by default on self-hosted deployments", () => {
    expect(getClientIp(request, {})).toBe("untrusted-proxy");
  });

  it("fails closed for production auth and strict tiers only", () => {
    expect(shouldFailClosedOnRateLimitError("auth", "production")).toBe(true);
    expect(shouldFailClosedOnRateLimitError("strict", "production")).toBe(true);
    expect(shouldFailClosedOnRateLimitError("data", "production")).toBe(false);
    expect(shouldFailClosedOnRateLimitError("strict", "development")).toBe(false);
  });
});

describe("production API source boundaries", () => {
  it("does not return caught exception messages from data routes", () => {
    for (const route of ["scan-results", "chart-data", "accum-state", "fusion", "dashboard"]) {
      const source = readFileSync(`src/app/api/data/${route}/route.ts`, "utf8");
      expect(source).not.toMatch(/NextResponse\.json\([^\n]*error:\s*message/);
      expect(source).toContain("serviceUnavailable(");
    }

    const symbolRoute = readFileSync("src/app/api/data/symbol/[ticker]/route.ts", "utf8");
    expect(symbolRoute).toContain("serviceUnavailable(");
  });

  it("documents every personal watchlist consumer route", () => {
    const docs = readFileSync("../../docs/API.md", "utf8");
    const openapi = readFileSync("openapi.yaml", "utf8");
    for (const route of [
      "/api/user/watchlist",
      "/api/user/watchlist/{ticker}",
      "/api/data/dashboard",
      "/api/data/symbol/{ticker}",
    ]) {
      expect(docs).toContain(route);
      expect(openapi).toContain(`${route}:`);
    }
  });

  it("publishes baseline browser security headers", () => {
    const config = readFileSync("next.config.ts", "utf8");
    for (const header of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]) {
      expect(config).toContain(header);
    }
  });

  it("only enables HSTS in production", () => {
    const config = readFileSync("next.config.ts", "utf8");
    expect(config).toContain('process.env.NODE_ENV === "production"');
    expect(config).toContain("Strict-Transport-Security");
  });

  it("protects the cookie-authenticated rate-limit mutation from CSRF", () => {
    const source = readFileSync("src/app/api/admin/rate-limit/route.ts", "utf8");
    expect(source).toContain("isTrustedMutationRequest(request)");
    expect(source).toContain("isJsonRequest(request)");
  });

  it("protects cookie-authenticated watchlist mutations from CSRF", () => {
    const collectionRoute = readFileSync("src/app/api/user/watchlist/route.ts", "utf8");
    const itemRoute = readFileSync("src/app/api/user/watchlist/[ticker]/route.ts", "utf8");
    expect(collectionRoute.match(/isTrustedMutationRequest\(request\)/g)).toHaveLength(2);
    expect(collectionRoute.match(/isJsonRequest\(request\)/g)).toHaveLength(2);
    expect(itemRoute).toContain("isTrustedMutationRequest(request)");
  });

  it("uses the stable infrastructure error envelope for watchlist routes", () => {
    const collectionRoute = readFileSync("src/app/api/user/watchlist/route.ts", "utf8");
    const itemRoute = readFileSync("src/app/api/user/watchlist/[ticker]/route.ts", "utf8");
    expect(collectionRoute.match(/serviceUnavailable\(/g)).toHaveLength(3);
    expect(itemRoute).toContain("serviceUnavailable(");
  });
});
