"use client";

import Link from "next/link";

interface SignalMosaicProps {
  locked: boolean;
  children: React.ReactNode;
  message?: string;
}

export function SignalMosaic({
  locked,
  children,
  message = "登入後解鎖完整信號",
}: SignalMosaicProps) {
  if (!locked) return <>{children}</>;

  return (
    <div className="relative overflow-hidden rounded-xl" data-testid="signal-mosaic">
      <div
        aria-hidden="true"
        className="pointer-events-none select-none blur-md opacity-60"
      >
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-white/35 backdrop-blur-[2px]">
        <div className="max-w-sm rounded-xl border bg-white/95 p-5 text-center shadow-lg">
          <p className="font-semibold text-gray-900">{message}</p>
          <p className="mt-1 text-sm text-gray-500">
            免費登入即可查看方向、價位與觸發細節。
          </p>
          <Link
            href="/login"
            className="mt-4 inline-flex rounded-md bg-black px-5 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            登入解鎖
          </Link>
        </div>
      </div>
    </div>
  );
}
