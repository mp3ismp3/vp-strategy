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
