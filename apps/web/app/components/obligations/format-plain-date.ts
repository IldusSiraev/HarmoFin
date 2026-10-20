import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

/** "2026-10-05" -> "5 окт" (plain calendar date, no timezone shift). */
export function formatPlainDateShort(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return format(date, 'd MMM', { locale: ru }).replace(/\.$/, '');
}

/** "2026-10-05" -> "05.10.2026" (plain calendar date, no timezone shift). */
export function formatPlainDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[3]}.${match[2]}.${match[1]}`;
}
