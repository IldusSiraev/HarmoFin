import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

import type { CalendarFeedItem } from '../../composables/useFamilyCalendar.js';

const DAY_MS = 86_400_000;
const toUtc = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const fromUtc = (value: number): string => new Date(value).toISOString().slice(0, 10);
// date-fns formats in the runtime zone; noon UTC keeps the calendar day in every zone.
const asLocalNoon = (date: string): Date => new Date(`${date}T12:00:00Z`);
const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export function addIsoDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

export function isoWeekday(date: string): number {
  const day = new Date(toUtc(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function monthGrid(month: string): string[][] {
  const first = `${month}-01`;
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const last = fromUtc(Date.UTC(year, monthNumber, 0));
  let day = addIsoDays(first, 1 - isoWeekday(first));
  const weeks: string[][] = [];
  while (day <= last) {
    const week: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      week.push(day);
      day = addIsoDays(day, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export function monthRange(month: string): { from: string; to: string } {
  const grid = monthGrid(month);
  return { from: grid[0]![0]!, to: grid.at(-1)!.at(-1)! };
}

export function agendaRange(start: string, days = 14): { from: string; to: string } {
  return { from: start, to: addIsoDays(start, days - 1) };
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

export function monthTitle(month: string): string {
  return capitalize(format(asLocalNoon(`${month}-01`), 'LLLL yyyy', { locale: ru }));
}

const SHORT_MONTHS = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];
// Fixed three-letter forms from the approved prototype («30 окт – 12 ноя»), not date-fns «нояб.».
const shortMonth = (date: string): string =>
  `${Number(date.slice(8))} ${SHORT_MONTHS[Number(date.slice(5, 7)) - 1]}`;

export function agendaTitle(range: { from: string; to: string }): string {
  return `${shortMonth(range.from)} – ${shortMonth(range.to)}`;
}

export function dayHeading(date: string, today: string): string {
  const weekday = format(asLocalNoon(date), 'EEEEEE', { locale: ru });
  const dayMonth = format(asLocalNoon(date), 'd MMMM', { locale: ru });
  if (date === today) return `Сегодня, ${weekday} ${dayMonth}`;
  if (date === addIsoDays(today, 1)) return `Завтра, ${weekday} ${dayMonth}`;
  return `${capitalize(weekday)} ${dayMonth}`;
}

export function dayDialogTitle(date: string): string {
  return capitalize(format(asLocalNoon(date), 'EEEE, d MMMM', { locale: ru }));
}

export function itemDate(item: CalendarFeedItem): string {
  return item.kind === 'EVENT' ? item.occurrenceDate : item.scheduledOn;
}

export function groupByDay(items: readonly CalendarFeedItem[]): Map<string, CalendarFeedItem[]> {
  const days = new Map<string, CalendarFeedItem[]>();
  const push = (date: string, item: CalendarFeedItem) => {
    const list = days.get(date) ?? [];
    list.push(item);
    days.set(date, list);
  };
  for (const item of items) {
    if (item.kind === 'EVENT' && item.allDay && item.endDate > item.startDate) {
      for (let date = item.startDate; date <= item.endDate; date = addIsoDays(date, 1))
        push(date, item);
    } else {
      push(itemDate(item), item);
    }
  }
  return new Map([...days.entries()].sort(([left], [right]) => left.localeCompare(right)));
}
