import type { Plan } from "@/types/user";

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 1000;

interface RefreshSessionAfterPaymentOptions<T extends { plan: Plan }> {
  fetchPlan: () => Promise<T>;
  isCancelled?: () => boolean;
  maxAttempts?: number;
  onPlan?: (plan: T) => void;
  retryDelayMs?: number;
  updateSession: () => Promise<unknown>;
  wait?: (milliseconds: number) => Promise<void>;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function refreshSessionAfterPayment<T extends { plan: Plan }>({
  fetchPlan,
  isCancelled = () => false,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  onPlan,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  updateSession,
  wait = delay,
}: RefreshSessionAfterPaymentOptions<T>): Promise<T> {
  const attempts = Math.max(1, maxAttempts);
  let latest: T | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (isCancelled()) throw new Error("Session plan refresh cancelled");

    try {
      latest = await fetchPlan();
      onPlan?.(latest);
      if (latest.plan !== "free") {
        if (isCancelled()) throw new Error("Session plan refresh cancelled");
        const refreshedSession = await updateSession();
        const refreshedPlan = (refreshedSession as { user?: { plan?: unknown } } | null)?.user?.plan;
        if (refreshedPlan === latest.plan) return latest;
        lastError = new Error("Session plan did not refresh");
      }
    } catch (error) {
      if (isCancelled()) throw new Error("Session plan refresh cancelled");
      lastError = error;
    }
    if (attempt < attempts - 1) {
      await wait(retryDelayMs);
    }
  }

  if (latest?.plan === "free") return latest;
  throw lastError;
}
