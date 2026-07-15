"use client";

import { useSession } from "next-auth/react";
import { PLANS } from "@/lib/plans";
import { Plan } from "@/types/user";

export default function PricingPage() {
  const { data: session } = useSession();
  const userPlan = (session?.user as any)?.plan || "free";

  const handleCheckout = async (plan: Plan) => {
    if (!session) {
      window.location.href = "/login?callbackUrl=/pricing";
      return;
    }

    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });

    const { url } = await res.json();
    if (url) {
      window.location.href = url;
    }
  };

  return (
    <div className="min-h-screen py-20 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold">選擇你的方案</h1>
          <p className="text-gray-600 mt-4">
            7 天免費試用 Pro，不滿意隨時取消
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {(["free", "pro", "premium"] as Plan[]).map((planKey) => {
            const plan = PLANS[planKey];
            const isCurrent = userPlan === planKey;
            const isPopular = planKey === "pro";

            return (
              <div
                key={planKey}
                className={`relative bg-white rounded-xl border-2 p-8 flex flex-col ${
                  isPopular ? "border-black shadow-lg" : "border-gray-200"
                }`}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-black text-white text-xs px-3 py-1 rounded-full">
                    最受歡迎
                  </div>
                )}

                <h3 className="text-xl font-bold">{plan.name}</h3>
                <div className="mt-4 flex items-baseline">
                  <span className="text-4xl font-bold">
                    ${plan.price}
                  </span>
                  {plan.price > 0 && (
                    <span className="text-gray-500 ml-1">/月</span>
                  )}
                </div>

                <ul className="mt-8 space-y-3 flex-1">
                  {plan.highlights.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-green-500 mt-0.5">✓</span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handleCheckout(planKey)}
                  disabled={isCurrent || planKey === "free"}
                  className={`mt-8 w-full py-3 rounded-md font-medium transition ${
                    isCurrent
                      ? "bg-gray-100 text-gray-500 cursor-not-allowed"
                      : planKey === "free"
                      ? "bg-gray-100 text-gray-500 cursor-not-allowed"
                      : isPopular
                      ? "bg-black text-white hover:bg-gray-800"
                      : "border border-black text-black hover:bg-gray-50"
                  }`}
                >
                  {isCurrent
                    ? "目前方案"
                    : planKey === "free"
                    ? "目前方案"
                    : planKey === "pro"
                    ? "開始免費試用"
                    : "升級 Premium"}
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-12 text-center text-sm text-gray-500">
          <p>所有付費方案均享 7 天免費試用期。試用期內取消不收費。</p>
          <p className="mt-1">付款由 Stripe 安全處理，我們不會儲存你的卡號。</p>
        </div>
      </div>
    </div>
  );
}
