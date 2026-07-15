export type Plan = "free" | "pro" | "premium";

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
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
  subscription_status: SubscriptionStatus;
  trial_start: string | null;
  trial_end: string | null;
  current_period_end: string | null;
  telegram_user_id: number | null;
  telegram_username: string | null;
  created_at: string;
  updated_at: string;
}
