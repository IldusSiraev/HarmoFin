import { describe, expect, it } from 'vitest';

import { monthsOf, sortFeed, type CalendarFeedItem } from './calendar-feed.js';

const person = { userId: 'u', displayName: 'Алия', isActiveMember: true };
const event = (title: string, date: string, startTime: string | null): CalendarFeedItem => ({
  kind: 'EVENT',
  eventId: title,
  occurrenceDate: date,
  title,
  allDay: startTime === null,
  startDate: date,
  endDate: date,
  startTime,
  endTime: startTime,
  startsAt: null,
  endsAt: null,
  recurrence: 'NONE',
  participants: [],
  createdBy: person,
  canEdit: false,
});
const plan = (title: string, date: string): CalendarFeedItem => ({
  kind: 'PLAN',
  occurrenceId: title,
  planId: title,
  planKind: 'OBLIGATION',
  title,
  amountMinor: '100',
  status: 'PENDING',
  isOverdue: false,
  scheduledOn: date,
  owner: person,
});

describe('sortFeed', () => {
  it('orders by date, then items without time, then time, then title', () => {
    const sorted = sortFeed([
      event('Кино', '2026-10-30', '19:30'),
      event('Завтрак', '2026-10-30', '09:30'),
      plan('Школа', '2026-10-30'),
      event('Поездка', '2026-10-31', null),
      event('Аптека', '2026-10-30', null),
    ]);
    expect(sorted.map((item) => item.title)).toEqual([
      'Аптека',
      'Школа',
      'Завтрак',
      'Кино',
      'Поездка',
    ]);
  });
});

describe('monthsOf', () => {
  it('lists every month the window touches', () => {
    expect(monthsOf({ from: '2026-10-26', to: '2026-12-06' })).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    expect(monthsOf({ from: '2026-12-20', to: '2027-01-10' })).toEqual(['2026-12', '2027-01']);
    expect(monthsOf({ from: '2026-11-01', to: '2026-11-30' })).toEqual(['2026-11']);
  });
});
