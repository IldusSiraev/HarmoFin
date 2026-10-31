import { randomUUID } from 'node:crypto';

import type { Prisma, PrismaClient } from '@prisma/client';

import { expandOccurrences, type RecurringEvent } from './calendar-recurrence.js';
import { enqueueUrgentEmail } from './delivery/enqueue.js';
import type { WorkerJobHandler } from './job-runner.js';
import {
  isReminderDue,
  reminderBody,
  reminderKey,
  reminderMoment,
  reminderWindow,
} from './calendar-reminder.js';
import { utcToLocal } from './zoned-time.js';

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

export type CalendarReminderFailure = { eventId: string; errorName: string };

const reminderEventSelect = {
  id: true,
  workspaceId: true,
  budgetId: true,
  createdByUserId: true,
  title: true,
  allDay: true,
  startsOn: true,
  endsOn: true,
  startsAt: true,
  endsAt: true,
  recurrence: true,
  interval: true,
  weekdays: true,
  repeatUntil: true,
  reminderMinutes: true,
  budget: { select: { timezone: true } },
  participants: { select: { userId: true } },
} satisfies Prisma.CalendarEventSelect;

type ReminderEvent = Prisma.CalendarEventGetPayload<{ select: typeof reminderEventSelect }>;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'Unknown error';
}

type StoredRule = {
  allDay: boolean;
  startsOn: Date | null;
  endsOn: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  recurrence: RecurringEvent['recurrence'];
  interval: number;
  weekdays: number[];
  repeatUntil: Date | null;
};

function toRule(event: StoredRule, timezone: string): RecurringEvent {
  const shared = {
    recurrence: event.recurrence,
    interval: event.interval,
    weekdays: event.weekdays,
    repeatUntil: event.repeatUntil ? isoDate(event.repeatUntil) : null,
  };
  if (event.allDay) {
    return {
      ...shared,
      allDay: true,
      startDate: isoDate(event.startsOn!),
      endDate: isoDate(event.endsOn!),
      startTime: null,
      durationMinutes: 0,
    };
  }
  const start = utcToLocal(event.startsAt!, timezone);
  return {
    ...shared,
    allDay: false,
    startDate: start.date,
    endDate: utcToLocal(event.endsAt!, timezone).date,
    startTime: start.time,
    durationMinutes: Math.round((event.endsAt!.getTime() - event.startsAt!.getTime()) / 60_000),
  };
}

/**
 * In-app reminders for calendar events. Occurrences are expanded on the fly (none are stored);
 * the notification key turns a rerun or an overlapping run into a no-op. Only the event title and
 * the date go into the notification: no description, no participant names.
 *
 * Follows NotificationRuleHandler: all reminder inserts and audits of one event run inside a single
 * `$transaction`, a notification is inserted one at a time (`createMany` with a single row and
 * `skipDuplicates: true`), and an AuditEvent is written only for the insert that actually created a
 * row (`result.count === 1`), never for a duplicate that the unique key skipped. A failure anywhere
 * in the transaction rolls back every write for that event; nothing is committed half-written.
 *
 * Events are isolated from each other, as in AccountPurgeHandler: a failure while processing one
 * event is reported through `onFailure` (event id and error class name only, never the title or
 * description) and the run moves on to the next event. The job itself still completes, so one broken
 * event cannot drive the recurring job into its terminal FAILED state; the next run retries that
 * event and the notification key keeps the retry idempotent. A failure of the event query itself
 * still rejects, so the job is retried as before.
 *
 * Срочное письмо ставится в очередь в той же транзакции, только для только что созданного
 * уведомления.
 */
export class CalendarReminderHandler implements WorkerJobHandler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly onFailure?: (failure: CalendarReminderFailure) => void,
  ) {}

  async execute(now: Date): Promise<void> {
    const events = await this.prisma.calendarEvent.findMany({
      where: {
        deletedAt: null,
        reminderMinutes: { not: null },
        budget: { status: 'ACTIVE', planModelVersion: 2, workspace: { status: 'ACTIVE' } },
      },
      select: reminderEventSelect,
    });

    for (const event of events) {
      try {
        await this.remindEvent(event, now);
      } catch (error) {
        this.onFailure?.({ eventId: event.id, errorName: errorName(error) });
      }
    }
  }

  private async remindEvent(event: ReminderEvent, now: Date): Promise<void> {
    const minutes = event.reminderMinutes!;
    const timezone = event.budget.timezone;
    const due = expandOccurrences(
      toRule(event, timezone),
      reminderWindow(now, minutes, timezone),
      timezone,
    ).filter((occurrence) => isReminderDue(reminderMoment(occurrence, minutes, timezone), now));
    if (due.length === 0) return;

    const candidates = [
      ...new Set([event.createdByUserId, ...event.participants.map((item) => item.userId)]),
    ];
    const recipients = await this.prisma.workspaceMembership.findMany({
      where: { workspaceId: event.workspaceId, userId: { in: candidates }, isActive: true },
      select: { userId: true },
    });
    if (recipients.length === 0) return;

    await this.prisma.$transaction(async (tx) => {
      for (const occurrence of due) {
        const body = reminderBody(occurrence, now, timezone);
        const notificationKey = reminderKey(event.id, occurrence.occurrenceDate, minutes);
        const actionPath = `/app/calendar?date=${occurrence.startDate}`;
        for (const { userId } of recipients) {
          await this.createReminder(tx, event, {
            userId,
            body,
            notificationKey,
            actionPath,
          });
        }
      }
    });
  }

  private async createReminder(
    tx: Prisma.TransactionClient,
    event: {
      id: string;
      workspaceId: string;
      budgetId: string;
      title: string;
    },
    values: { userId: string; body: string; notificationKey: string; actionPath: string },
  ): Promise<void> {
    const notificationId = randomUUID();
    const result = await tx.notification.createMany({
      data: {
        id: notificationId,
        workspaceId: event.workspaceId,
        budgetId: event.budgetId,
        userId: values.userId,
        notificationType: 'CALENDAR_REMINDER',
        relatedEntityType: 'calendar_event',
        relatedEntityId: event.id,
        title: event.title,
        body: values.body,
        actionPath: values.actionPath,
        notificationKey: values.notificationKey,
      },
      skipDuplicates: true,
    });
    if (result.count !== 1) return;
    await enqueueUrgentEmail(tx, {
      notificationId,
      workspaceId: event.workspaceId,
      budgetId: event.budgetId,
      userId: values.userId,
      now: new Date(),
    });
    await tx.auditEvent.create({
      data: {
        id: randomUUID(),
        actorUserId: null,
        workspaceId: event.workspaceId,
        budgetId: event.budgetId,
        entityType: 'notification',
        entityId: notificationId,
        action: 'CREATED',
        source: 'WORKER',
        newValues: {
          notificationType: 'CALENDAR_REMINDER',
          relatedEntityType: 'calendar_event',
          relatedEntityId: event.id,
          actionPath: values.actionPath,
          state: 'CREATED',
        },
      },
    });
  }
}
