const VP_POSITION_LABELS: Record<string, string> = {
  above_va: "高於價值區",
  inside_va: "價值區內",
  below_va: "低於價值區",
};

const VP_POSITION_KEYS: Record<string, string> = {
  above_va: "above",
  inside_va: "inside",
  below_va: "below",
};

export type ValueAreaEdge = "VAH" | "VAL";

export interface ValueAreaProximity {
  edge: ValueAreaEdge;
  distancePct: number;
}

export interface ValueAreaTouchFrame {
  timeframe: "D" | "W" | "M";
  vah: number;
  val: number;
  vaTouch?: "vah" | "val" | "both" | null;
}

export interface ValueAreaTouchSummary {
  edge: ValueAreaEdge;
  timeframes: ValueAreaTouchFrame["timeframe"][];
  lowPrice: number;
  highPrice: number;
  isConfluent: boolean;
  label: string;
}

const CONFLUENCE_BAND_PCT = 0.005;

export function getVpPositionLabel(position?: string, translate?: (key: string) => string): string {
  if (!position) return translate ? translate("noData") : "無資料";
  if (translate && VP_POSITION_KEYS[position]) return translate(VP_POSITION_KEYS[position]);
  return VP_POSITION_LABELS[position] ?? position;
}

/** Return the closest actionable value-area edge for a valid VP frame. */
export function getNearestValueAreaEdge(
  price?: number,
  val?: number,
  vah?: number,
): ValueAreaProximity | null {
  if (!Number.isFinite(price) || !Number.isFinite(val) || !Number.isFinite(vah)
    || price! <= 0 || val! <= 0 || vah! <= val!) {
    return null;
  }

  const valDistance = Math.abs((price! - val!) / val!) * 100;
  const vahDistance = Math.abs((price! - vah!) / vah!) * 100;
  if (vahDistance <= valDistance) {
    return { edge: "VAH", distancePct: Number(vahDistance.toFixed(1)) };
  }
  return { edge: "VAL", distancePct: Number(valDistance.toFixed(1)) };
}

/**
 * Summarize the latest-bar VAH/VAL touches without treating overlapping
 * daily, weekly, and monthly profiles as independent signals. Levels within
 * 0.5% of their midpoint are shown as one confluence zone.
 */
export function summarizeValueAreaTouches(
  frames: ValueAreaTouchFrame[],
): ValueAreaTouchSummary[] {
  const touches: Record<ValueAreaEdge, Array<{ timeframe: ValueAreaTouchFrame["timeframe"]; price: number }>> = {
    VAH: [],
    VAL: [],
  };

  for (const frame of frames) {
    if (!frame.vaTouch) continue;
    if ((frame.vaTouch === "vah" || frame.vaTouch === "both") && Number.isFinite(frame.vah) && frame.vah > 0) {
      touches.VAH.push({ timeframe: frame.timeframe, price: frame.vah });
    }
    if ((frame.vaTouch === "val" || frame.vaTouch === "both") && Number.isFinite(frame.val) && frame.val > 0) {
      touches.VAL.push({ timeframe: frame.timeframe, price: frame.val });
    }
  }

  return (Object.keys(touches) as ValueAreaEdge[]).flatMap((edge) => {
    const entries = touches[edge];
    if (!entries.length) return [];

    const prices = entries.map((entry) => entry.price);
    const lowPrice = Math.min(...prices);
    const highPrice = Math.max(...prices);
    const midpoint = (lowPrice + highPrice) / 2;
    const isConfluent = entries.length >= 2
      && (highPrice - lowPrice) / midpoint <= CONFLUENCE_BAND_PCT;
    const timeframes = entries.map((entry) => entry.timeframe);
    const price = (value: number) => `$${value.toFixed(2)}`;
    const label = isConfluent
      ? `${edge} 匯聚（${timeframes.join("/")}） ${price(lowPrice)}–${price(highPrice)}`
      : entries.length === 1
        ? `${edge} 觸及（${timeframes[0]}） ${price(lowPrice)}`
        : `${edge} 分散觸及（${entries.map((entry) => `${entry.timeframe} ${price(entry.price)}`).join(" · ")}）`;

    return [{ edge, timeframes, lowPrice, highPrice, isConfluent, label }];
  });
}
