import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  getRecentEvents,
  getBlacklist,
  addToBlacklist,
  removeFromBlacklist,
  logBlacklistAudit,
  getBlacklistAuditLog,
} from "@/lib/rate-limit";
import { isValidIP } from "@/lib/ip-validation";

/**
 * GET /api/admin/rate-limit
 * 查看最近被阻擋的請求 + 黑名單
 * 僅限管理員存取
 */
export async function GET(request: Request) {
  const token = await getToken({
    req: request as any,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // 只有管理員可以存取（用 email 白名單判斷）
  const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim());
  if (!token?.email || !adminEmails.includes(token.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [events, blacklist, auditLog] = await Promise.all([
    getRecentEvents(50),
    getBlacklist(),
    getBlacklistAuditLog(20),
  ]);

  return NextResponse.json({
    recentBlocked: events,
    blacklist,
    auditLog,
    summary: {
      totalBlocked: events.length,
      uniqueIPs: [...new Set(events.map((e) => e.ip))].length,
      topOffenders: getTopOffenders(events),
    },
  });
}

/**
 * POST /api/admin/rate-limit
 * 管理黑名單：新增或移除 IP
 * Body: { action: "add" | "remove", ip: string }
 */
export async function POST(request: Request) {
  const token = await getToken({
    req: request as any,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim());
  if (!token?.email || !adminEmails.includes(token.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { action?: unknown; ip?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, ip } = body;

  if (!ip || typeof ip !== "string") {
    return NextResponse.json({ error: "Missing ip parameter" }, { status: 400 });
  }

  // IP 格式驗證（支援 IPv4 + IPv6）
  if (!isValidIP(ip as string)) {
    return NextResponse.json({ error: "Invalid IP format (supports IPv4 and IPv6)" }, { status: 400 });
  }

  if (action === "add") {
    await addToBlacklist(ip);
    await logBlacklistAudit({
      action: "add",
      ip,
      operatorEmail: token.email as string,
      timestamp: Date.now(),
    });
    return NextResponse.json({ success: true, message: `${ip} added to blacklist` });
  } else if (action === "remove") {
    await removeFromBlacklist(ip);
    await logBlacklistAudit({
      action: "remove",
      ip,
      operatorEmail: token.email as string,
      timestamp: Date.now(),
    });
    return NextResponse.json({ success: true, message: `${ip} removed from blacklist` });
  }

  return NextResponse.json({ error: "Invalid action (use 'add' or 'remove')" }, { status: 400 });
}

// ─── Helper ─────────────────────────────────────────────────

function getTopOffenders(events: { ip: string }[]) {
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.ip] = (counts[e.ip] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ip, count]) => ({ ip, count }));
}
