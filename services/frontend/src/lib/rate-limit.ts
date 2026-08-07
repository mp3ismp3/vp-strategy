import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// ─── Redis Client ───────────────────────────────────────────
// 使用環境變數自動連接 Upstash Redis
const redis = Redis.fromEnv();

// ─── Rate Limit Tiers ───────────────────────────────────────
// 不同路由對應不同限制等級

// 注意：webhook 路由（Stripe/Telegram）在 middleware 中由 WEBHOOK_WHITELIST 直接放行，
// 不會走到 tier 判定邏輯，因此不需要 webhook tier。
export type RateLimitTier = "api" | "auth" | "data" | "strict";

/**
 * Rate limiters 分級定義：
 * - api:     一般 API（30 req / 60s） — 頁面載入、查詢
 * - auth:    認證相關（5 req / 60s） — 登入、註冊
 * - data:    資料查詢（20 req / 60s） — scan results, chart data
 * - strict:  敏感操作（3 req / 60s） — checkout, plan 變更
 *
 * 注意：webhook 路由（Stripe/Telegram）由 middleware 白名單直接放行，
 * 不經過 rate limit，因此不需要 webhook tier。
 */
export const rateLimiters: Record<RateLimitTier, Ratelimit> = {
  api: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, "60 s"),
    prefix: "rl:api",
    analytics: true,
  }),

  auth: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, "60 s"),
    prefix: "rl:auth",
    analytics: true,
  }),

  data: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(20, "60 s"),
    prefix: "rl:data",
    analytics: true,
  }),

  strict: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(3, "60 s"),
    prefix: "rl:strict",
    analytics: true,
  }),
};

// ─── Authenticated User Limiters (Phase 3) ──────────────────
// 登入用戶額度更寬鬆，用 userId 作為 key 而非 IP

export const authUserLimiters: Record<RateLimitTier, Ratelimit> = {
  api: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(60, "60 s"),
    prefix: "rl:user:api",
    analytics: true,
  }),

  auth: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "60 s"),
    prefix: "rl:user:auth",
    analytics: true,
  }),

  data: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(40, "60 s"),
    prefix: "rl:user:data",
    analytics: true,
  }),

  strict: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, "60 s"),
    prefix: "rl:user:strict",
    analytics: true,
  }),
};

// ─── Route → Tier Mapping (Phase 2) ────────────────────────
// 路由前綴對應限制等級
// 注意：/api/stripe/webhook 和 /api/telegram/webhook 不在此列表中，
// 因為它們在 middleware 中被 WEBHOOK_WHITELIST 直接放行（有自己的 signature 驗證），
// 不會走到 tier 判定邏輯。見 middleware.ts 的 isWebhookWhitelisted()。

const routeTierEntries: [string, RateLimitTier][] = [
  ["/api/admin", "strict"],
  ["/api/auth", "auth"],
  ["/api/stripe/checkout", "strict"],
  ["/api/stripe/portal", "strict"],
  ["/api/ecpay/checkout", "strict"],
  ["/api/ecpay/cancel", "strict"],
  ["/api/telegram/bind", "strict"],
  ["/api/user/plan", "strict"],
  ["/api/data", "data"],
];

/**
 * 根據路由路徑決定使用哪個 tier
 */
export function getTierForRoute(pathname: string): RateLimitTier {
  for (const [prefix, tier] of routeTierEntries) {
    if (pathname.startsWith(prefix)) return tier;
  }
  return "api";
}

// ─── IP Blacklist (Phase 3) ─────────────────────────────────

const BLACKLIST_KEY = "rl:blacklist";

/**
 * 檢查 IP 是否在黑名單中
 */
export async function isBlacklisted(ip: string): Promise<boolean> {
  try {
    return (await redis.sismember(BLACKLIST_KEY, ip)) === 1;
  } catch {
    // Redis 故障時不阻擋請求（fail-open）
    return false;
  }
}

/**
 * 將 IP 加入黑名單
 */
export async function addToBlacklist(ip: string): Promise<void> {
  await redis.sadd(BLACKLIST_KEY, ip);
}

/**
 * 將 IP 從黑名單移除
 */
export async function removeFromBlacklist(ip: string): Promise<void> {
  await redis.srem(BLACKLIST_KEY, ip);
}

/**
 * 取得所有黑名單 IP
 */
export async function getBlacklist(): Promise<string[]> {
  return (await redis.smembers(BLACKLIST_KEY)) as string[];
}

// ─── Blacklist Audit Log (Phase 3) ──────────────────────────

export interface BlacklistAuditEntry {
  action: "add" | "remove";
  ip: string;
  operatorEmail: string;
  timestamp: number;
}

const BLACKLIST_AUDIT_KEY = "rl:blacklist:audit";
const MAX_AUDIT_SIZE = 200;

/**
 * 記錄黑名單操作的 audit log
 * 追蹤誰在什麼時候加/移除了哪個 IP
 */
export async function logBlacklistAudit(entry: BlacklistAuditEntry): Promise<void> {
  try {
    await redis.lpush(BLACKLIST_AUDIT_KEY, JSON.stringify(entry));
    await redis.ltrim(BLACKLIST_AUDIT_KEY, 0, MAX_AUDIT_SIZE - 1);
  } catch {
    // Audit log 寫入失敗不影響操作
  }
}

/**
 * 取得黑名單操作歷史
 */
export async function getBlacklistAuditLog(
  count: number = 50
): Promise<BlacklistAuditEntry[]> {
  try {
    const entries = await redis.lrange(BLACKLIST_AUDIT_KEY, 0, count - 1);
    return entries.map((e) =>
      typeof e === "string" ? JSON.parse(e) : e
    ) as BlacklistAuditEntry[];
  } catch {
    return [];
  }
}

// ─── Rate Limit Logging (Phase 3) ──────────────────────────

export interface RateLimitEvent {
  ip: string;
  path: string;
  tier: RateLimitTier;
  blocked: boolean;
  remaining: number;
  userId?: string;
  timestamp: number;
}

/**
 * 記錄被阻擋的請求到 Redis list（保留最近 1000 筆）
 * 用於監控和分析攻擊模式
 */
export async function logRateLimitEvent(event: RateLimitEvent): Promise<void> {
  const LOG_KEY = "rl:log:blocked";
  const MAX_LOG_SIZE = 1000;

  try {
    await redis.lpush(LOG_KEY, JSON.stringify(event));
    await redis.ltrim(LOG_KEY, 0, MAX_LOG_SIZE - 1);
  } catch {
    // 日誌記錄失敗不影響請求
  }
}

/**
 * 取得最近的 rate limit 事件（用於監控面板）
 */
export async function getRecentEvents(
  count: number = 50
): Promise<RateLimitEvent[]> {
  try {
    const events = await redis.lrange("rl:log:blocked", 0, count - 1);
    return events.map((e) =>
      typeof e === "string" ? JSON.parse(e) : e
    ) as RateLimitEvent[];
  } catch {
    return [];
  }
}
