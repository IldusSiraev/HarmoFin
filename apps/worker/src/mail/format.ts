const GROUPING = new Intl.NumberFormat('ru-RU', { useGrouping: true, maximumFractionDigits: 0 });

/**
 * Minor units (scale 2) to "1 234,56 ₽" with integer arithmetic only: bigint never goes through a
 * float. The amount is shown as stored; nothing is calculated here.
 */
export function formatMinor(amountMinor: bigint, currency: string): string {
  const negative = amountMinor < 0n;
  const absolute = negative ? -amountMinor : amountMinor;
  const whole = GROUPING.format(absolute / 100n);
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  const symbol = currency === 'RUB' ? '₽' : currency;
  return `${negative ? '−' : ''}${whole},${fraction} ${symbol}`;
}

export function pluralRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
