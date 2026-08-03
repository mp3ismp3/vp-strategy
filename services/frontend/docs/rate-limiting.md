# Rate Limiting 設定說明

本專案使用 **Upstash Redis + Edge Middleware** 實作 API rate limiting，保護 Vercel 免費額度不被濫用。

## 架構

```
Client Request
     ↓
Vercel Edge Middleware (src/middleware.ts)
     ↓
┌─ IP Blacklist Check (Redis SET)
│       ↓ blocked → 403
│       ↓ pass
├─ Determine Route Tier (routeTierMap)
│       ↓
├─ Check JWT Token
│       ↓ logged in → use userId key + higher limits
│       ↓ anonymous → use IP key + standard limits
│       ↓
├─ Upstash Ratelimit.limit(identifier)
│       ↓ exceeded → 429 + log event
│       ↓ pass → add rate limit headers + forward
└─ → API Route Handler
```

## Rate Limit Tiers

| Tier | 匿名用戶 (IP) | 登入用戶 (userId) | 適用路由 |
|------|-------------|-----------------|----------|
| `api` | 30 req / 60s | 60 req / 60s | 其他所有 API |
| `auth` | 5 req / 60s | 10 req / 60s | `/api/auth/*` |
| `data` | 20 req / 60s | 40 req / 60s | `/api/data/*` |
| `strict` | 3 req / 60s | 5 req / 60s | `/api/stripe/checkout`, `/api/stripe/portal`, `/api/user/plan` |

> **注意：** Webhook 路由（`/api/stripe/webhook`、`/api/telegram/webhook`）由 middleware 白名單直接放行，不走 rate limit。

## 設置步驟

### 1. 建立 Upstash Redis

1. 到 [upstash.com](https://upstash.com) 註冊（免費）
2. 建立一個 Redis database（選離 Vercel 部署區域最近的）
3. 複製 REST URL 和 Token

### 2. 設定環境變數

在 Vercel Dashboard → Settings → Environment Variables 加入：

```
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxx...
ADMIN_EMAILS=your-email@gmail.com
```

本機開發也要加到 `.env.local`。

### 3. 部署

```bash
git add .
git commit -m "feat: add rate limiting with Upstash Redis"
git push
```

Vercel 會自動部署，Edge Middleware 會立即生效。

## Response Headers

每個 API 回應都會附帶 rate limit 資訊：

```
X-RateLimit-Limit: 30        # 此 tier 的總額度
X-RateLimit-Remaining: 27    # 剩餘次數
X-RateLimit-Reset: 1720000000 # 額度重置的 Unix timestamp
```

被限制時（429）額外附帶：
```
Retry-After: 45              # 建議等待秒數
```

## 前端使用

用 `fetchWithRetry` 取代 `fetch`，自動處理 429：

```typescript
import { fetchWithRetry } from '@/lib/fetch-with-retry';

// 自動重試 + 指數退避
const res = await fetchWithRetry('/api/data/scan-results', {
  maxRetries: 2,
  onRateLimited: (seconds, attempt) => {
    console.warn(`Rate limited, retrying in ${seconds}s (attempt ${attempt})`);
    // 或顯示 toast 提示用戶
  },
});
```

## 管理 API

### 查看監控數據

```
GET /api/admin/rate-limit
Authorization: 必須用 ADMIN_EMAILS 中的帳號登入
```

回傳：
```json
{
  "recentBlocked": [...],
  "blacklist": ["1.2.3.4"],
  "summary": {
    "totalBlocked": 15,
    "uniqueIPs": 3,
    "topOffenders": [{ "ip": "1.2.3.4", "count": 12 }]
  }
}
```

### 管理黑名單

```
POST /api/admin/rate-limit
Content-Type: application/json

{ "action": "add", "ip": "1.2.3.4" }
{ "action": "remove", "ip": "1.2.3.4" }
```

## 安全策略

| 狀況 | 行為 |
|------|------|
| Redis 連線失敗 | **Fail-open**：放行請求，不阻擋（避免整站掛掉） |
| JWT 解析失敗 | 降級為 IP-based 限制 |
| 黑名單 IP | 直接 403，不消耗 rate limit quota |
| Webhook 路由 | 即使被 rate limit 也不影響 Stripe/Telegram callback |

## 調整限制

修改 `src/lib/rate-limit.ts` 中的 `rateLimiters` 和 `authUserLimiters`：

```typescript
// 例如把 data tier 放寬到 50 次/分鐘
data: new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(50, "60 s"),
  prefix: "rl:data",
  analytics: true,
}),
```

修改路由對應的 tier，編輯 `routeTierEntries` 陣列：

```typescript
const routeTierEntries: [string, RateLimitTier][] = [
  ["/api/auth", "auth"],
  ["/api/new-route", "strict"],  // 新增路由對應
  ...
];
```

## 費用

- **Upstash 免費 tier**：10,000 commands/day
- 每個 API 請求消耗 ~2 commands（limit + 黑名單檢查）
- 免費額度可支撐 ~5,000 API 請求/天
- 超過可升級 Pay-as-you-go（$0.2 / 100K commands）

## 檔案結構

```
src/
├── middleware.ts              # Edge Middleware 入口（rate limit + auth）
├── lib/
│   ├── rate-limit.ts          # Rate limiter 設定 + 黑名單 + logging
│   └── fetch-with-retry.ts    # 前端 429 處理 utility
└── app/api/admin/
    └── rate-limit/route.ts    # 監控 + 黑名單管理 API
```
