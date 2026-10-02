const VALID_POSITIONS = new Set(["above_va", "inside_va", "below_va"]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidFrame(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const frame = value as Record<string, unknown>;
  return (
    isFiniteNumber(frame.poc) &&
    isFiniteNumber(frame.vah) &&
    isFiniteNumber(frame.val) &&
    isFiniteNumber(frame.position_pct) &&
    typeof frame.position === "string" &&
    VALID_POSITIONS.has(frame.position)
  );
}

export function isValidScanInfo(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const info = value as Record<string, unknown>;
  if (!isFiniteNumber(info.price) || info.price <= 0 || !isValidFrame(info.daily)) {
    return false;
  }
  return [info.weekly, info.monthly].every(
    (frame) => frame == null || isValidFrame(frame)
  );
}
