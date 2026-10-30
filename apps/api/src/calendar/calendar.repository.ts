import type { Prisma, PrismaClient } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { findPersonRefs, type PersonRef } from '../common/people/person-ref.repository.js';
import type { CalendarEventData, CalendarEventRow } from './calendar-event.mapper.js';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;

const eventSelect = {
  id: true,
  budgetId: true,
  createdByUserId: true,
  title: true,
  description: true,
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
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  participants: { select: { userId: true }, orderBy: { userId: 'asc' } },
} satisfies Prisma.CalendarEventSelect;

type SelectedEvent = Prisma.CalendarEventGetPayload<{ select: typeof eventSelect }>;
export type StoredCalendarEvent = CalendarEventRow & { createdAt: Date; updatedAt: Date };

export interface CalendarAuditEntry {
  workspaceId: string;
  budgetId: string;
  actorUserId: string;
  entityId: string;
  action: 'CREATED' | 'UPDATED' | 'DELETED';
  oldValues?: Prisma.InputJsonObject;
  newValues?: Prisma.InputJsonObject;
  requestId?: string | undefined;
}

function toRow(event: SelectedEvent): StoredCalendarEvent {
  const { participants, ...rest } = event;
  return { ...rest, participantUserIds: participants.map((item) => item.userId) };
}

const shiftedDate = (value: string, days: number): Date => {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
};

export class CalendarRepository {
  /** Serializes calendar mutations of one budget, like the other stage-B writers. */
  async lockBudget(tx: Tx, budgetId: string): Promise<void> {
    await tx.$queryRaw`
      SELECT "id" FROM "budgets"
      WHERE "id" = ${budgetId}::uuid
      FOR UPDATE
    `;
  }

  async budgetTimezone(db: Db, budgetId: string): Promise<string> {
    const budget = await db.budget.findUniqueOrThrow({
      where: { id: budgetId },
      select: { timezone: true },
    });
    return budget.timezone;
  }

  async findEvent(db: Db, budgetId: string, eventId: string): Promise<StoredCalendarEvent | null> {
    const event = await db.calendarEvent.findFirst({
      where: { id: eventId, budgetId, deletedAt: null },
      select: eventSelect,
    });
    return event ? toRow(event) : null;
  }

  async activeMemberIds(db: Db, workspaceId: string, userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await db.workspaceMembership.findMany({
      where: { workspaceId, userId: { in: userIds }, isActive: true },
      select: { userId: true },
    });
    return new Set(rows.map((row) => row.userId));
  }

  personRefs(db: Db, workspaceId: string, userIds: string[]): Promise<Map<string, PersonRef>> {
    return findPersonRefs(db, workspaceId, userIds);
  }

  async createEvent(
    tx: Tx,
    data: CalendarEventData & {
      id: string;
      workspaceId: string;
      budgetId: string;
      createdByUserId: string;
    },
    participantUserIds: string[],
  ): Promise<StoredCalendarEvent> {
    await tx.calendarEvent.create({ data, select: { id: true } });
    await tx.calendarEventParticipant.createMany({
      data: participantUserIds.map((userId) => ({
        eventId: data.id,
        budgetId: data.budgetId,
        userId,
      })),
    });
    const event = await tx.calendarEvent.findFirstOrThrow({
      where: { id: data.id, budgetId: data.budgetId },
      select: eventSelect,
    });
    return toRow(event);
  }

  async updateEvent(
    tx: Tx,
    budgetId: string,
    eventId: string,
    data: CalendarEventData,
    participantUserIds: string[],
  ): Promise<StoredCalendarEvent> {
    await tx.calendarEventParticipant.deleteMany({ where: { budgetId, eventId } });
    await tx.calendarEventParticipant.createMany({
      data: participantUserIds.map((userId) => ({ eventId, budgetId, userId })),
    });
    await tx.calendarEvent.updateMany({ where: { id: eventId, budgetId }, data });
    const event = await tx.calendarEvent.findFirstOrThrow({
      where: { id: eventId, budgetId },
      select: eventSelect,
    });
    return toRow(event);
  }

  async softDelete(tx: Tx, budgetId: string, eventId: string): Promise<void> {
    await tx.calendarEvent.updateMany({
      where: { id: eventId, budgetId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  async writeAudit(tx: Tx, entry: CalendarAuditEntry): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: entry.actorUserId,
        workspaceId: entry.workspaceId,
        budgetId: entry.budgetId,
        entityType: 'calendar_event',
        entityId: entry.entityId,
        action: entry.action,
        source: 'API',
        requestId: entry.requestId ?? null,
        ...(entry.oldValues ? { oldValues: entry.oldValues } : {}),
        ...(entry.newValues ? { newValues: entry.newValues } : {}),
      },
    });
  }

  /**
   * Candidates whose occurrences may touch the window; expandOccurrences filters exactly.
   * Bounds are widened by a day for time zones and by 32 days for multi-day spans.
   */
  async listForWindow(
    db: Db,
    budgetId: string,
    window: { from: string; to: string },
  ): Promise<StoredCalendarEvent[]> {
    const upper = shiftedDate(window.to, 1);
    const lower = shiftedDate(window.from, -32);
    const events = await db.calendarEvent.findMany({
      where: {
        budgetId,
        deletedAt: null,
        AND: [
          { OR: [{ startsOn: { lte: upper } }, { startsAt: { lte: upper } }] },
          { OR: [{ repeatUntil: null }, { repeatUntil: { gte: lower } }] },
          {
            OR: [
              { recurrence: { not: 'NONE' } },
              { endsOn: { gte: lower } },
              { endsAt: { gte: lower } },
            ],
          },
        ],
      },
      select: eventSelect,
      orderBy: { id: 'asc' },
    });
    return events.map(toRow);
  }
}
