const NBSP = '\u00a0';
const AMOUNT = /^(\d{1,12})(?:[.,](\d{1,2}))?$/;
const CURRENCY_SUFFIX = /(?:₽|руб\.?|р\.?)$/i;
const DAY = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/;
const CLOCK = /^([01]?\d|2[0-3])[:.]([0-5]\d)$/;
const LAST_MINUTE = 23 * 60 + 59;

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * "1 250,5" -> "1250.50": the canonical decimal string the API schemas accept. Only digits are
 * read as text; no float ever holds the amount. Null for zero, signs, words or more than two
 * decimals.
 */
export function parseAmount(text: string): string | null {
  const compact = text.replace(/\s/g, '').replace(CURRENCY_SUFFIX, '');
  const match = AMOUNT.exec(compact);
  if (!match) return null;
  const whole = BigInt(match[1]!);
  const fraction = (match[2] ?? '').padEnd(2, '0');
  if (whole === 0n && fraction === '00') return null;
  return `${whole.toString()}.${fraction}`;
}

/** Canonical "1250.50" to minor units. */
export function amountToMinor(amount: string): bigint {
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}

/** Minor units to "1 250,50 ₽" (display text only; kopecks hidden when zero). */
export function formatRub(minor: string | bigint): string {
  const value = typeof minor === 'bigint' ? minor : BigInt(minor);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const kopecks = absolute % 100n;
  const tail = kopecks === 0n ? '' : `,${kopecks.toString().padStart(2, '0')}`;
  return `${negative ? '−' : ''}${whole}${tail}${NBSP}₽`;
}

/** "2026-11-05" -> "05.11"; the year is shown only when it differs from today's. */
export function formatDay(date: string, today: string): string {
  const [year, month, day] = date.split('-');
  return year === today.slice(0, 4) ? `${day}.${month}` : `${day}.${month}.${year}`;
}

/** "5.11" (year of today) or "05.11.2026" -> "2026-11-05"; null for an impossible date. */
export function parseDay(text: string, today: string): string | null {
  const match = DAY.exec(text.trim());
  if (!match) return null;
  const year = match[3] ?? today.slice(0, 4);
  const iso = `${year}-${match[2]!.padStart(2, '0')}-${match[1]!.padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

function parseClock(text: string): string | null {
  const match = CLOCK.exec(text.trim());
  return match ? `${match[1]!.padStart(2, '0')}:${match[2]}` : null;
}

function clockOf(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "9:30" -> 09:30–10:30 (never past 23:59); "9:30-11:00" -> as written. */
export function parseTimeRange(text: string): { startTime: string; endTime: string } | null {
  const parts = text.replace(/[–—]/g, '-').split('-');
  if (parts.length > 2) return null;
  const startTime = parseClock(parts[0]!);
  if (!startTime) return null;
  if (parts.length === 2) {
    const endTime = parseClock(parts[1]!);
    if (!endTime || endTime < startTime) return null;
    return { startTime, endTime };
  }
  const [hours, minutes] = startTime.split(':').map(Number) as [number, number];
  return { startTime, endTime: clockOf(Math.min(hours * 60 + minutes + 60, LAST_MINUTE)) };
}
