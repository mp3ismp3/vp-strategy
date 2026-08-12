const DECORATIVE_SYMBOLS = /[⭐⚠❌✓]\uFE0F?/gu;

export function stripDecorativeSymbols(value: string): string {
  return value.replace(DECORATIVE_SYMBOLS, "").trim();
}
