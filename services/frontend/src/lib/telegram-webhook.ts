import { timingSafeEqual } from "node:crypto";

export function verifyTelegramWebhookSecret(
  received: string | null,
  expected = process.env.TELEGRAM_WEBHOOK_SECRET
): boolean {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer);
}
