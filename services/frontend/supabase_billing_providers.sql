-- Provider-neutral billing migration for existing deployments.
-- Keeps legacy Stripe columns/tables for rollback, and backfills them below.

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS stripe_mode TEXT CHECK (stripe_mode IN ('test', 'live')),
    ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS last_billing_event_at TIMESTAMPTZ;

ALTER TABLE public.subscription_events
    ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'processed'
        CHECK (processing_status IN ('processing', 'processed', 'failed')),
    ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE TABLE IF NOT EXISTS public.billing_customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id),
    provider TEXT NOT NULL,
    provider_customer_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_customer_id)
);

CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id),
    provider TEXT NOT NULL,
    provider_customer_id TEXT,
    provider_subscription_id TEXT,
    provider_order_id TEXT,
    plan TEXT NOT NULL CHECK (plan IN ('pro', 'premium')),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    currency TEXT NOT NULL,
    billing_interval TEXT NOT NULL,
    status TEXT NOT NULL,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    last_provider_event_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_subscription_id),
    UNIQUE (provider, provider_order_id)
);

CREATE TABLE IF NOT EXISTS public.billing_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id),
    provider TEXT NOT NULL,
    provider_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    processing_status TEXT NOT NULL DEFAULT 'processing'
        CHECK (processing_status IN ('processing', 'processed', 'failed')),
    processing_started_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    last_error TEXT,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_event_id)
);

-- Safe follow-up when an earlier version of this migration was already run.
ALTER TABLE public.billing_customers
    DROP CONSTRAINT IF EXISTS billing_customers_user_id_provider_mode_key;
ALTER TABLE public.billing_subscriptions
    ADD COLUMN IF NOT EXISTS last_provider_event_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_billing_customers_user ON public.billing_customers(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_user ON public.billing_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_status ON public.billing_subscriptions(provider, status);
CREATE INDEX IF NOT EXISTS idx_billing_events_status ON public.billing_events(provider, processing_status);

-- Billing data is server-only. No anon/authenticated policies are created;
-- service_role bypasses RLS and remains the only application access path.
ALTER TABLE public.billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.billing_customers TO service_role;
GRANT ALL ON public.billing_subscriptions TO service_role;
GRANT ALL ON public.billing_events TO service_role;

-- Backfill legacy Stripe data. These statements are idempotent.
INSERT INTO public.billing_customers (
    user_id, provider, provider_customer_id, mode, metadata
)
SELECT id, 'stripe', stripe_customer_id, stripe_mode,
       jsonb_build_object('source', 'legacy_users_backfill')
FROM public.users
WHERE stripe_customer_id IS NOT NULL AND stripe_mode IS NOT NULL
ON CONFLICT (provider, provider_customer_id) DO NOTHING;

INSERT INTO public.billing_subscriptions (
    user_id, provider, provider_customer_id, provider_subscription_id,
    plan, amount, currency, billing_interval, status,
    current_period_end, cancel_at_period_end, metadata
)
SELECT id, 'stripe', stripe_customer_id, stripe_subscription_id,
       plan, 0, 'USD', 'month', subscription_status,
       current_period_end, cancel_at_period_end,
       jsonb_build_object('source', 'legacy_users_backfill', 'amount_unknown', true)
FROM public.users
WHERE stripe_subscription_id IS NOT NULL AND plan IN ('pro', 'premium')
ON CONFLICT (provider, provider_subscription_id) DO NOTHING;

INSERT INTO public.billing_events (
    user_id, provider, provider_event_id, event_type, processing_status,
    processing_started_at, processed_at, last_error, payload, created_at
)
SELECT user_id, 'stripe', stripe_event_id, event_type, processing_status,
       processing_started_at, processed_at, last_error, payload, created_at
FROM public.subscription_events
WHERE stripe_event_id IS NOT NULL
ON CONFLICT (provider, provider_event_id) DO NOTHING;
