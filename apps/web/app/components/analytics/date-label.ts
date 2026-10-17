/** 'YYYY-MM-DD' → 'DD.MM.YYYY' by string slicing (no Date/timezone math); non-matching input is returned unchanged. */
export function dateLabel(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}
