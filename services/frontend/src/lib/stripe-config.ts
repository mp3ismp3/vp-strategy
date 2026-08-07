import { createHash } from "node:crypto";

import type { Plan } from "@/types/user";

type Env = Record<string, string | undefined>;
type PaidPlan = Exclude<Plan, "free">;

export type StripeMode = "test" | "live";

export interface SubscriptionLike {
  id: string;
  status: string;
  trial_start: number | null;
  trial_end: number | null;
  current_period_end: number;
  items: { data: Array<{ price: { id: string } }> };
}

type CreatedSubscriptionLike = SubscriptionLike & { created: number };
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired"]);

export function isStripeCheckoutEnabled(env: Env = process.env): boolean {
  return env.STRIPE_CHECKOUT_ENABLED === "true";
}

export function getStripeMode(secretKey = process.env.STRIPE_SECRET_KEY): StripeMode {
  if (/^[sr]k_test_/.test(secretKey ?? "")) return "test";
  if (/^[sr]k_live_/.test(secretKey ?? "")) return "live";
  throw new Error("Unsupported or missing STRIPE_SECRET_KEY");
}

export function getStripePriceIds(env: Env = process.env): Record<PaidPlan, string> {
  const pro = env.STRIPE_PRICE_PRO;
  const premium = env.STRIPE_PRICE_PREMIUM;

  if (!pro) throw new Error("Missing STRIPE_PRICE_PRO");
  if (!premium) throw new Error("Missing STRIPE_PRICE_PREMIUM");
  if (pro === premium) throw new Error("Stripe price IDs must be distinct");

  return { pro, premium };
}

export function getStripePortalConfigurationId(env: Env = process.env): string {
  const configurationId = env.STRIPE_PORTAL_CONFIGURATION_ID;
  if (!configurationId) throw new Error("Missing STRIPE_PORTAL_CONFIGURATION_ID");
  return configurationId;
}

export function getPlanForPriceId(
  priceId: string,
  env: Env = process.env
): PaidPlan {
  const prices = getStripePriceIds(env);
  if (priceId === prices.pro) return "pro";
  if (priceId === prices.premium) return "premium";
  throw new Error(`Unknown Stripe price: ${priceId}`);
}

export function buildCheckoutIdempotencyKey(
  userId: string,
  now = new Date()
): string {
  const thirtyMinuteWindow = Math.floor(now.getTime() / (30 * 60 * 1000));
  const digest = createHash("sha256").update(userId).digest("hex").slice(0, 24);
  return `checkout:${digest}:${thirtyMinuteWindow}`;
}

export function buildCustomerIdempotencyKey(
  userId: string,
  mode: StripeMode
): string {
  const digest = createHash("sha256").update(userId).digest("hex").slice(0, 24);
  return `customer:${mode}:${digest}`;
}

export function isPendingCheckoutReusable(
  status: string,
  url: string | null,
  expiresAt: number,
  now = new Date()
): boolean {
  return status === "open" && Boolean(url) && expiresAt * 1000 > now.getTime();
}

export function findReplacementSubscription<T extends CreatedSubscriptionLike>(
  subscriptions: T[],
  deletedSubscriptionId: string
): T | undefined {
  return subscriptions
    .filter(
      (item) =>
        item.id !== deletedSubscriptionId &&
        !TERMINAL_SUBSCRIPTION_STATUSES.has(item.status)
    )
    .sort((a, b) => b.created - a.created)[0];
}

function toIso(timestamp: number | null): string | null {
  return timestamp === null ? null : new Date(timestamp * 1000).toISOString();
}

export function getSubscriptionSnapshot(
  subscription: SubscriptionLike,
  env: Env = process.env
) {
  const priceId = subscription.items.data[0]?.price.id;
  if (!priceId) throw new Error("Stripe subscription has no price");

  return {
    stripeSubscriptionId: subscription.id,
    plan: getPlanForPriceId(priceId, env),
    subscriptionStatus: subscription.status,
    trialStart: toIso(subscription.trial_start),
    trialEnd: toIso(subscription.trial_end),
    currentPeriodEnd: toIso(subscription.current_period_end),
  };
}
