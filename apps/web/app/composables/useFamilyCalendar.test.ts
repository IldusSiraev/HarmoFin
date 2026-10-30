import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('./useApiClient.js', () => ({ useApiClient: () => ({ request }) }));

import { useFamilyCalendar, type CalendarEventInput } from './useFamilyCalendar.js';

const input: CalendarEventInput = {
  title: 'Кружок',
  description: null,
  allDay: false,
  date: '2026-11-03',
  endDate: null,
  startTime: '17:00',
  endTime: '18:30',
  recurrence: 'WEEKLY',
  interval: 1,
  weekdays: [2],
  repeatUntil: null,
  participantUserIds: [],
  reminderMinutes: 60,
};

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({});
});

describe('useFamilyCalendar', () => {
  it('reads the feed with the range, the person filter and the payments flag', async () => {
    await useFamilyCalendar().feed('budget id', {
      from: '2026-10-26',
      to: '2026-12-06',
      participantUserId: 'user-1',
      includePlans: false,
    });
    expect(request).toHaveBeenCalledWith(
      '/api/v2/budgets/budget%20id/calendar?from=2026-10-26&to=2026-12-06&participantUserId=user-1&includePlans=false',
    );
  });

  it('omits optional query parameters', async () => {
    await useFamilyCalendar().feed('b', { from: '2026-11-01', to: '2026-11-14' });
    expect(request).toHaveBeenCalledWith(
      '/api/v2/budgets/b/calendar?from=2026-11-01&to=2026-11-14',
    );
  });

  it('creates, updates and deletes with an Idempotency-Key', async () => {
    const calendar = useFamilyCalendar();
    await calendar.createEvent('b', input, 'key-1');
    expect(request).toHaveBeenCalledWith('/api/v2/budgets/b/calendar/events', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'Idempotency-Key': 'key-1' },
    });
    await calendar.updateEvent('b', 'e 1', input, 'key-2');
    expect(request).toHaveBeenCalledWith('/api/v2/budgets/b/calendar/events/e%201', {
      method: 'PATCH',
      body: JSON.stringify(input),
      headers: { 'Idempotency-Key': 'key-2' },
    });
    await calendar.deleteEvent('b', 'e1', 'key-3');
    expect(request).toHaveBeenCalledWith('/api/v2/budgets/b/calendar/events/e1', {
      method: 'DELETE',
      headers: { 'Idempotency-Key': 'key-3' },
    });
  });
});
