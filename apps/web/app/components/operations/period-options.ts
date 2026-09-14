export interface PeriodChipOption {
  value: string;
  label: string;
}

function shortDay(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${day}.${month}`;
}

function previousDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

// The API resolves any date inside a period to that period, so the previous
// period needs nothing but the day before the current one starts — cycle and
// period arithmetic stays on the server.
export function periodChipOptions(
  period: { start: string; end: string } | null,
): PeriodChipOption[] {
  if (period === null) return [];
  return [
    {
      value: period.start,
      label: `Текущий период (${shortDay(period.start)} – ${shortDay(period.end)})`,
    },
    { value: previousDay(period.start), label: 'Прошлый период' },
  ];
}
