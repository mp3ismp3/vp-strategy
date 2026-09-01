"use client";

import { useLocale } from "next-intl";

export function LanguageSwitcher() {
  const locale = useLocale();
  function changeLocale(nextLocale: "zh-TW" | "en") {
    document.cookie = `NEXT_LOCALE=${nextLocale}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  }

  return (
    <div className="flex items-center gap-1 rounded-md border p-1 text-xs" aria-label="Language">
      <button type="button" onClick={() => changeLocale("zh-TW")} className={locale === "zh-TW" ? "rounded bg-gray-900 px-2 py-1 text-white" : "rounded px-2 py-1 text-gray-600"}>繁中</button>
      <button type="button" onClick={() => changeLocale("en")} className={locale === "en" ? "rounded bg-gray-900 px-2 py-1 text-white" : "rounded px-2 py-1 text-gray-600"}>English</button>
    </div>
  );
}
