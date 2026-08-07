import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hasActiveEntitlement } from "@/lib/billing";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

async function sendTelegramMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

export async function POST(req: NextRequest) {
  if (!BOT_TOKEN) {
    return NextResponse.json({ error: "Bot not configured" }, { status: 500 });
  }

  const update = await req.json();

  // Handle /start command
  const message = update.message;
  if (!message?.text || !message.from) {
    return NextResponse.json({ ok: true });
  }

  const text = message.text.trim();
  const telegramUserId = message.from.id;
  const telegramUsername = message.from.username || "";

  if (text.startsWith("/start")) {
    const parts = text.split(" ");
    const bindToken = parts[1] || "";

    if (!bindToken) {
      await sendTelegramMessage(
        telegramUserId,
        "👋 歡迎使用 VP Strategy Bot！\n\n" +
          "請到網站的「帳號設定」頁面點擊「綁定 Telegram」，\n" +
          "取得綁定碼後輸入：\n\n" +
          "/start <綁定碼>"
      );
      return NextResponse.json({ ok: true });
    }

    // Verify bind token
    const supabase = getSupabaseAdmin();

    const { data: tokenRecord } = await supabase
      .from("telegram_bind_tokens")
      .select("*")
      .eq("token", bindToken)
      .single();

    if (!tokenRecord) {
      await sendTelegramMessage(telegramUserId, "❌ 綁定碼無效或已過期。請重新產生。");
      return NextResponse.json({ ok: true });
    }

    const expiresAt = new Date(tokenRecord.expires_at);
    if (new Date() > expiresAt) {
      await sendTelegramMessage(telegramUserId, "❌ 綁定碼已過期。請重新產生。");
      return NextResponse.json({ ok: true });
    }

    const email = tokenRecord.email;

    // Update user's telegram_user_id
    await supabase
      .from("users")
      .update({
        telegram_user_id: telegramUserId,
        telegram_username: telegramUsername,
        updated_at: new Date().toISOString(),
      })
      .eq("email", email);

    // Delete used token
    await supabase.from("telegram_bind_tokens").delete().eq("token", bindToken);

    // Check user plan
    const { data: user } = await supabase
      .from("users")
      .select("plan, subscription_status, current_period_end, cancel_at_period_end")
      .eq("email", email)
      .single();

    if (user && hasActiveEntitlement({
      plan: user.plan,
      subscriptionStatus: user.subscription_status,
      currentPeriodEnd: user.current_period_end,
      cancelAtPeriodEnd: user.cancel_at_period_end,
    })) {
      await sendTelegramMessage(
        telegramUserId,
        `✅ 綁定成功！（${email}）\n\n` +
          `你的方案：${user.plan.toUpperCase()}\n` +
          `即時交易信號將直接私訊給你。📈`
      );
    } else {
      await sendTelegramMessage(
        telegramUserId,
        `✅ 綁定成功！（${email}）\n\n` +
          `目前為免費方案，升級後即可收到即時通知。\n` +
          `👉 到網站查看方案`
      );
    }

    return NextResponse.json({ ok: true });
  }

  // Handle /status command
  if (text === "/status") {
    const supabase = getSupabaseAdmin();

    const { data: user } = await supabase
      .from("users")
      .select("email, plan, subscription_status, current_period_end, cancel_at_period_end")
      .eq("telegram_user_id", telegramUserId)
      .single();

    if (!user) {
      await sendTelegramMessage(
        telegramUserId,
        "❌ 尚未綁定帳號。\n請到網站「帳號設定」進行綁定。"
      );
    } else {
      const statusEmoji = hasActiveEntitlement({
        plan: user.plan,
        subscriptionStatus: user.subscription_status,
        currentPeriodEnd: user.current_period_end,
        cancelAtPeriodEnd: user.cancel_at_period_end,
      }) ? "✅" : "❌";
      await sendTelegramMessage(
        telegramUserId,
        `📊 <b>VP Strategy 訂閱狀態</b>\n\n` +
          `Email: ${user.email}\n` +
          `方案: ${user.plan.toUpperCase()}\n` +
          `狀態: ${statusEmoji} ${user.subscription_status}\n` +
          `到期: ${user.current_period_end || "—"}`
      );
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
