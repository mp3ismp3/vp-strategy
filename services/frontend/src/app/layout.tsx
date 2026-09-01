import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Navbar } from "@/components/Navbar";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getLocale } from "next-intl/server";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "VP Strategy — Market Auction Theory 交易分析平台",
  description:
    "Volume Profile 多時間框架分析 + Wyckoff 機構吸籌追蹤。即時信號通知，幫你找到最佳入場時機。",
  icons: {
    icon: [{ url: "/ptrade.svg", type: "image/svg+xml" }],
    shortcut: "/ptrade.svg",
    apple: "/ptrade.svg",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale}>
      <body className={inter.className}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>
            <Navbar />
            <main>{children}</main>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
