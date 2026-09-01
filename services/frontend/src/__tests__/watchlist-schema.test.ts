import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase_watchlist.sql"), "utf8");
const baseMigration = readFileSync(join(process.cwd(), "supabase_migration.sql"), "utf8");

describe("watchlist database boundary", () => {
  it("keeps one canonical watchlist migration", () => {
    expect(baseMigration).not.toContain("CREATE TABLE IF NOT EXISTS public.user_watchlist_items");
    expect(baseMigration).not.toContain("CREATE OR REPLACE FUNCTION public.add_watchlist_item");
  });

  it("applies the schema atomically", () => {
    expect(migration.trimStart().startsWith("-- Personal watchlist")).toBe(true);
    expect(migration).toMatch(/\nBEGIN;\n/);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("stores per-user ticker rows with a uniqueness constraint", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.user_watchlist_items");
    expect(migration).toContain("UNIQUE (user_id, ticker)");
    expect(migration).toContain("ADD CONSTRAINT user_watchlist_items_unique_ticker");
    expect(migration).toContain("ON DELETE CASCADE");
    expect(migration).toContain("ticker ~ '^[A-Z][A-Z0-9.-]{0,14}$'");
    expect(migration).toContain("CHECK (sort_order >= 0)");
  });

  it("enforces one stable order per user with deferred validation", () => {
    expect(migration).toContain("UNIQUE (user_id, sort_order)");
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration).toContain("ROW_NUMBER() OVER (PARTITION BY user_id");
  });

  it("locks and validates draft rows before normalizing an existing project", () => {
    expect(migration).toContain("LOCK TABLE public.user_watchlist_items IN ACCESS EXCLUSIVE MODE");
    expect(migration).toContain("duplicate tickers after normalization");
    expect(migration).toContain("invalid ticker values");
    expect(migration).toContain("SET ticker = UPPER(BTRIM(ticker))");
  });

  it("keeps browser roles away from watchlist data", () => {
    expect(migration).toContain("ALTER TABLE public.user_watchlist_items ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON public.user_watchlist_items FROM anon, authenticated");
    expect(migration).toContain("GRANT ALL ON public.user_watchlist_items TO service_role");
  });

  it("provides an atomic limit-enforcing insert function", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.add_watchlist_item");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("item_limit > 100");
  });

  it("keeps updated_at accurate for future item updates", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.set_watchlist_updated_at");
    expect(migration).toContain("CREATE TRIGGER set_user_watchlist_items_updated_at");
  });
});
