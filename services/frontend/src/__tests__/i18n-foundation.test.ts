import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("internationalization foundation", () => {
  it("defines the supported locales and request-scoped messages", () => {
    const request = source("src/i18n/request.ts");
    expect(request).toContain("zh-TW");
    expect(request).toContain('"en"');
    expect(request).toContain("NEXT_LOCALE");
    expect(source("messages/zh-TW.json")).toContain('"dashboard"');
    expect(source("messages/en.json")).toContain('"dashboard"');
  });

  it("provides the client provider and a language switcher", () => {
    expect(source("src/app/layout.tsx")).toContain("NextIntlClientProvider");
    const switcher = source("src/components/LanguageSwitcher.tsx");
    expect(switcher).toContain("NEXT_LOCALE");
    expect(switcher).toContain("繁中");
    expect(switcher).toContain("English");
  });

  it("registers the request config with the Next.js plugin", () => {
    expect(source("next.config.ts")).toContain("createNextIntlPlugin");
    expect(source("next.config.ts")).toContain("src/i18n/request.ts");
  });

  it("keeps translation keys in parity across supported locales", () => {
    const flatten = (value: unknown, prefix = ""): string[] => {
      if (!value || typeof value !== "object") return prefix ? [prefix] : [];
      return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
        flatten(child, prefix ? `${prefix}.${key}` : key)
      );
    };
    const zh = JSON.parse(source("messages/zh-TW.json"));
    const en = JSON.parse(source("messages/en.json"));
    expect(flatten(zh).sort()).toEqual(flatten(en).sort());
  });
});
