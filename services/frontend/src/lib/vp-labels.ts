const VP_POSITION_LABELS: Record<string, string> = {
  above_va: "高於價值區",
  inside_va: "價值區內",
  below_va: "低於價值區",
};

export function getVpPositionLabel(position?: string): string {
  if (!position) return "無資料";
  return VP_POSITION_LABELS[position] ?? position;
}
