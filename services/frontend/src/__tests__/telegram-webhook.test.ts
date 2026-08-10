import { describe, expect, it } from "vitest";

import { verifyTelegramWebhookSecret } from "@/lib/telegram-webhook";

describe("Telegram webhook authentication", () => {
  it("rejects missing and invalid secrets", () => {
    expect(verifyTelegramWebhookSecret(null, "expected-secret")).toBe(false);
    expect(verifyTelegramWebhookSecret("wrong", "expected-secret")).toBe(false);
  });

  it("accepts the configured secret", () => {
    expect(verifyTelegramWebhookSecret("expected-secret", "expected-secret")).toBe(true);
  });
});
