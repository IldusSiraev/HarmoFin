export interface OperationDayGroup<T extends { occurredOn: string }> {
  date: string;
  label: string;
  items: T[];
}

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

function dayLabel(iso: string): string {
  const [, month, day] = iso.split('-');
  const monthName = MONTHS[Number(month) - 1] ?? '';
  return `${Number(day)} ${monthName}`;
}

function previousDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function groupByDay<T extends { occurredOn: string }>(
  items: ReadonlyArray<T>,
  today: string,
): Array<OperationDayGroup<T>> {
  const yesterday = previousDay(today);
  const groups: Array<OperationDayGroup<T>> = [];

  for (const item of items) {
    const existing = groups.find((group) => group.date === item.occurredOn);
    if (existing) {
      existing.items.push(item);
      continue;
    }

    const plain = dayLabel(item.occurredOn);
    let label = plain;
    if (item.occurredOn === today) label = `Сегодня, ${plain}`;
    else if (item.occurredOn === yesterday) label = `Вчера, ${plain}`;

    groups.push({ date: item.occurredOn, label, items: [item] });
  }

  return groups;
}
