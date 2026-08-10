export interface EcpaySubscriptionAuditInput {
  id: string;
  status: string;
  current_period_end: string | null;
  last_provider_event_at: string | null;
}

export interface EcpayAuditFinding {
  subscriptionId: string;
  severity: "warning" | "critical";
  issue: "missing_period_end" | "renewal_callback_overdue" | "active_period_expired";
}

export function auditEcpaySubscription(
  subscription: EcpaySubscriptionAuditInput,
  now = new Date(),
  alertWindowHours = 12
): EcpayAuditFinding | null {
  if (!["active", "past_due", "canceling"].includes(subscription.status)) return null;
  if (!subscription.current_period_end) {
    return {
      subscriptionId: subscription.id,
      severity: "critical",
      issue: "missing_period_end",
    };
  }

  const periodEnd = new Date(subscription.current_period_end).getTime();
  if (!Number.isFinite(periodEnd) || periodEnd > now.getTime()) return null;
  const overdueHours = (now.getTime() - periodEnd) / (60 * 60 * 1000);
  return {
    subscriptionId: subscription.id,
    severity: overdueHours > alertWindowHours ? "critical" : "warning",
    issue: overdueHours > alertWindowHours
      ? "active_period_expired"
      : "renewal_callback_overdue",
  };
}
