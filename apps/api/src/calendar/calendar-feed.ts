import type { PersonRef } from '../common/people/person-ref.repository.js';

export interface CalendarFeedEventItem {
  kind: 'EVENT';
  eventId: string;
  occurrenceDate: string;
  title: string;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  startsAt: string | null;
  endsAt: string | null;
  recurrence: string;
  participants: PersonRef[];
  createdBy: PersonRef;
  canEdit: boolean;
}

export interface CalendarFeedPlanItem {
  kind: 'PLAN';
  occurrenceId: string;
  planId: string;
  planKind: 'OBLIGATION' | 'INCOME_PLAN';
  title: string;
  amountMinor: string;
  status: string;
  isOverdue: boolean;
  scheduledOn: string;
  owner: PersonRef;
}

export type CalendarFeedItem = CalendarFeedEventItem | CalendarFeedPlanItem;

const dateOf = (item: CalendarFeedItem): string =>
  item.kind === 'EVENT' ? item.occurrenceDate : item.scheduledOn;
const timeOf = (item: CalendarFeedItem): string | null =>
  item.kind === 'EVENT' && !item.allDay ? item.startTime : null;

/** Day by day; inside a day items without time (all-day events, payments) first, then by time, then title. */
export function sortFeed(items: CalendarFeedItem[]): CalendarFeedItem[] {
  return [...items].sort((left, right) => {
    const byDate = dateOf(left).localeCompare(dateOf(right));
    if (byDate !== 0) return byDate;
    const leftTime = timeOf(left);
    const rightTime = timeOf(right);
    if (leftTime === null && rightTime !== null) return -1;
    if (leftTime !== null && rightTime === null) return 1;
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
      return leftTime.localeCompare(rightTime);
    }
    return left.title.localeCompare(right.title, 'ru');
  });
}

export function monthsOf(window: { from: string; to: string }): string[] {
  const months: string[] = [];
  let [year, month] = window.from.slice(0, 7).split('-').map(Number) as [number, number];
  const last = window.to.slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    months.push(key);
    if (key >= last) return months;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
}
