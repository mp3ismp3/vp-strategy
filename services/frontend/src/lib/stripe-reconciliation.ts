import {
  getSubscriptionSnapshot,
  type SubscriptionLike,
} from "@/lib/stripe-config";

type Env = Record<string, string | undefined>;

interface ReconciliationUser {
  id: string;
  email: string;
  plan: string;
  subscription_status: string;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
}

interface ReconciliationSubscription extends SubscriptionLike {
  created: number;
}

interface Difference {
  field: string;
  actual: string | null;
  expected: string | null;
}

export interface ReconciliationResult {
  userId: string;
  email: string;
  safeToApply: boolean;
  issue: string | null;
  differences: Difference[];
  expected: {
    plan: string;
    subscription_status: string;
    stripe_subscription_id: string | null;
    trial_start: string | null;
    trial_end: string | null;
    current_period_end: string | null;
  } | null;
}

const TERMINAL_STATUSES = new Set(["canceled", "incomplete_expired"]);

function valuesMatch(field: string, actual: string | null, expected: string | null) {
  if (field === "current_period_end" && actual && expected) {
    return new Date(actual).getTime() === new Date(expected).getTime();
  }
  return actual === expected;
}

export function buildReconciliationResult(
  user: ReconciliationUser,
  subscriptions: ReconciliationSubscription[],
  env: Env = process.env
): ReconciliationResult {
  const current = subscriptions
    .filter((subscription) => !TERMINAL_STATUSES.has(subscription.status))
    .sort((a, b) => b.created - a.created);

  if (current.length > 1) {
    return {
      userId: user.id,
      email: user.email,
      safeToApply: false,
      issue: "Customer has multiple non-terminal subscriptions",
      differences: [],
      expected: null,
    };
  }

  const expected = current[0]
    ? (() => {
        const snapshot = getSubscriptionSnapshot(current[0], env);
        return {
          plan: snapshot.plan,
          subscription_status: snapshot.subscriptionStatus,
          stripe_subscription_id: snapshot.stripeSubscriptionId,
          trial_start: snapshot.trialStart,
          trial_end: snapshot.trialEnd,
          current_period_end: snapshot.currentPeriodEnd,
        };
      })()
    : {
        plan: "free",
        subscription_status: "canceled",
        stripe_subscription_id: null,
        trial_start: null,
        trial_end: null,
        current_period_end: null,
      };

  const fields = [
    "plan",
    "subscription_status",
    "stripe_subscription_id",
    "current_period_end",
  ] as const;
  const differences = fields
    .filter((field) => !valuesMatch(field, user[field], expected[field]))
    .map((field) => ({ field, actual: user[field], expected: expected[field] }));

  return {
    userId: user.id,
    email: user.email,
    safeToApply: true,
    issue: null,
    differences,
    expected,
  };
}
