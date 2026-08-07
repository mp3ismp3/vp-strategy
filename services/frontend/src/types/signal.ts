import type { Trigger } from "@/lib/triggers";

export interface ScanResult {
  ticker: string;
  price: number;
  daily: VPLevel;
  weekly: VPLevel;
  monthly: VPLevel;
  consensus: string;
  suggestion: string;
}

export interface VPLevel {
  poc: number;
  vah: number;
  val: number;
  position: "above_va" | "inside_va" | "below_va";
  pct_from_poc: number;
}

export interface AccumulationState {
  ticker: string;
  phase: "A" | "B" | "C" | "D" | "E" | "UNKNOWN";
  tier: "watch" | "confirmed";
  decay_score: number;
  raw_score: number;
  support_primary: number;
  support_dynamic: number;
  resistance: number;
  failing: boolean;
  triggers_fired: Trigger[];
}
