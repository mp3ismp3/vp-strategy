# API gateway and rate limiting

Next.js 16 `src/proxy.ts` runs before matched API routes and the protected
`/fusion` and `/account` pages. It provides Redis-backed quotas, IP blocking,
rate-limit headers, and page redirects. Authorization is still enforced inside
each route handler.

## Request flow

```text
request
  -> webhook/callback bypass? -> route signature or MAC validation
  -> trusted client-IP extraction
  -> Redis blacklist
  -> route tier + anonymous IP or authenticated user key
  -> quota exceeded: 429
  -> Redis error on auth/strict in production: 503
  -> route handler authentication, entitlement and validation
```

## Tiers

| Tier | Anonymous | Signed in | Routes |
|---|---:|---:|---|
| `api` | 30/60s | 60/60s | Other APIs, including health |
| `auth` | 5/60s | 10/60s | `/api/auth/*` |
| `data` | 20/60s | 40/60s | `/api/data/*` |
| `strict` | 3/60s | 5/60s | `/api/admin/*`, checkout, portal, cancel, bind and plan routes |

Stripe, Telegram, and ECPay callback routes in `WEBHOOK_WHITELIST` bypass Redis
quotas so provider delivery is not dropped. Each bypassed handler must validate
its own signature, secret, or CheckMacValue and enforce a streaming body cap.

## Required configuration

```dotenv
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
TRUSTED_PROXY_MODE=vercel
ADMIN_EMAILS=admin@example.com
```

Use `TRUSTED_PROXY_MODE=vercel` only behind Vercel's normalized `x-real-ip`.
Use `x-forwarded-for` only behind a reverse proxy that removes client-supplied
forwarding headers and writes the canonical chain. With no mode, forwarded
headers are ignored and all clients use a shared conservative fallback key.

## Failure policy

Redis failure is fail-closed with `503` and `Retry-After: 30` for production
`auth` and `strict` routes. General and read-only data routes fail open so an
observability outage does not take down authenticated reads; their route-level
authorization remains active. Operate production with Redis available and
alert on `RATE_LIMIT_UNAVAILABLE` server logs.

Quota failures return `429` with `Retry-After`, `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, and `X-RateLimit-Reset`. Successful limited requests
receive the three `X-RateLimit-*` headers. `src/lib/fetch-with-retry.ts` can be
used by browser clients for bounded retry behavior.

## Administration

`GET /api/admin/rate-limit` returns recent blocks, blacklist entries, and audit
history. `POST /api/admin/rate-limit` accepts JSON such as
`{"action":"add","ip":"203.0.113.10"}`. Both require a signed-in email in
`ADMIN_EMAILS`; POST is a cookie-authenticated mutation and should only be sent
from the canonical application origin.
