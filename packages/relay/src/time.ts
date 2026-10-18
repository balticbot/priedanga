/**
 * PAGD publishes local Lithuanian times without an offset
 * ("2026-09-15T00:33:16"). Convert Europe/Vilnius wall time to Unix seconds,
 * handling daylight saving time.
 */

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Vilnius',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Offset of Europe/Vilnius from UTC at the given instant, in milliseconds. */
function offsetAt(utcMs: number): number {
  const parts = Object.fromEntries(fmt.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

export function vilniusToUnix(local: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(local);
  if (!m) throw new Error(`unrecognised local time: ${local}`);
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
  // Two passes settle the offset across DST transitions.
  let utc = wall - offsetAt(wall);
  utc = wall - offsetAt(utc);
  return Math.floor(utc / 1000);
}
