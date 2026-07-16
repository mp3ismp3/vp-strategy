"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function AccountPage() {
  const { data: session, status } = useSession();
  const user = session?.user as any;
  const [bindingTelegram, setBindingTelegram] = useState(false);
  const [bindToken, setBindToken] = useState("");
  const [planInfo, setPlanInfo] = useState<any>(null);

  // Fetch real-time plan info
  useEffect(() => {
    if (session) {
      fetch("/api/user/plan")
        .then((res) => res.json())
        .then((data) => setPlanInfo(data))
        .catch(() => {});
    }
  }, [session]);

  const getTrialDaysLeft = () => {
    if (!planInfo?.trialEnd) return null;
    const end = new Date(planInfo.trialEnd);
    const now = new Date();
    const days = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return days > 0 ? days : null;
  };

  const trialDaysLeft = getTrialDaysLeft();
  const isPastDue = planInfo?.subscriptionStatus === "past_due";

  const handleBindTelegram = async () => {
    setBindingTelegram(true);
    const res = await fetch("/api/telegram/bind", { method: "POST" });
    const data = await res.json();
    setBindToken(data.token || "");
    setBindingTelegram(false);
  };

  const handleManageSubscription = async () => {
    const res = await fetch("/api/stripe/portal", { method: "POST" });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    }
  };

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">帳號設定</h1>

      {/* Profile */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>個人資料</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between">
            <span className="text-gray-600">Email</span>
            <span className="font-medium">{user?.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">名稱</span>
            <span className="font-medium">{user?.name || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">登入方式</span>
            <span className="font-medium capitalize">Google</span>
          </div>
        </CardContent>
      </Card>

      {/* Subscription */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>訂閱方案</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Past due warning */}
          {isPastDue && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800 font-medium">
                ⚠️ 付款失敗 — 請更新付款方式以繼續使用服務
              </p>
              <button
                onClick={handleManageSubscription}
                className="mt-2 text-sm bg-red-600 text-white px-3 py-1 rounded-md hover:bg-red-700"
              >
                更新卡號
              </button>
            </div>
          )}

          {/* Trial days remaining */}
          {trialDaysLeft && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-blue-800">
                🎉 免費試用中 — 剩餘 <span className="font-bold">{trialDaysLeft} 天</span>
              </p>
            </div>
          )}

          <div className="flex justify-between items-center">
            <span className="text-gray-600">目前方案</span>
            <Badge className="capitalize text-sm">{planInfo?.plan || user?.plan || "free"}</Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-600">狀態</span>
            <Badge
              variant={
                user?.subscriptionStatus === "active" ||
                user?.subscriptionStatus === "trialing"
                  ? "default"
                  : "destructive"
              }
            >
              {user?.subscriptionStatus || "inactive"}
            </Badge>
          </div>
          <Separator />
          <div className="flex gap-3">
            <button
              onClick={handleManageSubscription}
              className="px-4 py-2 border rounded-md text-sm font-medium hover:bg-gray-50"
            >
              管理訂閱
            </button>
            <a
              href="/pricing"
              className="px-4 py-2 bg-black text-white rounded-md text-sm font-medium hover:bg-gray-800"
            >
              升級方案
            </a>
          </div>
        </CardContent>
      </Card>

      {/* Telegram */}
      <Card>
        <CardHeader>
          <CardTitle>Telegram 通知</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            綁定 Telegram 後，即時交易信號會直接私訊給你。
          </p>

          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <p className="font-medium mb-1">步驟：</p>
            <ol className="list-decimal ml-4 space-y-1 text-gray-600">
              <li>打開 Bot → <a href="https://t.me/vp_signal_alert_bot" target="_blank" className="text-blue-600 underline">t.me/vp_signal_alert_bot</a></li>
              <li>點下方「綁定 Telegram」取得綁定碼</li>
              <li>在 Bot 對話中發送 <code>/start 綁定碼</code></li>
            </ol>
          </div>

          {bindToken ? (
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
              <p className="text-sm font-medium mb-2">
                請在 Telegram 向 Bot 發送以下指令：
              </p>
              <code className="bg-white px-3 py-2 rounded border block text-center">
                /start {bindToken}
              </code>
              <p className="text-xs text-gray-500 mt-2">
                Token 有效期 10 分鐘
              </p>
            </div>
          ) : (
            <button
              onClick={handleBindTelegram}
              disabled={bindingTelegram}
              className="px-4 py-2 border rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              {bindingTelegram ? "產生中..." : "綁定 Telegram"}
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
