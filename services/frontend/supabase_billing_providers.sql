-- Provider-neutral billing migration for existing deployments.
-- Keeps legacy Stripe columns/tables for rollback, and backfills them below.

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS stripe_mode TEXT CHECK (stripe_mode IN ('test', 'live')),
    ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS last_billing_event_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS entitlement_provider TEXT,
    ADD COLUMN IF NOT EXISTS entitlement_subscription_id UUID;

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

CREATE TABLE IF NOT EXISTS public.billing_cancel_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id),
    subscription_id UUID NOT NULL REFERENCES public.billing_subscriptions(id),
    provider TEXT NOT NULL,
    provider_order_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'provider_succeeded', 'completed', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    provider_result JSONB NOT NULL DEFAULT '{}'::JSONB,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.billing_checkout_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id),
    provider TEXT NOT NULL,
    plan TEXT NOT NULL CHECK (plan IN ('pro', 'premium')),
    status TEXT NOT NULL DEFAULT 'reserved'
        CHECK (status IN ('reserved', 'session_created', 'completed', 'expired')),
    external_reference TEXT,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 minutes',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_checkout_one_open_per_user
    ON public.billing_checkout_intents(user_id)
    WHERE status IN ('reserved', 'session_created');

-- Safe follow-up when an earlier version of this migration was already run.
ALTER TABLE public.billing_customers
    DROP CONSTRAINT IF EXISTS billing_customers_user_id_provider_mode_key;
ALTER TABLE public.billing_subscriptions
    ADD COLUMN IF NOT EXISTS last_provider_event_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_billing_customers_user ON public.billing_customers(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_user ON public.billing_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_status ON public.billing_subscriptions(provider, status);
CREATE INDEX IF NOT EXISTS idx_billing_events_status ON public.billing_events(provider, processing_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_subscriptions_one_open_ecpay_per_user
    ON public.billing_subscriptions(user_id)
    WHERE provider = 'ecpay'
      AND status IN ('pending', 'active', 'past_due', 'canceling');

-- Billing data is server-only. No anon/authenticated policies are created;
-- service_role bypasses RLS and remains the only application access path.
ALTER TABLE public.billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_cancel_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_checkout_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_bind_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.billing_customers TO service_role;
GRANT ALL ON public.billing_subscriptions TO service_role;
GRANT ALL ON public.billing_events TO service_role;
GRANT ALL ON public.billing_cancel_outbox TO service_role;
GRANT ALL ON public.billing_checkout_intents TO service_role;
GRANT ALL ON public.users TO service_role;
GRANT ALL ON public.telegram_bind_tokens TO service_role;
GRANT ALL ON public.subscription_events TO service_role;

REVOKE ALL ON public.users FROM anon, authenticated;
REVOKE ALL ON public.telegram_bind_tokens FROM anon, authenticated;
REVOKE ALL ON public.subscription_events FROM anon, authenticated;
REVOKE ALL ON public.billing_customers FROM anon, authenticated;
REVOKE ALL ON public.billing_subscriptions FROM anon, authenticated;
REVOKE ALL ON public.billing_events FROM anon, authenticated;
REVOKE ALL ON public.billing_cancel_outbox FROM anon, authenticated;
REVOKE ALL ON public.billing_checkout_intents FROM anon, authenticated;

-- Remove any legacy policies before relying on service-role-only access.
DO $$
DECLARE policy_record RECORD;
BEGIN
    FOR policy_record IN
        SELECT schemaname, tablename, policyname FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('users', 'telegram_bind_tokens', 'subscription_events',
                            'billing_customers', 'billing_subscriptions',
                            'billing_events', 'billing_cancel_outbox',
                            'billing_checkout_intents')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
            policy_record.policyname, policy_record.schemaname, policy_record.tablename);
    END LOOP;
END;
$$;

-- Existing deployments previously exposed analysis tables to anon clients.
-- All production data now flows through Next.js entitlement APIs.
DROP POLICY IF EXISTS "Anyone can read scan results" ON public.scan_results;
DROP POLICY IF EXISTS "Anyone can read scan_data" ON public.scan_data;
DROP POLICY IF EXISTS "Anyone can read chart_data" ON public.chart_data;
DROP POLICY IF EXISTS "Anyone can read accum_data" ON public.accum_data;
REVOKE ALL ON public.scan_results FROM anon, authenticated;
REVOKE ALL ON public.scan_data FROM anon, authenticated;
REVOKE ALL ON public.chart_data FROM anon, authenticated;
REVOKE ALL ON public.accum_data FROM anon, authenticated;

DROP FUNCTION IF EXISTS public.mark_ecpay_subscription_canceling(UUID, UUID);

-- billing_subscriptions is authoritative. Recompute the best still-valid
-- entitlement so a delayed event from one provider cannot revoke another.
CREATE OR REPLACE FUNCTION public.refresh_user_entitlement(target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    chosen public.billing_subscriptions%ROWTYPE;
BEGIN
    SELECT * INTO chosen
    FROM public.billing_subscriptions
    WHERE user_id = target_user_id
      AND status IN ('active', 'trialing', 'canceling')
      AND current_period_end > NOW()
    ORDER BY CASE plan WHEN 'premium' THEN 2 ELSE 1 END DESC,
             current_period_end DESC,
             updated_at DESC
    LIMIT 1;

    IF chosen.id IS NULL THEN
        UPDATE public.users
        SET plan = 'free', subscription_status = 'inactive',
            current_period_end = NULL, cancel_at_period_end = FALSE,
            entitlement_provider = NULL, entitlement_subscription_id = NULL,
            updated_at = NOW()
        WHERE id = target_user_id;
    ELSE
        UPDATE public.users
        SET plan = chosen.plan,
            subscription_status = CASE WHEN chosen.status = 'trialing' THEN 'trialing' ELSE 'active' END,
            current_period_end = chosen.current_period_end,
            cancel_at_period_end = chosen.cancel_at_period_end OR chosen.status = 'canceling',
            entitlement_provider = chosen.provider,
            entitlement_subscription_id = chosen.id,
            updated_at = NOW()
        WHERE id = target_user_id;
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_user_entitlement(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_user_entitlement(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_billing_checkout(
    target_user_id UUID, target_provider TEXT, target_plan TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE existing_intent public.billing_checkout_intents%ROWTYPE; reserved_id UUID;
BEGIN
    PERFORM 1 FROM public.users WHERE id = target_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Billing user not found'; END IF;
    IF target_provider NOT IN ('stripe', 'ecpay') OR target_plan NOT IN ('pro', 'premium') THEN
        RAISE EXCEPTION 'Invalid checkout reservation';
    END IF;
    UPDATE public.billing_checkout_intents SET status = 'expired', updated_at = NOW()
    WHERE user_id = target_user_id AND status IN ('reserved', 'session_created') AND expires_at <= NOW();
    UPDATE public.billing_subscriptions SET status = 'canceled', updated_at = NOW()
    WHERE user_id = target_user_id AND provider = 'ecpay' AND status = 'pending'
      AND created_at <= NOW() - INTERVAL '30 minutes';
    SELECT * INTO existing_intent FROM public.billing_checkout_intents
    WHERE user_id = target_user_id AND status IN ('reserved', 'session_created')
    ORDER BY created_at DESC LIMIT 1;
    IF existing_intent.id IS NOT NULL THEN
        IF existing_intent.provider = target_provider AND existing_intent.plan = target_plan THEN
            RETURN existing_intent.id;
        END IF;
        RAISE EXCEPTION 'Another checkout is already reserved';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.billing_subscriptions
        WHERE user_id = target_user_id AND (
            status IN ('pending', 'past_due') OR
            (status IN ('active', 'trialing', 'canceling') AND
             (current_period_end IS NULL OR current_period_end > NOW()))
        )
    ) THEN RAISE EXCEPTION 'An existing billing subscription must be resolved first'; END IF;
    INSERT INTO public.billing_checkout_intents(user_id, provider, plan)
    VALUES (target_user_id, target_provider, target_plan) RETURNING id INTO reserved_id;
    RETURN reserved_id;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_billing_checkout(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_billing_checkout(UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.attach_billing_checkout(
    target_intent_id UUID, target_user_id UUID, target_external_reference TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE changed_rows INTEGER;
BEGIN
    UPDATE public.billing_checkout_intents SET status = 'session_created',
        external_reference = target_external_reference, updated_at = NOW()
    WHERE id = target_intent_id AND user_id = target_user_id
      AND status IN ('reserved', 'session_created') AND expires_at > NOW();
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    RETURN changed_rows = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.attach_billing_checkout(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attach_billing_checkout(UUID, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.release_billing_checkout(target_intent_id UUID, target_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    UPDATE public.billing_checkout_intents SET status = 'expired', updated_at = NOW()
    WHERE id = target_intent_id AND user_id = target_user_id AND status = 'reserved';
END;
$$;
REVOKE ALL ON FUNCTION public.release_billing_checkout(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_billing_checkout(UUID, UUID) TO service_role;

-- Apply an already verified ECPay callback in one database transaction.
CREATE OR REPLACE FUNCTION public.apply_ecpay_callback(
    callback_event_id TEXT,
    callback_order_id TEXT,
    callback_trade_no TEXT,
    callback_success BOOLEAN,
    callback_simulated BOOLEAN,
    callback_amount INTEGER,
    callback_event_at TIMESTAMPTZ,
    callback_period_end TIMESTAMPTZ,
    callback_success_times INTEGER,
    callback_payload JSONB DEFAULT '{}'::JSONB
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    target_subscription public.billing_subscriptions%ROWTYPE;
    existing_status TEXT;
BEGIN
    SELECT * INTO target_subscription
    FROM public.billing_subscriptions
    WHERE provider = 'ecpay' AND provider_order_id = callback_order_id
    FOR UPDATE;
    IF target_subscription.id IS NULL THEN RAISE EXCEPTION 'ECPay order not found'; END IF;
    IF target_subscription.status IN ('canceling', 'canceled') THEN
        RAISE EXCEPTION 'ECPay subscription is no longer payable';
    END IF;
    IF callback_amount IS DISTINCT FROM target_subscription.amount THEN
        RAISE EXCEPTION 'ECPay callback amount mismatch';
    END IF;

    INSERT INTO public.billing_events (
        user_id, provider, provider_event_id, event_type, processing_status,
        processing_started_at, payload
    ) VALUES (
        target_subscription.user_id, 'ecpay', callback_event_id,
        'ecpay.authorization', 'processing', NOW(), callback_payload
    ) ON CONFLICT (provider, provider_event_id) DO NOTHING;

    SELECT processing_status INTO existing_status
    FROM public.billing_events
    WHERE provider = 'ecpay' AND provider_event_id = callback_event_id
    FOR UPDATE;
    IF existing_status = 'processed' THEN RETURN 'duplicate'; END IF;
    IF callback_simulated THEN
        UPDATE public.billing_events SET processing_status = 'processed', processed_at = NOW()
        WHERE provider = 'ecpay' AND provider_event_id = callback_event_id;
        RETURN 'simulated';
    END IF;
    IF target_subscription.last_provider_event_at > callback_event_at THEN
        UPDATE public.billing_events SET processing_status = 'processed', processed_at = NOW()
        WHERE provider = 'ecpay' AND provider_event_id = callback_event_id;
        RETURN 'stale';
    END IF;

    UPDATE public.billing_subscriptions
    SET provider_subscription_id = COALESCE(callback_trade_no, provider_subscription_id),
        status = CASE WHEN callback_success THEN 'active' ELSE 'past_due' END,
        current_period_end = CASE WHEN callback_success THEN callback_period_end ELSE current_period_end END,
        last_provider_event_at = callback_event_at,
        metadata = metadata || jsonb_build_object('totalSuccessTimes', callback_success_times),
        updated_at = NOW()
    WHERE id = target_subscription.id;
    IF callback_success THEN
        UPDATE public.billing_checkout_intents SET status = 'completed', updated_at = NOW()
        WHERE user_id = target_subscription.user_id AND provider = 'ecpay'
          AND status IN ('reserved', 'session_created');
    END IF;
    PERFORM public.refresh_user_entitlement(target_subscription.user_id);
    UPDATE public.billing_events
    SET processing_status = 'processed', processed_at = NOW(), last_error = NULL
    WHERE provider = 'ecpay' AND provider_event_id = callback_event_id;
    RETURN 'processed';
END;
$$;
REVOKE ALL ON FUNCTION public.apply_ecpay_callback(TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_ecpay_callback(TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, JSONB) TO service_role;

DROP FUNCTION IF EXISTS public.sync_stripe_subscription(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.sync_stripe_subscription(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);
CREATE OR REPLACE FUNCTION public.sync_stripe_subscription(
    target_user_id UUID, stripe_customer TEXT, stripe_subscription TEXT,
    stripe_plan TEXT, stripe_amount INTEGER, stripe_currency TEXT,
    stripe_interval TEXT, stripe_status TEXT, stripe_period_end TIMESTAMPTZ,
    stripe_cancel_at_period_end BOOLEAN, stripe_price_id TEXT,
    stripe_trial_start TIMESTAMPTZ, stripe_trial_end TIMESTAMPTZ, stripe_mode_value TEXT,
    stripe_event_id TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE saved_id UUID;
BEGIN
    INSERT INTO public.billing_subscriptions (
        user_id, provider, provider_customer_id, provider_subscription_id,
        plan, amount, currency, billing_interval, status, current_period_end,
        cancel_at_period_end, metadata, updated_at
    ) VALUES (
        target_user_id, 'stripe', stripe_customer, stripe_subscription,
        stripe_plan, stripe_amount, stripe_currency, stripe_interval, stripe_status,
        stripe_period_end, stripe_cancel_at_period_end,
        jsonb_build_object('priceId', stripe_price_id), NOW()
    ) ON CONFLICT (provider, provider_subscription_id) DO UPDATE SET
        plan = EXCLUDED.plan, amount = EXCLUDED.amount, currency = EXCLUDED.currency,
        billing_interval = EXCLUDED.billing_interval, status = EXCLUDED.status,
        current_period_end = EXCLUDED.current_period_end,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        metadata = EXCLUDED.metadata, updated_at = NOW()
    RETURNING id INTO saved_id;
    UPDATE public.users SET
        stripe_customer_id = stripe_customer,
        stripe_subscription_id = stripe_subscription,
        stripe_mode = stripe_mode_value,
        trial_start = stripe_trial_start,
        trial_end = stripe_trial_end,
        trial_used_at = COALESCE(trial_used_at, stripe_trial_start),
        stripe_checkout_session_id = NULL,
        stripe_checkout_expires_at = NULL,
        updated_at = NOW()
    WHERE id = target_user_id;
    UPDATE public.billing_checkout_intents SET status = 'completed', updated_at = NOW()
    WHERE user_id = target_user_id AND provider = 'stripe'
      AND status IN ('reserved', 'session_created');
    PERFORM public.refresh_user_entitlement(target_user_id);
    IF stripe_event_id IS NOT NULL THEN
        UPDATE public.billing_events SET processing_status = 'processed',
            processed_at = NOW(), last_error = NULL
        WHERE provider = 'stripe' AND provider_event_id = stripe_event_id;
    END IF;
    RETURN saved_id;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_stripe_subscription(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_stripe_subscription(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) TO service_role;

DROP FUNCTION IF EXISTS public.cancel_stripe_subscription(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.cancel_stripe_subscription(
    target_user_id UUID, stripe_subscription TEXT, stripe_event_id TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    UPDATE public.billing_subscriptions
    SET status = 'canceled', current_period_end = NULL, updated_at = NOW()
    WHERE user_id = target_user_id AND provider = 'stripe'
      AND provider_subscription_id = stripe_subscription;
    UPDATE public.users SET
        stripe_subscription_id = CASE WHEN stripe_subscription_id = stripe_subscription THEN NULL ELSE stripe_subscription_id END,
        stripe_checkout_session_id = NULL, stripe_checkout_expires_at = NULL,
        updated_at = NOW()
    WHERE id = target_user_id;
    PERFORM public.refresh_user_entitlement(target_user_id);
    UPDATE public.billing_events SET processing_status = 'processed',
        processed_at = NOW(), last_error = NULL
    WHERE provider = 'stripe' AND provider_event_id = stripe_event_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_stripe_subscription(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_stripe_subscription(UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_all_stripe_subscriptions(target_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    UPDATE public.billing_subscriptions SET status = 'canceled', current_period_end = NULL, updated_at = NOW()
    WHERE user_id = target_user_id AND provider = 'stripe'
      AND status NOT IN ('canceled', 'incomplete_expired');
    UPDATE public.users SET stripe_subscription_id = NULL,
        stripe_checkout_session_id = NULL, stripe_checkout_expires_at = NULL,
        updated_at = NOW() WHERE id = target_user_id;
    PERFORM public.refresh_user_entitlement(target_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_all_stripe_subscriptions(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_all_stripe_subscriptions(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.create_ecpay_cancel_intent(
    target_user_id UUID, target_subscription_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE order_id TEXT; intent_id UUID;
BEGIN
    SELECT provider_order_id INTO order_id FROM public.billing_subscriptions
    WHERE id = target_subscription_id AND user_id = target_user_id
      AND provider = 'ecpay' AND status IN ('active', 'past_due', 'canceling') FOR UPDATE;
    IF order_id IS NULL THEN RAISE EXCEPTION 'Cancelable ECPay subscription not found'; END IF;
    INSERT INTO public.billing_cancel_outbox (
        user_id, subscription_id, provider, provider_order_id, idempotency_key
    ) VALUES (
        target_user_id, target_subscription_id, 'ecpay', order_id,
        'ecpay:cancel:' || target_subscription_id::TEXT
    ) ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = NOW()
    RETURNING id INTO intent_id;
    RETURN intent_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_ecpay_cancel_intent(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_ecpay_cancel_intent(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_ecpay_cancel_intent(target_intent_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE changed_rows INTEGER;
BEGIN
    UPDATE public.billing_cancel_outbox SET status = 'processing', updated_at = NOW()
    WHERE id = target_intent_id AND (
        (status IN ('pending', 'failed', 'provider_succeeded') AND next_attempt_at <= NOW()) OR
        (status = 'processing' AND updated_at <= NOW() - INTERVAL '5 minutes')
    );
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    RETURN changed_rows = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_ecpay_cancel_intent(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ecpay_cancel_intent(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_ecpay_cancel_intent(
    target_intent_id UUID, result_summary JSONB DEFAULT '{}'::JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE intent public.billing_cancel_outbox%ROWTYPE;
BEGIN
    SELECT * INTO intent FROM public.billing_cancel_outbox
    WHERE id = target_intent_id AND status IN ('processing', 'provider_succeeded') FOR UPDATE;
    IF intent.id IS NULL THEN RETURN FALSE; END IF;
    UPDATE public.billing_subscriptions
    SET status = 'canceling', cancel_at_period_end = TRUE, updated_at = NOW()
    WHERE id = intent.subscription_id AND user_id = intent.user_id;
    UPDATE public.billing_cancel_outbox
    SET status = 'completed', provider_result = result_summary, attempts = attempts + 1,
        completed_at = NOW(), updated_at = NOW(), last_error = NULL
    WHERE id = intent.id;
    PERFORM public.refresh_user_entitlement(intent.user_id);
    RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_ecpay_cancel_intent(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_ecpay_cancel_intent(UUID, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_ecpay_cancel_intent(target_intent_id UUID, error_message TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    UPDATE public.billing_cancel_outbox
    SET status = 'failed', attempts = attempts + 1, last_error = LEFT(error_message, 500),
        next_attempt_at = NOW() + (LEAST(attempts + 1, 12) * INTERVAL '5 minutes'), updated_at = NOW()
    WHERE id = target_intent_id AND status = 'processing';
END;
$$;
REVOKE ALL ON FUNCTION public.fail_ecpay_cancel_intent(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fail_ecpay_cancel_intent(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_telegram_bind_token(
    bind_token TEXT, target_telegram_user_id BIGINT, target_telegram_username TEXT
) RETURNS TABLE(email TEXT, plan TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE token_email TEXT; selected_plan TEXT;
BEGIN
    DELETE FROM public.telegram_bind_tokens
    WHERE token = bind_token AND expires_at > NOW()
    RETURNING telegram_bind_tokens.email INTO token_email;
    IF token_email IS NULL THEN RETURN; END IF;
    SELECT users.plan INTO selected_plan FROM public.users
    WHERE users.email = token_email AND users.plan = 'premium'
      AND users.subscription_status IN ('active', 'trialing')
      AND users.current_period_end > NOW() FOR UPDATE;
    IF selected_plan IS NULL THEN RAISE EXCEPTION 'Premium subscription required'; END IF;
    UPDATE public.users SET telegram_user_id = target_telegram_user_id,
        telegram_username = target_telegram_username, updated_at = NOW()
    WHERE users.email = token_email;
    RETURN QUERY SELECT token_email, selected_plan;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_telegram_bind_token(TEXT, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_telegram_bind_token(TEXT, BIGINT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.purge_expired_billing_events(retention_days INTEGER DEFAULT 90)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE removed BIGINT;
BEGIN
    IF retention_days < 30 THEN RAISE EXCEPTION 'Billing event retention must be at least 30 days'; END IF;
    DELETE FROM public.billing_events
    WHERE created_at < NOW() - make_interval(days => retention_days)
      AND processing_status = 'processed';
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_expired_billing_events(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_billing_events(INTEGER) TO service_role;

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
