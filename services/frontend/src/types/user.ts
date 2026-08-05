export type Plan = "free" | "pro" | "premium";

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "incomplete"
  | "incomplete_expired"
  | "past_due"
  | "paused"
  | "unpaid"
  | "canceled"
  | "inactive";

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  auth_provider: "email" | "google";
  plan: Plan;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_mode: "test" | "live" | null;
  stripe_checkout_session_id: string | null;
  stripe_checkout_expires_at: string | null;
  subscription_status: SubscriptionStatus;
  trial_start: string | null;
  trial_end: string | null;
  trial_used_at: string | null;
  current_period_end: string | null;
  telegram_user_id: number | null;
  telegram_username: string | null;
  created_at: string;
  updated_at: string;
}
