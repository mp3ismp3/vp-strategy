/**
 * IP 格式驗證工具（IPv4 + IPv6）
 */

const IPV4_REGEX =
  /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

/**
 * 驗證 IPv6 地址格式
 * 支援完整格式（8 組 hex）和壓縮格式（含 ::）
 */
export function isValidIPv6(addr: string): boolean {
  // 基本字元檢查
  if (!/^[0-9a-fA-F:]+$/.test(addr)) return false;
  // :: 最多出現一次
  if ((addr.match(/::/g) || []).length > 1) return false;
  // 不能以單一 : 開頭或結尾（:: 除外）
  if (addr.startsWith(":") && !addr.startsWith("::")) return false;
  if (addr.endsWith(":") && !addr.endsWith("::")) return false;
  // 不能有連續三個以上的 :
  if (/:::/g.test(addr)) return false;

  const parts = addr.split(":");
  // 完整格式：剛好 8 組
  if (!addr.includes("::")) {
    if (parts.length !== 8) return false;
  } else {
    // 壓縮格式：展開後不能超過 8 組
    const filledParts = parts.filter((p) => p !== "");
    if (filledParts.length > 7) return false;
  }
  // 每組最多 4 個 hex 字元
  for (const part of parts) {
    if (part.length > 4) return false;
  }
  return true;
}

/**
 * 驗證 IPv4 地址格式
 */
export function isValidIPv4(addr: string): boolean {
  return IPV4_REGEX.test(addr);
}

/**
 * 驗證 IP 地址格式（IPv4 或 IPv6）
 */
export function isValidIP(addr: string): boolean {
  return isValidIPv4(addr) || isValidIPv6(addr);
}
