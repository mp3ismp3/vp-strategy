import type { SupabaseClient } from "@supabase/supabase-js";

type ProcessingStatus = "processing" | "processed" | "failed";
export type WebhookClaim = "claimed" | "processed" | "busy";

interface EventRecord {
  processing_status: ProcessingStatus;
  processing_started_at: string | null;
}

const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

export function shouldReclaimWebhookEvent(
  status: ProcessingStatus,
  processingStartedAt: string | null,
  now = new Date()
): boolean {
  if (status === "failed") return true;
  if (status !== "processing" || !processingStartedAt) return false;
  return now.getTime() - new Date(processingStartedAt).getTime() >= CLAIM_TIMEOUT_MS;
}

export async function claimWebhookEvent(
  supabase: SupabaseClient,
  eventId: string,
  eventType: string,
  payload: unknown
): Promise<WebhookClaim> {
  const now = new Date().toISOString();
  const { error: insertError } = await supabase.from("subscription_events").insert({
    event_type: eventType,
    stripe_event_id: eventId,
    payload,
    processing_status: "processing",
    processing_started_at: now,
  });

  if (!insertError) return "claimed";
  if (insertError.code !== "23505") throw insertError;

  const { data, error: lookupError } = await supabase
    .from("subscription_events")
    .select("processing_status, processing_started_at")
    .eq("stripe_event_id", eventId)
    .single<EventRecord>();

  if (lookupError) throw lookupError;
  if (data.processing_status === "processed") return "processed";
  if (!shouldReclaimWebhookEvent(data.processing_status, data.processing_started_at)) {
    return "busy";
  }

  const { data: claimed, error: claimError } = await supabase
    .from("subscription_events")
    .update({
      processing_status: "processing",
      processing_started_at: now,
      last_error: null,
    })
    .eq("stripe_event_id", eventId)
    .eq("processing_status", data.processing_status)
    .eq("processing_started_at", data.processing_started_at)
    .select("id")
    .maybeSingle();

  if (claimError) throw claimError;
  return claimed ? "claimed" : "busy";
}

export async function markWebhookProcessed(
  supabase: SupabaseClient,
  eventId: string
): Promise<void> {
  const { error } = await supabase
    .from("subscription_events")
    .update({
      processing_status: "processed",
      processed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("stripe_event_id", eventId);
  if (error) throw error;
}

export async function markWebhookFailed(
  supabase: SupabaseClient,
  eventId: string,
  error: unknown
): Promise<void> {
  const message = error instanceof Error ? error.message : "Unknown webhook error";
  const { error: updateError } = await supabase
    .from("subscription_events")
    .update({ processing_status: "failed", last_error: message.slice(0, 1000) })
    .eq("stripe_event_id", eventId);
  if (updateError) console.error("Unable to mark webhook event failed", updateError);
}
