-- Personal watchlist canonical migration for new and existing Supabase projects.
-- Run after supabase_migration.sql when provisioning a new environment.

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_watchlist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent an earlier draft writer from racing normalization or constraint
-- replacement while this transaction upgrades an existing project.
LOCK TABLE public.user_watchlist_items IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.user_watchlist_items
    DROP CONSTRAINT IF EXISTS user_watchlist_items_ticker_check,
    DROP CONSTRAINT IF EXISTS user_watchlist_items_sort_order_check,
    DROP CONSTRAINT IF EXISTS user_watchlist_items_ticker_format_check,
    DROP CONSTRAINT IF EXISTS user_watchlist_items_sort_nonnegative_check,
    DROP CONSTRAINT IF EXISTS user_watchlist_items_user_id_ticker_key,
    DROP CONSTRAINT IF EXISTS user_watchlist_items_unique_ticker,
    DROP CONSTRAINT IF EXISTS user_watchlist_items_unique_order;

-- Normalize harmless casing/whitespace deterministically, but fail with an
-- actionable message instead of silently deleting invalid or duplicate rows.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.user_watchlist_items
        WHERE UPPER(BTRIM(ticker)) !~ '^[A-Z][A-Z0-9.-]{0,14}$'
    ) THEN
        RAISE EXCEPTION 'watchlist migration blocked: invalid ticker values';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.user_watchlist_items
        GROUP BY user_id, UPPER(BTRIM(ticker))
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'watchlist migration blocked: duplicate tickers after normalization';
    END IF;
END;
$$;

UPDATE public.user_watchlist_items
SET ticker = UPPER(BTRIM(ticker))
WHERE ticker IS DISTINCT FROM UPPER(BTRIM(ticker));

-- Re-ranking closes order gaps and removes duplicate positions before the
-- deferred uniqueness constraint lands.
WITH ranked_items AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY sort_order, created_at, id) - 1 AS normalized_order
    FROM public.user_watchlist_items
)
UPDATE public.user_watchlist_items AS item
SET sort_order = ranked_items.normalized_order
FROM ranked_items
WHERE item.id = ranked_items.id;

ALTER TABLE public.user_watchlist_items
    ADD CONSTRAINT user_watchlist_items_ticker_format_check
        CHECK (ticker = UPPER(BTRIM(ticker)) AND ticker ~ '^[A-Z][A-Z0-9.-]{0,14}$'),
    ADD CONSTRAINT user_watchlist_items_sort_nonnegative_check
        CHECK (sort_order >= 0),
    ADD CONSTRAINT user_watchlist_items_unique_ticker
        UNIQUE (user_id, ticker),
    ADD CONSTRAINT user_watchlist_items_unique_order
        UNIQUE (user_id, sort_order) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.user_watchlist_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_watchlist_items FROM anon, authenticated;
GRANT ALL ON public.user_watchlist_items TO service_role;

-- The unique order constraint already supplies the ordered user index.
DROP INDEX IF EXISTS public.idx_user_watchlist_items_order;

CREATE OR REPLACE FUNCTION public.set_watchlist_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_user_watchlist_items_updated_at ON public.user_watchlist_items;
CREATE TRIGGER set_user_watchlist_items_updated_at
BEFORE UPDATE ON public.user_watchlist_items
FOR EACH ROW EXECUTE FUNCTION public.set_watchlist_updated_at();

CREATE OR REPLACE FUNCTION public.add_watchlist_item(
    target_user_id UUID,
    target_ticker TEXT,
    item_limit INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    next_order INTEGER;
BEGIN
    IF item_limit IS NULL OR item_limit < 1 OR item_limit > 100
       OR target_ticker IS NULL
       OR target_ticker <> UPPER(BTRIM(target_ticker))
       OR target_ticker !~ '^[A-Z][A-Z0-9.-]{0,14}$' THEN
        RAISE EXCEPTION 'invalid watchlist input';
    END IF;

    PERFORM 1 FROM public.users WHERE id = target_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'user not found'; END IF;

    IF EXISTS (
        SELECT 1 FROM public.user_watchlist_items
        WHERE user_id = target_user_id AND ticker = target_ticker
    ) THEN
        RETURN jsonb_build_object('status', 'exists', 'ticker', target_ticker);
    END IF;

    IF (SELECT COUNT(*) FROM public.user_watchlist_items WHERE user_id = target_user_id) >= item_limit THEN
        RETURN jsonb_build_object('status', 'limit_reached');
    END IF;

    SELECT COALESCE(MAX(sort_order) + 1, 0) INTO next_order
    FROM public.user_watchlist_items WHERE user_id = target_user_id;
    INSERT INTO public.user_watchlist_items(user_id, ticker, sort_order)
    VALUES (target_user_id, target_ticker, next_order);
    RETURN jsonb_build_object('status', 'created', 'ticker', target_ticker, 'sort_order', next_order);
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_watchlist_items(
    target_user_id UUID,
    ordered_tickers TEXT[]
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    current_count INTEGER;
    ticker_value TEXT;
    ticker_index INTEGER;
BEGIN
    IF ordered_tickers IS NULL OR COALESCE(array_length(ordered_tickers, 1), 0) > 100 THEN
        RETURN FALSE;
    END IF;

    PERFORM 1 FROM public.users WHERE id = target_user_id FOR UPDATE;
    IF NOT FOUND THEN RETURN FALSE; END IF;
    SELECT COUNT(*) INTO current_count FROM public.user_watchlist_items WHERE user_id = target_user_id;
    IF current_count <> COALESCE(array_length(ordered_tickers, 1), 0)
       OR current_count <> (SELECT COUNT(DISTINCT value) FROM unnest(ordered_tickers) AS value)
       OR EXISTS (
           SELECT 1 FROM unnest(ordered_tickers) AS value
           WHERE value <> UPPER(BTRIM(value))
              OR value !~ '^[A-Z][A-Z0-9.-]{0,14}$'
              OR NOT EXISTS (
                  SELECT 1 FROM public.user_watchlist_items
                  WHERE user_id = target_user_id AND ticker = value
              )
       ) THEN
        RETURN FALSE;
    END IF;
    FOR ticker_index IN 1..COALESCE(array_length(ordered_tickers, 1), 0) LOOP
        ticker_value := ordered_tickers[ticker_index];
        UPDATE public.user_watchlist_items
        SET sort_order = ticker_index - 1
        WHERE user_id = target_user_id AND ticker = ticker_value;
    END LOOP;
    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.set_watchlist_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_watchlist_item(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_watchlist_item(UUID, TEXT, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.reorder_watchlist_items(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_watchlist_items(UUID, TEXT[]) TO service_role;

COMMIT;
