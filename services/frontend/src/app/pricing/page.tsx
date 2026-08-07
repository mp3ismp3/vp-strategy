"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { getPricingPlanAction, PLANS } from "@/lib/plans";
import { Plan } from "@/types/user";

export default function PricingPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const userPlan = (session?.user as { plan?: Plan } | undefined)?.plan || "free";
  const [checkoutError, setCheckoutError] = useState("");
  const [checkoutPlan, setCheckoutPlan] = useState<Plan | null>(null);
  const ecpayEnabled = process.env.NEXT_PUBLIC_ECPAY_ENABLED === "true";

  const handleCheckout = async (plan: Plan) => {
    if (!session) {
      router.push("/login?callbackUrl=/pricing");
      return;
    }

    setCheckoutError("");
    setCheckoutPlan(plan);
    try {
      const res = await fetch("/api/ecpay/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const result = await res.json();
      if (!res.ok || !result.action || !result.fields) {
        setCheckoutError(result.error || "目前無法建立付款頁面，請稍後再試。");
        return;
      }
      const form = document.createElement("form");
      form.method = "POST";
      form.action = result.action;
      for (const [name, value] of Object.entries(result.fields as Record<string, string>)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } finally {
      setCheckoutPlan(null);
    }
  };

  return (
    <div className="min-h-screen py-20 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold">選擇你的方案</h1>
          <p className="text-gray-600 mt-4">信用卡定期定額，付款成功後立即開通</p>
          {!ecpayEnabled && (
            <p className="mt-3 rounded-md bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              台灣地區金流建置中，目前暫不支援新訂閱。
            </p>
          )}
          {userPlan !== "free" && (
            <p className="text-sm text-amber-700 mt-3">
              目前不支援方案直接切換；如需更換，請先取消並於到期後重新訂閱。
            </p>
          )}
          {checkoutError && (
            <p className="mt-4 text-sm font-medium text-red-600">{checkoutError}</p>
          )}
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {(["free", "pro", "premium"] as Plan[]).map((planKey) => {
            const plan = PLANS[planKey];
            const isPopular = planKey === "pro";
            const action = getPricingPlanAction(userPlan, planKey);

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
                    {plan.price === 0 ? "$0" : `NT$${plan.price}`}
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

                {action.href ? (
                  <a
                    href={action.href}
                    className="mt-8 w-full py-3 rounded-md border border-black text-center text-sm font-medium text-black hover:bg-gray-50"
                  >
                    {action.label}
                  </a>
                ) : (
                  <button
                    onClick={() => handleCheckout(planKey)}
                    disabled={action.disabled || !ecpayEnabled || checkoutPlan !== null}
                    className={`mt-8 w-full py-3 rounded-md font-medium transition ${
                      action.disabled || !ecpayEnabled
                        ? "bg-gray-100 text-gray-500 cursor-not-allowed"
                        : isPopular
                        ? "bg-black text-white hover:bg-gray-800"
                        : "border border-black text-black hover:bg-gray-50"
                    }`}
                  >
                    {checkoutPlan === planKey ? "前往綠界..." : !ecpayEnabled && planKey !== "free" ? "暫不支援訂閱" : action.label}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-12 text-center text-sm text-gray-500">
          <p>Pro NT$320／月；Premium NT$620／月，不提供免費試用。</p>
          <p className="mt-1">付款由綠界科技安全處理，我們不會儲存你的卡號。</p>
        </div>
      </div>
    </div>
  );
}
