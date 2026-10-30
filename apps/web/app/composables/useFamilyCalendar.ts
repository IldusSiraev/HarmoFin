import { useApiClient } from './useApiClient.js';
import type { PersonRef } from './useEnvelopePlanV2.js';

// Thin typed client over the v2 calendar API. Times in the feed are already local to the budget
// time zone; amounts are minor-units strings from the server. Nothing here computes money.

export type CalendarRecurrence = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface CalendarEventInput {
  title: string;
  description: string | null;
  allDay: boolean;
  date: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  recurrence: CalendarRecurrence;
  interval: number;
  weekdays: number[];
  repeatUntil: string | null;
  participantUserIds: string[];
  reminderMinutes: number | null;
}

export interface CalendarEventDto {
  id: string;
  title: string;
  description: string | null;
  allDay: boolean;
  date: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  recurrence: CalendarRecurrence;
  interval: number;
  weekdays: number[];
  repeatUntil: string | null;
  reminderMinutes: number | null;
  participants: PersonRef[];
  createdBy: PersonRef;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

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
  recurrence: CalendarRecurrence;
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

export interface CalendarFeedResponse {
  from: string;
  to: string;
  items: CalendarFeedItem[];
}

export interface CalendarFeedQuery {
  from: string;
  to: string;
  participantUserId?: string | undefined;
  includePlans?: boolean | undefined;
}

export function useFamilyCalendar() {
  const api = useApiClient();
  const base = (budgetId: string) => `/api/v2/budgets/${encodeURIComponent(budgetId)}/calendar`;

  return {
    feed(budgetId: string, query: CalendarFeedQuery): Promise<CalendarFeedResponse> {
      const params = new URLSearchParams({ from: query.from, to: query.to });
      if (query.participantUserId) params.set('participantUserId', query.participantUserId);
      if (query.includePlans === false) params.set('includePlans', 'false');
      return api.request<CalendarFeedResponse>(`${base(budgetId)}?${params.toString()}`);
    },
    getEvent(budgetId: string, eventId: string): Promise<CalendarEventDto> {
      return api.request<CalendarEventDto>(
        `${base(budgetId)}/events/${encodeURIComponent(eventId)}`,
      );
    },
    createEvent(
      budgetId: string,
      input: CalendarEventInput,
      key: string,
    ): Promise<CalendarEventDto> {
      return api.request<CalendarEventDto>(`${base(budgetId)}/events`, {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Idempotency-Key': key },
      });
    },
    updateEvent(
      budgetId: string,
      eventId: string,
      input: CalendarEventInput,
      key: string,
    ): Promise<CalendarEventDto> {
      return api.request<CalendarEventDto>(
        `${base(budgetId)}/events/${encodeURIComponent(eventId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(input),
          headers: { 'Idempotency-Key': key },
        },
      );
    },
    async deleteEvent(budgetId: string, eventId: string, key: string): Promise<void> {
      await api.request(`${base(budgetId)}/events/${encodeURIComponent(eventId)}`, {
        method: 'DELETE',
        headers: { 'Idempotency-Key': key },
      });
    },
  };
}
