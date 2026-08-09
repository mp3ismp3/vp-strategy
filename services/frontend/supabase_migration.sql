-- VP Strategy — Supabase Schema Migration
-- 在 Supabase Dashboard → SQL Editor 執行此文件

-- ============================================
-- 1. Users 表
-- ============================================
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    auth_provider TEXT DEFAULT 'email',

    -- 訂閱狀態
    plan TEXT DEFAULT 'free',
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT,
    stripe_mode TEXT CHECK (stripe_mode IN ('test', 'live')),
    stripe_checkout_session_id TEXT,
    stripe_checkout_expires_at TIMESTAMPTZ,
    subscription_status TEXT DEFAULT 'inactive',
    trial_start TIMESTAMPTZ,
    trial_end TIMESTAMPTZ,
    trial_used_at TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    last_billing_event_at TIMESTAMPTZ,

    -- Telegram 綁定
    telegram_user_id BIGINT UNIQUE,
    telegram_username TEXT,

    -- 時間戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. Subscription Events 表（審計用）
-- ============================================
CREATE TABLE IF NOT EXISTS public.subscription_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id),
    event_type TEXT NOT NULL,
    stripe_event_id TEXT UNIQUE,
    processing_status TEXT NOT NULL DEFAULT 'processed'
        CHECK (processing_status IN ('processing', 'processed', 'failed')),
    processing_started_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    last_error TEXT,
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Existing deployments: add production billing safety fields without replacing data.
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS stripe_mode TEXT CHECK (stripe_mode IN ('test', 'live')),
    ADD COLUMN IF NOT EXISTS trial_used_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT,
    ADD COLUMN IF NOT EXISTS stripe_checkout_expires_at TIMESTAMPTZ,
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
    processing_status TEXT NOT NULL DEFAULT 'processing' CHECK (processing_status IN ('processing', 'processed', 'failed')),
    processing_started_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    last_error TEXT,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_event_id)
);

-- ============================================
-- 3. Telegram Bind Tokens 表
-- ============================================
CREATE TABLE IF NOT EXISTS public.telegram_bind_tokens (
    email TEXT PRIMARY KEY REFERENCES public.users(email),
    token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

-- ============================================
-- 4. Scan Results 表（CI 上傳用）
-- ============================================
CREATE TABLE IF NOT EXISTS public.scan_results (
    id TEXT PRIMARY KEY DEFAULT 'latest',
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 5. RLS Policies
-- ============================================
-- Users 表：關閉 RLS（service_role 需要直接讀寫，app 層控制存取）
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
-- Billing tables are server-only; no anon/authenticated policies are created.
-- service_role bypasses RLS for webhook, checkout, portal, and reconciliation.
ALTER TABLE public.billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

-- scan_results 公開讀（付費牆在 app 層控制）
ALTER TABLE public.scan_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read scan results" ON public.scan_results
    FOR SELECT USING (true);

-- ============================================
-- 6. Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON public.users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_telegram ON public.users(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_events_user ON public.subscription_events(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_events_status ON public.subscription_events(processing_status);
CREATE INDEX IF NOT EXISTS idx_billing_customers_user ON public.billing_customers(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_user ON public.billing_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_status ON public.billing_subscriptions(provider, status);
CREATE INDEX IF NOT EXISTS idx_billing_events_status ON public.billing_events(provider, processing_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_subscriptions_one_open_ecpay_per_user
    ON public.billing_subscriptions(user_id)
    WHERE provider = 'ecpay'
      AND status IN ('pending', 'active', 'past_due', 'canceling');

-- ============================================
-- 7. Scan Data 表（VP 掃描結果，覆蓋更新）
-- ============================================
CREATE TABLE IF NOT EXISTS public.scan_data (
    id TEXT PRIMARY KEY DEFAULT 'latest',
    vp_data JSONB,
    market_ctx JSONB,
    scan_time TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.scan_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read scan_data" ON public.scan_data
    FOR SELECT USING (true);
GRANT ALL ON public.scan_data TO service_role;

-- ============================================
-- 8. Chart Data 表（K 線 + VP Histogram，每 ticker 一筆）
-- ============================================
CREATE TABLE IF NOT EXISTS public.chart_data (
    ticker TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.chart_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read chart_data" ON public.chart_data
    FOR SELECT USING (true);
GRANT ALL ON public.chart_data TO service_role;

-- ============================================
-- 9. Accumulation Data 表（每 ticker 一筆）
-- ============================================
CREATE TABLE IF NOT EXISTS public.accum_data (
    ticker TEXT PRIMARY KEY,
    state JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.accum_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read accum_data" ON public.accum_data
    FOR SELECT USING (true);
GRANT ALL ON public.accum_data TO service_role;

-- ============================================
-- 10. 補充權限（所有表）
-- ============================================
GRANT ALL ON public.users TO service_role;
GRANT ALL ON public.subscription_events TO service_role;
GRANT ALL ON public.billing_customers TO service_role;
GRANT ALL ON public.billing_subscriptions TO service_role;
GRANT ALL ON public.billing_events TO service_role;
GRANT ALL ON public.telegram_bind_tokens TO service_role;
GRANT ALL ON public.scan_results TO service_role;

-- anon role 公開讀（前端用 anon key 讀取）
GRANT SELECT ON public.scan_data TO anon;
GRANT SELECT ON public.chart_data TO anon;
GRANT SELECT ON public.accum_data TO anon;
