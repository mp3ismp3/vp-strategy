"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

export function WatchlistButton({ ticker }: { ticker: string }) {
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
      setMessage(payload.error === "upgrade_required" ? "升級後可加入此標的" : payload.error || "操作失敗");
    }
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? "處理中" : saved ? "移除觀察" : "加入觀察"}
      </button>
      {message && <span className="text-xs text-red-600">{message}</span>}
    </div>
  );
}
