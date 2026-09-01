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

export function getVpPositionLabel(position?: string, translate?: (key: string) => string): string {
  if (!position) return translate ? translate("noData") : "無資料";
  if (translate && VP_POSITION_KEYS[position]) return translate(VP_POSITION_KEYS[position]);
  return VP_POSITION_LABELS[position] ?? position;
}
