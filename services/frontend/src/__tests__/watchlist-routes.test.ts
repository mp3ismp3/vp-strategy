import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getSupabaseAdmin: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: mocks.getSupabaseAdmin }));

function createSupabase(options?: {
  items?: Array<{ ticker: string; sort_order: number }>;
  rpcResult?: { data: unknown; error: unknown };
}) {
  const userQuery: Record<string, ReturnType<typeof vi.fn>> = {};
  userQuery.select = vi.fn(() => userQuery);
  userQuery.eq = vi.fn(() => userQuery);
  userQuery.single = vi.fn().mockResolvedValue({
    data: {
      id: "user-1",
      plan: "free",
      subscription_status: "inactive",
      current_period_end: null,
      cancel_at_period_end: false,
    },
    error: null,
  });

  const itemQuery: Record<string, ReturnType<typeof vi.fn>> = {};
  itemQuery.select = vi.fn(() => itemQuery);
  itemQuery.eq = vi.fn(() => itemQuery);
  itemQuery.order = vi.fn().mockResolvedValue({ data: options?.items ?? [], error: null });

  const from = vi.fn((table: string) => table === "users" ? userQuery : itemQuery);
  const rpc = vi.fn().mockResolvedValue(options?.rpcResult ?? {
    data: { status: "created", ticker: "NVDA", sort_order: 0 },
    error: null,
  });
  return { from, rpc, userQuery, itemQuery };
}

describe("watchlist routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com");
  });

  it("requires authentication", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/user/watchlist/route");

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it("only queries rows owned by the current user", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { email: "free@example.com" } });
    const supabase = createSupabase({ items: [{ ticker: "NVDA", sort_order: 0 }] });
    mocks.getSupabaseAdmin.mockReturnValue(supabase);
    const { GET } = await import("@/app/api/user/watchlist/route");

    const response = await GET();
    const payload = await response.json();

    expect(supabase.itemQuery.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(payload).toMatchObject({ items: [{ ticker: "NVDA" }], limit: 5, plan: "free" });
  });

  it("rejects a paid-universe ticker for a free user", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { email: "free@example.com" } });
    const supabase = createSupabase();
    mocks.getSupabaseAdmin.mockReturnValue(supabase);
    const { POST } = await import("@/app/api/user/watchlist/route");

    const response = await POST(new NextRequest("https://example.com/api/user/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticker: "AMD" }),
    }));

    expect(response.status).toBe(403);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects a mutation from an untrusted browser origin", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { email: "free@example.com" } });
    const supabase = createSupabase();
    mocks.getSupabaseAdmin.mockReturnValue(supabase);
    const { POST } = await import("@/app/api/user/watchlist/route");

    const response = await POST(new NextRequest("https://example.com/api/user/watchlist", {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: JSON.stringify({ ticker: "NVDA" }),
    }));

    expect(response.status).toBe(403);
    expect(mocks.getServerSession).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("normalizes a ticker and creates it through the atomic RPC", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { email: "free@example.com" } });
    const supabase = createSupabase();
    mocks.getSupabaseAdmin.mockReturnValue(supabase);
    const { POST } = await import("@/app/api/user/watchlist/route");

    const response = await POST(new NextRequest("https://example.com/api/user/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticker: " nvda " }),
    }));

    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith("add_watchlist_item", {
      target_user_id: "user-1",
      target_ticker: "NVDA",
      item_limit: 5,
    });
  });

  it("returns conflict when the database enforces the plan limit", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { email: "free@example.com" } });
    const supabase = createSupabase({ rpcResult: { data: { status: "limit_reached" }, error: null } });
    mocks.getSupabaseAdmin.mockReturnValue(supabase);
    const { POST } = await import("@/app/api/user/watchlist/route");

    const response = await POST(new NextRequest("https://example.com/api/user/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticker: "NVDA" }),
    }));

    expect(response.status).toBe(409);
  });

  it("returns 400 when a reorder body is malformed JSON", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { email: "free@example.com" } });
    const supabase = createSupabase();
    mocks.getSupabaseAdmin.mockReturnValue(supabase);
    const { PATCH } = await import("@/app/api/user/watchlist/route");

    const response = await PATCH(new NextRequest("https://example.com/api/user/watchlist", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON" });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
