/** "2026-03-01", "2026-03-14" → "01.03–14.03". Server dates, no time zone math. */
export function periodLabel(start: string, end: string): string {
  const short = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
  return `${short(start)}–${short(end)}`;
}
