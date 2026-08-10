import {
  buildEcpayPeriodQueryFields,
  getEcpayConfig,
  type EcpayConfig,
  type EcpayFields,
} from "@/lib/ecpay";

export interface EcpaySubscriptionAuditInput {
  id: string;
  status: string;
  current_period_end: string | null;
  last_provider_event_at: string | null;
}

export interface EcpayProviderSnapshot {
  merchantTradeNo: string;
  tradeNo: string | null;
  executionStatus: "terminated" | "active" | "completed" | "unknown";
  periodAmount: number | null;
  totalSuccessTimes: number | null;
  latestAuthorizationAt: string | null;
}

export async function queryEcpaySubscription(
  merchantTradeNo: string,
  config: EcpayConfig = getEcpayConfig(),
  fetcher: typeof fetch = fetch
): Promise<EcpayProviderSnapshot> {
  const response = await fetcher(config.periodQueryUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(buildEcpayPeriodQueryFields(config, merchantTradeNo)),
  });
  if (!response.ok) throw new Error(`ECPay reconciliation query failed (${response.status})`);
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > 256 * 1024) throw new Error("ECPay reconciliation response too large");
  const fields = JSON.parse(raw) as EcpayFields & { ExecLog?: unknown };
  if (fields.MerchantID !== config.merchantId || fields.MerchantTradeNo !== merchantTradeNo) {
    throw new Error("ECPay reconciliation identity mismatch");
  }
  const logs = Array.isArray(fields.ExecLog) ? fields.ExecLog as Array<Record<string, unknown>> : [];
  const latest = logs.at(-1);
  const status = { "0": "terminated", "1": "active", "2": "completed" }[fields.ExecStatus ?? ""] ?? "unknown";
  const numberOrNull = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    merchantTradeNo,
    tradeNo: fields.TradeNo ?? null,
    executionStatus: status as EcpayProviderSnapshot["executionStatus"],
    periodAmount: numberOrNull(fields.PeriodAmount),
    totalSuccessTimes: numberOrNull(fields.TotalSuccessTimes),
    latestAuthorizationAt: typeof latest?.process_date === "string" ? latest.process_date : null,
  };
}

export function compareEcpayProviderState(input: {
  subscriptionId: string;
  localStatus: string;
  localAmount: number;
  provider: EcpayProviderSnapshot;
}): EcpayAuditFinding[] {
  const findings: EcpayAuditFinding[] = [];
  if (input.provider.periodAmount !== input.localAmount) {
    findings.push({ subscriptionId: input.subscriptionId, severity: "critical", issue: "provider_amount_mismatch" });
  }
  if (input.provider.executionStatus === "terminated" && input.localStatus !== "canceled") {
    findings.push({ subscriptionId: input.subscriptionId, severity: "critical", issue: "provider_terminated_locally_open" });
  }
  return findings;
}

export function shouldAlertEcpayAudit(findingsCount: number, unresolvedEventsCount: number): boolean {
  return findingsCount > 0 || unresolvedEventsCount > 0;
}

export interface EcpayAuditFinding {
  subscriptionId: string;
  severity: "warning" | "critical";
  issue: "missing_period_end" | "renewal_callback_overdue" | "active_period_expired"
    | "provider_amount_mismatch" | "provider_terminated_locally_open" | "provider_query_failed";
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
