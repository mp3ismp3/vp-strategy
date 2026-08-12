# VP Strategy Frontend

Next.js 16 web application and backend-for-frontend for VP Strategy. It reads
production analysis rows from Supabase with a server-only service role, applies
session and subscription entitlement checks, and exposes payment and Telegram
integration routes.

The `/api` routes are not a public machine-to-machine market-data API. They use
browser sessions or provider-specific callback authentication. Start with
[`../../docs/API.md`](../../docs/API.md) and [`openapi.yaml`](openapi.yaml).

## Requirements

- Node.js version supported by the checked-in Next.js release
- npm and `package-lock.json`
- A Supabase project with the repository migrations applied
- Upstash Redis for production request limiting
- Google OAuth and/or Supabase email credentials for login
- Optional Stripe, ECPay, and Telegram test credentials

## Local setup

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Fill the required authentication, Supabase, and Upstash values in `.env.local`.
Use only test/sandbox payment credentials. Both Checkout feature flags are
disabled by default and must remain disabled until the matching migration and
provider validation guides are complete.

Open `http://localhost:3000` and sign in through `/login`. Verify liveness with:

```bash
curl --fail-with-body http://localhost:3000/api/health
```

Data routes require the browser's NextAuth session. The project intentionally
does not document copying session cookies into scripts as an API-key substitute.

## Database setup

For a new Supabase project, apply `supabase_migration.sql`, followed by the
latest `supabase_billing_providers.sql`. Existing projects must review and apply
the incremental migrations described in the root deployment and billing docs.
Analysis and billing tables deny `anon` and `authenticated`; only server-side
service-role code may access them.

## Production gateway

Set `NEXT_PUBLIC_APP_URL` and `NEXTAUTH_URL` to the same single HTTPS origin.
Set `TRUSTED_PROXY_MODE=vercel` on Vercel. Self-hosted reverse proxies may use
`x-forwarded-for` only when they overwrite untrusted incoming forwarding
headers. See [`docs/rate-limiting.md`](docs/rate-limiting.md).

The app sends CSP, HSTS, nosniff, referrer, and permissions headers. Payment and
webhook routes retain route-level signature/MAC, body-size, Origin, entitlement,
and idempotency checks; the gateway is defense in depth, not authorization.

## Checks

```bash
npm test
npm run lint
npm run build
```

Tests must mock Supabase, Upstash, payment providers, and Telegram. Do not send
live notifications, create real payments, or replay production callbacks.

Security reports follow [`../../SECURITY.md`](../../SECURITY.md). Contributions
follow [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md).
