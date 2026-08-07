/**
 * Rate Limit 功能單元測試
 *
 * 測試範圍：
 * - getTierForRoute: 路由 → tier 對應
 * - createRateLimitResponse: 429 回應 + retryAfter 邊界
 * - isWebhookWhitelisted: webhook 白名單匹配
 * - IP 驗證: IPv4 + IPv6 格式檢查
 * - fetchWithRetry: 429 重試邏輯
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── getTierForRoute ────────────────────────────────────────

// Mock Redis/Upstash 避免真的連線
vi.mock("@upstash/redis", () => ({
  Redis: {
    fromEnv: () => ({}),
  },
}));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    constructor() {}
    static slidingWindow() {
      return {};
    }
  },
}));

import { getTierForRoute } from "@/lib/rate-limit";

describe("getTierForRoute", () => {
  it("maps /api/admin/* to strict", () => {
    expect(getTierForRoute("/api/admin/rate-limit")).toBe("strict");
    expect(getTierForRoute("/api/admin")).toBe("strict");
    expect(getTierForRoute("/api/admin/users")).toBe("strict");
  });

  it("maps /api/auth/* to auth", () => {
    expect(getTierForRoute("/api/auth/signin")).toBe("auth");
    expect(getTierForRoute("/api/auth/callback")).toBe("auth");
    expect(getTierForRoute("/api/auth")).toBe("auth");
  });

  it("maps /api/stripe/checkout to strict", () => {
    expect(getTierForRoute("/api/stripe/checkout")).toBe("strict");
    expect(getTierForRoute("/api/stripe/checkout/session")).toBe("strict");
  });

  it("maps /api/stripe/portal to strict", () => {
    expect(getTierForRoute("/api/stripe/portal")).toBe("strict");
  });

  it("maps /api/telegram/bind to strict", () => {
    expect(getTierForRoute("/api/telegram/bind")).toBe("strict");
  });

  it("maps /api/user/plan to strict", () => {
    expect(getTierForRoute("/api/user/plan")).toBe("strict");
  });

  it("maps /api/data/* to data", () => {
    expect(getTierForRoute("/api/data/scan-results")).toBe("data");
    expect(getTierForRoute("/api/data/chart")).toBe("data");
    expect(getTierForRoute("/api/data")).toBe("data");
  });

  it("defaults to api for unmatched routes", () => {
    expect(getTierForRoute("/api/unknown")).toBe("api");
    expect(getTierForRoute("/api/some/random/path")).toBe("api");
    expect(getTierForRoute("/api/")).toBe("api");
  });

  it("route matching is prefix-based (first match wins)", () => {
    // /api/admin is checked before /api/auth, so /api/admin/auth goes to strict
    expect(getTierForRoute("/api/admin/auth")).toBe("strict");
  });

  it("does not match non-API paths", () => {
    // These shouldn't normally reach getTierForRoute (middleware filters),
    // but the function should still return "api" as fallback
    expect(getTierForRoute("/accumulation")).toBe("api");
    expect(getTierForRoute("/")).toBe("api");
  });
});

// ─── createRateLimitResponse ────────────────────────────────

import { config, createRateLimitResponse } from "@/proxy";

describe("page access matcher", () => {
  it("keeps accumulation public for the guest top-ten preview", () => {
    expect(config.matcher).not.toContain("/accumulation");
    expect(config.matcher).toContain("/fusion");
    expect(config.matcher).toContain("/account");
  });
});

describe("createRateLimitResponse", () => {
  it("calculates retryAfter from reset time", () => {
    const now = Date.now();
    const reset = now + 45_000; // 45 seconds in the future
    const response = createRateLimitResponse(30, reset);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("45");
    expect(response.headers.get("X-RateLimit-Limit")).toBe("30");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("uses fallback 60s when reset is in the past (negative retryAfter)", () => {
    const pastReset = Date.now() - 10_000; // 10 seconds ago
    const response = createRateLimitResponse(30, pastReset);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
  });

  it("uses fallback 60s when retryAfter exceeds 3600", () => {
    const farFuture = Date.now() + 7200_000; // 2 hours
    const response = createRateLimitResponse(30, farFuture);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
  });

  it("uses fallback 60s when reset equals now (zero retryAfter)", () => {
    const response = createRateLimitResponse(30, Date.now());

    expect(response.status).toBe(429);
    // Math.ceil(0/1000) = 0, which is not > 0, so fallback
    expect(response.headers.get("Retry-After")).toBe("60");
  });

  it("handles reset exactly 1 second in the future", () => {
    const reset = Date.now() + 1000;
    const response = createRateLimitResponse(5, reset);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(response.headers.get("X-RateLimit-Limit")).toBe("5");
  });

  it("handles reset exactly at 3600s boundary", () => {
    const reset = Date.now() + 3600_000;
    const response = createRateLimitResponse(30, reset);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
  });

  it("returns correct JSON body", async () => {
    const reset = Date.now() + 30_000;
    const response = createRateLimitResponse(20, reset);
    const body = await response.json();

    expect(body.error).toBe("Too many requests");
    expect(body.message).toBe("請求過於頻繁，請稍後再試。");
    expect(body.retryAfter).toBe(30);
  });
});

// ─── isWebhookWhitelisted ───────────────────────────────────

import { isWebhookWhitelisted } from "@/proxy";

describe("isWebhookWhitelisted", () => {
  it("matches exact webhook paths", () => {
    expect(isWebhookWhitelisted("/api/stripe/webhook")).toBe(true);
    expect(isWebhookWhitelisted("/api/telegram/webhook")).toBe(true);
  });

  it("matches sub-paths of webhook routes", () => {
    expect(isWebhookWhitelisted("/api/stripe/webhook/events")).toBe(true);
    expect(isWebhookWhitelisted("/api/telegram/webhook/update")).toBe(true);
  });

  it("does not match non-webhook paths", () => {
    expect(isWebhookWhitelisted("/api/stripe/checkout")).toBe(false);
    expect(isWebhookWhitelisted("/api/telegram/bind")).toBe(false);
    expect(isWebhookWhitelisted("/api/data/scan-results")).toBe(false);
    expect(isWebhookWhitelisted("/api/auth/signin")).toBe(false);
  });

  it("does not match partial prefix (no false positives)", () => {
    expect(isWebhookWhitelisted("/api/stripe/webhookx")).toBe(false);
    expect(isWebhookWhitelisted("/api/stripe/webhook-test")).toBe(false);
  });

  it("does not match webhook as substring in unrelated path", () => {
    expect(isWebhookWhitelisted("/api/webhook")).toBe(false);
    expect(isWebhookWhitelisted("/webhook")).toBe(false);
  });
});

// ─── IP Validation ──────────────────────────────────────────

import { isValidIPv4, isValidIPv6, isValidIP } from "@/lib/ip-validation";

describe("isValidIPv4", () => {
  it("accepts valid IPv4 addresses", () => {
    expect(isValidIPv4("192.168.1.1")).toBe(true);
    expect(isValidIPv4("0.0.0.0")).toBe(true);
    expect(isValidIPv4("255.255.255.255")).toBe(true);
    expect(isValidIPv4("10.0.0.1")).toBe(true);
    expect(isValidIPv4("172.16.0.1")).toBe(true);
    expect(isValidIPv4("1.2.3.4")).toBe(true);
  });

  it("rejects invalid IPv4 addresses", () => {
    expect(isValidIPv4("256.0.0.1")).toBe(false);
    expect(isValidIPv4("192.168.1")).toBe(false);
    expect(isValidIPv4("192.168.1.1.1")).toBe(false);
    expect(isValidIPv4("")).toBe(false);
    expect(isValidIPv4("abc.def.ghi.jkl")).toBe(false);
    expect(isValidIPv4("192.168.1.999")).toBe(false);
    expect(isValidIPv4("192.168.01.1")).toBe(true); // 01 is valid as [01]?\d\d?
  });

  it("rejects non-IP strings", () => {
    expect(isValidIPv4("hello")).toBe(false);
    expect(isValidIPv4("::1")).toBe(false);
    expect(isValidIPv4("192.168.1.1/24")).toBe(false);
  });
});

describe("isValidIPv6", () => {
  it("accepts valid full IPv6 addresses", () => {
    expect(isValidIPv6("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(true);
    expect(isValidIPv6("fe80:0000:0000:0000:0000:0000:0000:0001")).toBe(true);
    expect(isValidIPv6("0000:0000:0000:0000:0000:0000:0000:0001")).toBe(true);
  });

  it("accepts valid abbreviated IPv6 addresses", () => {
    expect(isValidIPv6("2001:db8:85a3::8a2e:370:7334")).toBe(true);
    expect(isValidIPv6("::1")).toBe(true);
    expect(isValidIPv6("::")).toBe(true);
    expect(isValidIPv6("fe80::1")).toBe(true);
    expect(isValidIPv6("2001:db8::")).toBe(true);
  });

  it("rejects IPv6 with multiple ::", () => {
    expect(isValidIPv6("2001::db8::1")).toBe(false);
    expect(isValidIPv6("::1::2")).toBe(false);
  });

  it("rejects IPv6 with invalid characters", () => {
    expect(isValidIPv6("2001:db8:85a3::8a2e:370:733g")).toBe(false);
    expect(isValidIPv6("2001:db8:85a3::8a2e:370:7334 ")).toBe(false);
    expect(isValidIPv6("xxxx:xxxx:xxxx:xxxx:xxxx:xxxx:xxxx:xxxx")).toBe(false);
  });

  it("rejects IPv6 with too many groups", () => {
    expect(isValidIPv6("2001:db8:85a3:0:0:8a2e:370:7334:extra")).toBe(false);
  });

  it("rejects IPv6 with groups longer than 4 hex chars", () => {
    expect(isValidIPv6("2001:0db8:85a3:00000:0000:8a2e:0370:7334")).toBe(false);
  });

  it("rejects IPv6 starting with single colon (not ::)", () => {
    expect(isValidIPv6(":1:2:3:4:5:6:7")).toBe(false);
  });

  it("rejects IPv6 ending with single colon (not ::)", () => {
    expect(isValidIPv6("1:2:3:4:5:6:7:")).toBe(false);
  });

  it("rejects triple colons", () => {
    expect(isValidIPv6("2001:::1")).toBe(false);
  });

  it("rejects non-IPv6 strings", () => {
    expect(isValidIPv6("192.168.1.1")).toBe(false);
    expect(isValidIPv6("")).toBe(false);
    expect(isValidIPv6("hello")).toBe(false);
  });
});

describe("isValidIP", () => {
  it("accepts both IPv4 and IPv6", () => {
    expect(isValidIP("192.168.1.1")).toBe(true);
    expect(isValidIP("::1")).toBe(true);
    expect(isValidIP("2001:db8::1")).toBe(true);
  });

  it("rejects invalid addresses", () => {
    expect(isValidIP("not-an-ip")).toBe(false);
    expect(isValidIP("")).toBe(false);
    expect(isValidIP("999.999.999.999")).toBe(false);
  });
});

// ─── fetchWithRetry ─────────────────────────────────────────

import {
  fetchWithRetry,
  parseRateLimitHeaders,
  getRateLimitMessage,
} from "@/lib/fetch-with-retry";

describe("fetchWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns response immediately on non-429 status", async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), {
      status: 200,
    });
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse);

    const result = await fetchWithRetry("/api/test");

    expect(result.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and succeeds on retry", async () => {
    const rateLimitedResponse = new Response("", {
      status: 429,
      headers: { "Retry-After": "1" },
    });
    const successResponse = new Response(JSON.stringify({ ok: true }), {
      status: 200,
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(rateLimitedResponse)
      .mockResolvedValueOnce(successResponse);

    const promise = fetchWithRetry("/api/test", { maxRetries: 2 });

    // Advance past the 1s retry delay
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns 429 response after exhausting retries", async () => {
    const rateLimitedResponse = new Response("", {
      status: 429,
      headers: { "Retry-After": "1" },
    });

    vi.mocked(fetch).mockResolvedValue(rateLimitedResponse);

    const promise = fetchWithRetry("/api/test", { maxRetries: 1 });

    // First 429 → wait 1s → retry → 429 → give up
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result.status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it("calls onRateLimited callback on 429", async () => {
    const rateLimitedResponse = new Response("", {
      status: 429,
      headers: { "Retry-After": "5" },
    });
    const successResponse = new Response("", { status: 200 });

    vi.mocked(fetch)
      .mockResolvedValueOnce(rateLimitedResponse)
      .mockResolvedValueOnce(successResponse);

    const onRateLimited = vi.fn();

    const promise = fetchWithRetry("/api/test", {
      maxRetries: 1,
      onRateLimited,
    });

    await vi.advanceTimersByTimeAsync(5000);

    await promise;
    expect(onRateLimited).toHaveBeenCalledWith(5, 1);
  });

  it("uses exponential backoff when no Retry-After header", async () => {
    const rateLimitedResponse = new Response("", { status: 429 });
    const successResponse = new Response("", { status: 200 });

    vi.mocked(fetch)
      .mockResolvedValueOnce(rateLimitedResponse)
      .mockResolvedValueOnce(successResponse);

    const onRateLimited = vi.fn();

    const promise = fetchWithRetry("/api/test", {
      maxRetries: 1,
      onRateLimited,
    });

    // Default backoff for attempt 0: 2^0 * 2 = 2s
    await vi.advanceTimersByTimeAsync(2000);

    await promise;
    expect(onRateLimited).toHaveBeenCalledWith(2, 1);
  });

  it("defaults to maxRetries=2 when not specified", async () => {
    const rateLimitedResponse = new Response("", {
      status: 429,
      headers: { "Retry-After": "1" },
    });

    vi.mocked(fetch).mockResolvedValue(rateLimitedResponse);

    const promise = fetchWithRetry("/api/test");

    // 3 total attempts: initial + 2 retries
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result.status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("passes fetch options through to fetch", async () => {
    const successResponse = new Response("", { status: 200 });
    vi.mocked(fetch).mockResolvedValueOnce(successResponse);

    await fetchWithRetry("/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: 1 }),
    });

    expect(fetch).toHaveBeenCalledWith("/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: 1 }),
    });
  });
});

describe("parseRateLimitHeaders", () => {
  it("parses all rate limit headers", () => {
    const response = new Response("", {
      headers: {
        "X-RateLimit-Limit": "30",
        "X-RateLimit-Remaining": "25",
        "X-RateLimit-Reset": "1700000000",
      },
    });

    const info = parseRateLimitHeaders(response);
    expect(info).toEqual({
      limit: 30,
      remaining: 25,
      reset: 1700000000,
    });
  });

  it("returns null if any header is missing", () => {
    const response = new Response("", {
      headers: {
        "X-RateLimit-Limit": "30",
        // missing remaining and reset
      },
    });

    expect(parseRateLimitHeaders(response)).toBeNull();
  });

  it("returns null when no rate limit headers present", () => {
    const response = new Response("");
    expect(parseRateLimitHeaders(response)).toBeNull();
  });
});

describe("getRateLimitMessage", () => {
  it("returns short message for ≤ 5 seconds", () => {
    expect(getRateLimitMessage(3)).toBe("請求過於頻繁，請稍候...");
    expect(getRateLimitMessage(5)).toBe("請求過於頻繁，請稍候...");
  });

  it("returns seconds-based message for 6-30 seconds", () => {
    expect(getRateLimitMessage(15)).toBe("操作太頻繁，請等待 15 秒後再試。");
    expect(getRateLimitMessage(30)).toBe("操作太頻繁，請等待 30 秒後再試。");
  });

  it("returns minutes-based message for > 30 seconds", () => {
    expect(getRateLimitMessage(60)).toBe("請求已被限制，請在 1 分鐘後再試。");
    expect(getRateLimitMessage(90)).toBe("請求已被限制，請在 2 分鐘後再試。");
    expect(getRateLimitMessage(31)).toBe("請求已被限制，請在 1 分鐘後再試。");
  });
});
