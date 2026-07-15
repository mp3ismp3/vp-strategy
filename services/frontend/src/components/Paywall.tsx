"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { Plan } from "@/types/user";
import { hasAccess, isSubscriptionActive } from "@/lib/plans";

interface PaywallProps {
  requiredPlan: Plan;
  children: React.ReactNode;
}

export function Paywall({ requiredPlan, children }: PaywallProps) {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <h2 className="text-2xl font-bold">請先登入</h2>
        <p className="text-gray-600">登入後即可使用此功能</p>
        <Link
          href="/login"
          className="bg-black text-white px-6 py-3 rounded-md font-medium hover:bg-gray-800"
        >
          登入
        </Link>
      </div>
    );
  }

  const user = session.user as any;
  const userPlan: Plan = user?.plan || "free";
  const subscriptionStatus = user?.subscriptionStatus || "inactive";

  if (!isSubscriptionActive(subscriptionStatus) && userPlan !== "free") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <h2 className="text-2xl font-bold">訂閱已過期</h2>
        <p className="text-gray-600">請更新付款方式以繼續使用</p>
        <Link
          href="/pricing"
          className="bg-black text-white px-6 py-3 rounded-md font-medium hover:bg-gray-800"
        >
          重新訂閱
        </Link>
      </div>
    );
  }

  if (!hasAccess(userPlan, requiredPlan)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <h2 className="text-2xl font-bold">需要升級方案</h2>
        <p className="text-gray-600">
          此功能需要 <span className="font-semibold capitalize">{requiredPlan}</span> 方案
        </p>
        <Link
          href="/pricing"
          className="bg-black text-white px-6 py-3 rounded-md font-medium hover:bg-gray-800"
        >
          查看方案
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
