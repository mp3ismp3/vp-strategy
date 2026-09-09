import { resampleToWeekly, type OHLCBar } from "./macd";

function cutoff(bars: OHLCBar[], capturedAt?: string): string | null {
  if (!capturedAt || !Number.isFinite(Date.parse(capturedAt))) return bars.at(-2)?.time ?? null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(capturedAt));
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  if (Number(get("hour")) >= 16) return date;
  const previous = new Date(`${date}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

/** US regular-session daily snapshots. Early closes deliberately wait until 16:00 ET. */
export function completedDailyBars(bars: OHLCBar[], capturedAt?: string): OHLCBar[] {
  if (bars.some((b, i) => !/^\d{4}-\d{2}-\d{2}$/.test(b.time) ||
    !Number.isFinite(Date.parse(b.time)) || (i > 0 && b.time <= bars[i - 1].time))) return [];
  const through = cutoff(bars, capturedAt);
  return through ? bars.filter(b => b.time <= through) : [];
}

export function completedWeeklyBars(bars: OHLCBar[], capturedAt?: string): OHLCBar[] {
  const daily = completedDailyBars(bars, capturedAt);
  const through = cutoff(bars, capturedAt);
  return resampleToWeekly(daily).filter(b => {
    const friday = new Date(`${b.time}T00:00:00Z`);
    friday.setUTCDate(friday.getUTCDate() + 4 - (friday.getUTCDay() + 6) % 7);
    return through !== null && friday.toISOString().slice(0, 10) <= through;
  });
}
