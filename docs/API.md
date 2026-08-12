# Web API and gateway

The Next.js routes under `services/frontend/src/app/api` form a
backend-for-frontend (BFF) for the VP Strategy web application. They are safe
to call from the shipped browser UI and operational providers when configured
as documented. They are **not a general public market-data API**: data routes
currently authenticate with a NextAuth browser session cookie, and the project
does not issue API keys or OAuth client credentials for machine-to-machine
clients.

The machine-readable contract is `services/frontend/openapi.yaml`. It covers
the supported consumer-facing and health routes. Billing, administrator, and
provider callback routes are operational interfaces; their inventory and
security boundary are documented below, but they must not be treated as a
public integration surface.

## Base URL and health

Local development uses `http://localhost:3000`. Production must set one HTTPS
origin in `NEXT_PUBLIC_APP_URL` and `NEXTAUTH_URL`.

```bash
curl --fail-with-body http://localhost:3000/api/health
```

`GET /api/health` is anonymous, returns no dependency or secret details, and
sets `Cache-Control: no-store`.

## Authentication and authorization

- `/api/health`, payment-provider callbacks, and Telegram/Stripe webhooks use
  their route-specific rules and do not use a browser session.
- `/api/data/*` requires a NextAuth session cookie. A `401`
  means no valid session; a `403` means the account lacks the required plan.
- Free accounts receive only the documented preview. Pro receives general
  analysis. Fusion and Telegram binding require Premium.
- Admin routes require a signed-in email listed in `ADMIN_EMAILS`. The ECPay
  reconciliation GET also accepts the dedicated constant-time-checked bearer
  secret used by the scheduled workflow.
- Cookie-authenticated mutations require an exact production `Origin` match
  with `NEXT_PUBLIC_APP_URL`. Billing JSON mutations also require
  `Content-Type: application/json`.

Browser session cookies are intentionally not copied into documentation. For
manual testing, sign in through `/login`, then call the routes from the same
browser origin. Do not publish cookies or use them as long-lived API tokens.

## Consumer routes

| Method | Route | Access | Purpose |
|---|---|---|---|
| GET | `/api/health` | Anonymous | Liveness response |
| GET | `/api/user/plan` | Anonymous-safe | Effective plan snapshot; returns Free/inactive without a session |
| GET | `/api/data/scan-results` | Free+ | Multi-timeframe VP results, server-filtered by plan |
| GET | `/api/data/chart-data?ticker=NVDA` | Free+ | One ticker's chart payload |
| GET | `/api/data/chart-data?include=data` | Free+ | Visible ticker payloads; otherwise summaries |
| GET | `/api/data/accum-state` | Free+ | Accumulation state; action levels removed for Free |
| GET | `/api/data/fusion` | Premium | Fused analysis signals |
| GET | `/api/data/crypto-liquidity` | Session | Stablecoin, market cap and volume liquidity overview |
| POST | `/api/telegram/bind` | Premium session + trusted Origin | Create a 10-minute binding token |

Response bodies are JSON. Data-source outages return `503` and
`Retry-After: 30`; responses and safe server logs share a request ID, while
internal exception messages are not returned or copied into logs.

```json
{
  "error": {
    "code": "DATA_SOURCE_UNAVAILABLE",
    "message": "Scan data is temporarily unavailable",
    "requestId": "5dc2a8dd-c531-4e6f-bde8-8d5155f24128"
  }
}
```

Existing route-specific legacy errors remain simple `{ "error": "..." }`
objects. New shared infrastructure errors use the stable envelope above;
clients should accept both forms until a versioned public API is introduced.

## Operational route inventory

| Routes | Caller and protection |
|---|---|
| `/api/auth/*` | NextAuth browser flow; auth-tier rate limit |
| `/api/stripe/checkout`, `/portal` | Session, trusted Origin, server-side allowlists; Checkout is disabled by default |
| `/api/stripe/webhook` | Stripe signature, 256 KiB body cap, idempotent event ledger |
| `/api/ecpay/checkout`, `/cancel` | Session, trusted Origin; Checkout disabled by default |
| `/api/ecpay/return`, `/period-return`, `/result` | ECPay CheckMacValue and 64 KiB body cap; gateway rate-limit bypass |
| `/api/telegram/webhook` | Telegram secret checked before a 64 KiB body is read |
| `/api/admin/*` | Admin session; reconciliation additionally supports its dedicated scheduler bearer secret |

Never test provider callbacks against live mode. Use provider test/sandbox
credentials and the route-specific tests.

## Gateway behavior

`services/frontend/src/proxy.ts` applies route tiers and page redirects.
Webhook/callback routes bypass Redis rate limiting because their signatures or
provider MACs are validated in the route handler.

| Tier | Anonymous | Signed in | Redis outage in production |
|---|---:|---:|---|
| `api` | 30/min | 60/min | Fail open |
| `data` | 20/min | 40/min | Fail open; route auth remains enforced |
| `auth` | 5/min | 10/min | Fail closed with `503` |
| `strict` | 3/min | 5/min | Fail closed with `503` |

Set `TRUSTED_PROXY_MODE=vercel` on Vercel. For self-hosting, use
`x-forwarded-for` only when the outer reverse proxy removes incoming forwarding
headers and writes the canonical client chain. With no mode configured,
forwarding headers are ignored and clients share a conservative fallback key.

Rate-limited responses return `429`, `Retry-After`, `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, and `X-RateLimit-Reset`. Redis is therefore required
for normal production operation even though read-only routes degrade open.

## Compatibility and versioning

The BFF is currently unversioned and may evolve with the bundled frontend.
Consumers outside this repository should not depend on it as a stable public
API. A future public API must introduce a versioned path, scoped revocable
credentials, audit logging, key rotation, and a separate compatibility policy.

Security issues must be reported through `SECURITY.md`, not a public issue.
