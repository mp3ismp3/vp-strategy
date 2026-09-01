"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

export function WatchlistButton({ ticker }: { ticker: string }) {
  const t = useTranslations("common");
  const { data: session } = useSession();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!session) return;
    fetch("/api/user/watchlist")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => setSaved(payload.items?.some((item: { ticker: string }) => item.ticker === ticker)))
      .catch(() => {});
  }, [session, ticker]);

  if (!session) return null;

  async function toggle() {
    setBusy(true);
    setMessage("");
    const response = saved
      ? await fetch(`/api/user/watchlist/${encodeURIComponent(ticker)}`, { method: "DELETE" })
      : await fetch("/api/user/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker }),
        });
    if (response.ok) setSaved(!saved);
    else {
      const payload = await response.json().catch(() => ({}));
      setMessage(payload.error === "upgrade_required" ? t("upgradeToView") : payload.error || t("actionFailed"));
    }
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={saved ? t("removeWatchlist") : t("addWatchlist")}
        title={saved ? t("removeWatchlist") : t("addWatchlist")}
        onClick={toggle}
        disabled={busy}
        className="flex h-9 w-9 items-center justify-center rounded-full border text-xl font-medium hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? "…" : saved ? "−" : "+"}
      </button>
      {message && <span className="text-xs text-red-600">{message}</span>}
    </div>
  );
}
