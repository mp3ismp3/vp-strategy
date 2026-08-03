import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  rateLimiters,
  authUserLimiters,
  getTierForRoute,
  isBlacklisted,
  logRateLimitEvent,
} from "./lib/rate-limit";

// ─── Auth-protected routes (same as before) ─────────────────
const AUTH_PROTECTED = ["/accumulation", "/fusion", "/account"];

function isAuthProtected(pathname: string): boolean {
  return AUTH_PROTECTED.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
}

// ─── Rate limit target routes ───────────────────────────────
function isRateLimited(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

// ─── Webhook routes that should bypass rate limiting ────────
// 這些路由有自己的 signature 驗證機制，不需要 rate limit：
// - Stripe webhook: 用 stripe-signature header 驗簽
// - Telegram webhook: 用 secret token 驗簽
// 這些服務的回呼無法重試太多次，被 429 擋到會丟失事件。
const WEBHOOK_WHITELIST = [
  "/api/stripe/webhook",
  "/api/telegram/webhook",
];

export function isWebhookWhitelisted(pathname: string): boolean {
  return WEBHOOK_WHITELIST.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
}

// ─── Helper: extract client IP ──────────────────────────────
// 注意：此函數僅適用於 Vercel 託管環境。
// Vercel Edge Network 會覆寫 x-real-ip，攻擊者無法偽造。
// 若部署到其他平台（如自建 Nginx），需改用不同的 IP 解析策略。
function getClientIp(request: NextRequest): string {
  const vercelIp = request.headers.get("x-real-ip");
  if (vercelIp) return vercelIp;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  return "127.0.0.1";
}

// ─── Helper: create 429 response ────────────────────────────
export function createRateLimitResponse(
  limit: number,
  reset: number
): NextResponse {
  // 邊界檢查：防止 reset 時間異常導致負值或超大值
  const rawRetryAfter = Math.ceil((reset - Date.now()) / 1000);
  const retryAfter = rawRetryAfter > 0 && rawRetryAfter <= 3600
    ? rawRetryAfter
    : 60; // fallback 60 秒

  return NextResponse.json(
    {
      error: "Too many requests",
      message: "請求過於頻繁，請稍後再試。",
      retryAfter,
    },
    {
      status: 429,
      headers: {
        "X-RateLimit-Limit": limit.toString(),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": reset.toString(),
        "Retry-After": retryAfter.toString(),
      },
    }
  );
}

// ─── Main Middleware ────────────────────────────────────────
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 提前解析 JWT token，避免重複呼叫（rate limit + auth 都需要）
  let token: Awaited<ReturnType<typeof getToken>> = null;
  try {
    token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });
  } catch {
    // Token 解析失敗時 token 保持 null，後續邏輯各自 fallback
  }

  // ─── 1. Rate Limiting (API routes only) ───────────────────
  if (isRateLimited(pathname)) {
    // Webhook 白名單：Stripe/Telegram 有自己的 signature 驗證，直接放行
    // 避免批量事件被 rate limit 擋到導致丟失付款/通知
    if (isWebhookWhitelisted(pathname)) {
      return NextResponse.next();
    }

    const ip = getClientIp(request);

    // Phase 3: IP 黑名單檢查
    try {
      const blocked = await isBlacklisted(ip);
      if (blocked) {
        return NextResponse.json(
          { error: "Forbidden", message: "此 IP 已被封鎖。" },
          { status: 403 }
        );
      }
    } catch {
      // Redis 故障時 fail-open，不阻擋請求
    }

    // Phase 2: 決定此路由的 tier
    const tier = getTierForRoute(pathname);

    // Phase 3: 判斷是否為登入用戶
    let userId: string | undefined;
    let limiter = rateLimiters[tier]; // 預設用 IP-based limiter
    let identifier = ip;

    if (token?.userId) {
      // 登入用戶：用 userId 當 key，享受更高額度
      userId = token.userId as string;
      limiter = authUserLimiters[tier];
      identifier = userId;
    }

    // 執行 rate limit 檢查
    try {
      const { success, limit, remaining, reset } =
        await limiter.limit(identifier);

      if (!success) {
        // Phase 3: 記錄被擋的請求（await 確保 Edge Runtime 結束前寫入完成）
        await logRateLimitEvent({
          ip,
          path: pathname,
          tier,
          blocked: true,
          remaining: 0,
          userId,
          timestamp: Date.now(),
        });

        return createRateLimitResponse(limit, reset);
      }

      // 正常通過：加上 rate limit headers
      const response = NextResponse.next();
      response.headers.set("X-RateLimit-Limit", limit.toString());
      response.headers.set("X-RateLimit-Remaining", remaining.toString());
      response.headers.set("X-RateLimit-Reset", reset.toString());
      return response;
    } catch {
      // Redis 故障時 fail-open：放行請求但不加 headers
      return NextResponse.next();
    }
  }

  // ─── 2. Auth Protection (page routes) ─────────────────────
  if (isAuthProtected(pathname)) {
    if (!token) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

// ─── Matcher ────────────────────────────────────────────────
// 匹配 API routes + auth-protected pages
export const config = {
  matcher: [
    "/api/:path*",
    "/accumulation",
    "/fusion",
    "/account",
  ],
};
