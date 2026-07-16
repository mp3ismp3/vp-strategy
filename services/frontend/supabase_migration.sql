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
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT,
    subscription_status TEXT DEFAULT 'inactive',
    trial_start TIMESTAMPTZ,
    trial_end TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,

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
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
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
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 用戶讀自己
CREATE POLICY "Users can read own data" ON public.users
    FOR SELECT USING (auth.uid() = id);

-- 用戶更新自己
CREATE POLICY "Users can update own data" ON public.users
    FOR UPDATE USING (auth.uid() = id);

-- Service role 可以做任何事（預設行為，不需額外 policy）

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
GRANT ALL ON public.telegram_bind_tokens TO service_role;
GRANT ALL ON public.scan_results TO service_role;
