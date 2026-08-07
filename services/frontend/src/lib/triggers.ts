export interface TriggerRecord {
  date?: string;
  type: string;
}

export type Trigger = string | TriggerRecord;

export function formatTrigger(trigger: Trigger): string {
  return typeof trigger === "string" ? trigger : trigger.type;
}
