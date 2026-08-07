import type { Plan, SubscriptionStatus } from "@/types/user";

export type PaidPlan = Exclude<Plan, "free">;
export type BillingMode = string;

export interface BillingSubscriptionInput {
  userId: string;
  provider: string;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  providerOrderId: string | null;
  plan: PaidPlan;
  amount: number;
  currency: string;
  billingInterval: string;
  status: SubscriptionStatus | "pending" | "canceling";
  metadata?: Record<string, unknown>;
}

export interface BillingProvider {
  readonly id: string;
  createCheckout(plan: PaidPlan, userId: string): Promise<unknown>;
  cancelSubscription(subscriptionId: string): Promise<unknown>;
  verifyCallback(payload: unknown): boolean;
  processCallback(payload: unknown): Promise<void>;
}

export function hasActiveEntitlement(input: {
  plan: Plan;
  subscriptionStatus: SubscriptionStatus;
  cancelAtPeriodEnd?: boolean | null;
  currentPeriodEnd?: string | null;
}, now = new Date()): boolean {
  if (input.plan === "free" || !["active", "trialing"].includes(input.subscriptionStatus)) {
    return false;
  }
  if (!input.cancelAtPeriodEnd) return true;
  if (!input.currentPeriodEnd) return false;
  const periodEnd = new Date(input.currentPeriodEnd).getTime();
  return Number.isFinite(periodEnd) && periodEnd > now.getTime();
}

export function buildBillingSubscriptionRecord(input: BillingSubscriptionInput) {
  return {
    user_id: input.userId,
    provider: input.provider,
    provider_subscription_id: input.providerSubscriptionId,
    provider_customer_id: input.providerCustomerId,
    provider_order_id: input.providerOrderId,
    plan: input.plan,
    amount: input.amount,
    currency: input.currency.toUpperCase(),
    billing_interval: input.billingInterval,
    status: input.status,
    metadata: input.metadata ?? {},
  };
}
