import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

export const SUPPORTED_LOCALES = ["zh-TW", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

function isLocale(value: string | undefined): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get("NEXT_LOCALE")?.value;
  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : "zh-TW";
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
