-- Stripe production-readiness incremental migration.
-- Safe to run on an existing VP Strategy Supabase project.

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS stripe_mode TEXT CHECK (stripe_mode IN ('test', 'live')),
    ADD COLUMN IF NOT EXISTS trial_used_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT,
    ADD COLUMN IF NOT EXISTS stripe_checkout_expires_at TIMESTAMPTZ;

ALTER TABLE public.subscription_events
    ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'processed'
        CHECK (processing_status IN ('processing', 'processed', 'failed')),
    ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_subscription_events_status
    ON public.subscription_events(processing_status);
