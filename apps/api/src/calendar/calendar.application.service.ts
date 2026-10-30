import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { personRefOf, type PersonRef } from '../common/people/person-ref.repository.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { findAccessActor, requireAccessActor } from '../common/policies/access-actor.repository.js';
import { BudgetAccessPolicy, type AccessActor } from '../common/policies/budget-access.policy.js';
import { resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import type { PrismaService } from '../database/prisma.service.js';
import { toEventData, toLocalFields } from './calendar-event.mapper.js';
import { participantNotMember } from './calendar.errors.js';
import { CalendarRepository, type StoredCalendarEvent } from './calendar.repository.js';
import type { CalendarEventInput } from './calendar.schemas.js';

type Tx = Prisma.TransactionClient;

export interface CalendarEventView {
  id: string;
  title: string;
  description: string | null;
  allDay: boolean;
  date: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  recurrence: string;
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

type Write = (
  tx: Tx,
  actor: AccessActor,
  workspaceId: string,
) => Promise<{ status: number; event: StoredCalendarEvent }>;

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);
const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Rule fields only: no title, description or participant names in the audit payload. */
function auditValues(event: StoredCalendarEvent): Prisma.InputJsonObject {
  return {
    allDay: event.allDay,
    startsOn: event.startsOn?.toISOString() ?? null,
    startsAt: event.startsAt?.toISOString() ?? null,
    recurrence: event.recurrence,
    interval: event.interval,
    weekdays: event.weekdays,
    repeatUntil: event.repeatUntil?.toISOString() ?? null,
    reminderMinutes: event.reminderMinutes,
    participantCount: event.participantUserIds.length,
  };
}

@Injectable()
export class CalendarApplicationService {
  protected readonly repository = new CalendarRepository();
  protected readonly access = new BudgetAccessPolicy();

  constructor(
    protected readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    protected readonly planModelPolicy: PlanModelPolicy,
  ) {}

  async getEvent(userId: string, budgetId: string, eventId: string): Promise<CalendarEventView> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    return this.prisma.$transaction(async (tx) => {
      const actor = await findAccessActor(tx, model.workspaceId, userId);
      if (!actor) throw resourceNotFound();
      const event = await this.repository.findEvent(tx, budgetId, eventId);
      if (!event) throw resourceNotFound();
      return this.view(tx, model.workspaceId, budgetId, event, actor);
    });
  }

  createEvent(
    userId: string,
    budgetId: string,
    input: CalendarEventInput,
    key: string,
    requestId?: string,
  ): Promise<CalendarEventView> {
    return this.mutate(
      userId,
      budgetId,
      key,
      'calendar.event.create',
      input,
      async (tx, actor, workspaceId) => {
        this.access.requireWriter(actor);
        await this.requireParticipants(tx, workspaceId, input.participantUserIds);
        const timezone = await this.repository.budgetTimezone(tx, budgetId);
        const event = await this.repository.createEvent(
          tx,
          {
            ...toEventData(input, timezone),
            id: createUuidV7(),
            workspaceId,
            budgetId,
            createdByUserId: userId,
          },
          input.participantUserIds,
        );
        await this.repository.writeAudit(tx, {
          workspaceId,
          budgetId,
          actorUserId: userId,
          entityId: event.id,
          action: 'CREATED',
          newValues: auditValues(event),
          requestId,
        });
        return { status: 201, event };
      },
    );
  }

  updateEvent(
    userId: string,
    budgetId: string,
    eventId: string,
    input: CalendarEventInput,
    key: string,
    requestId?: string,
  ): Promise<CalendarEventView> {
    return this.mutate(
      userId,
      budgetId,
      key,
      `calendar.event.update:${eventId}`,
      input,
      async (tx, actor, workspaceId) => {
        const current = await this.repository.findEvent(tx, budgetId, eventId);
        if (!current) throw resourceNotFound();
        this.access.requireEventAuthor(actor, current);
        await this.requireParticipants(tx, workspaceId, input.participantUserIds);
        const timezone = await this.repository.budgetTimezone(tx, budgetId);
        const event = await this.repository.updateEvent(
          tx,
          budgetId,
          eventId,
          toEventData(input, timezone),
          input.participantUserIds,
        );
        await this.repository.writeAudit(tx, {
          workspaceId,
          budgetId,
          actorUserId: userId,
          entityId: eventId,
          action: 'UPDATED',
          oldValues: auditValues(current),
          newValues: auditValues(event),
          requestId,
        });
        return { status: 200, event };
      },
    );
  }

  async deleteEvent(
    userId: string,
    budgetId: string,
    eventId: string,
    key: string,
    requestId?: string,
  ): Promise<void> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    await this.prisma.$transaction(async (tx) => {
      await this.repository.lockBudget(tx, budgetId);
      await this.idempotency.execute<Record<string, never>>(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key,
          operation: `calendar.event.delete:${eventId}`,
          requestHash: hash({ eventId }),
        },
        async () => {
          const actor = await requireAccessActor(tx, model.workspaceId, userId);
          const current = await this.repository.findEvent(tx, budgetId, eventId);
          if (!current) throw resourceNotFound();
          this.access.requireEventAuthor(actor, current);
          await this.repository.softDelete(tx, budgetId, eventId);
          await this.repository.writeAudit(tx, {
            workspaceId: model.workspaceId,
            budgetId,
            actorUserId: userId,
            entityId: eventId,
            action: 'DELETED',
            oldValues: auditValues(current),
            requestId,
          });
          return { status: 204, body: {} };
        },
      );
    });
  }

  protected async view(
    tx: Tx,
    workspaceId: string,
    budgetId: string,
    event: StoredCalendarEvent,
    actor: AccessActor,
  ): Promise<CalendarEventView> {
    const timezone = await this.repository.budgetTimezone(tx, budgetId);
    const people = await this.repository.personRefs(tx, workspaceId, [
      event.createdByUserId,
      ...event.participantUserIds,
    ]);
    return {
      id: event.id,
      title: event.title,
      description: event.description,
      allDay: event.allDay,
      ...toLocalFields(event, timezone),
      recurrence: event.recurrence,
      interval: event.interval,
      weekdays: event.weekdays,
      repeatUntil: event.repeatUntil ? isoDate(event.repeatUntil) : null,
      reminderMinutes: event.reminderMinutes,
      participants: event.participantUserIds.map((id) => personRefOf(people, id)),
      createdBy: personRefOf(people, event.createdByUserId),
      canEdit: this.access.canEditEvent(actor, event),
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    };
  }

  private async mutate(
    userId: string,
    budgetId: string,
    key: string,
    operation: string,
    input: CalendarEventInput,
    write: Write,
  ): Promise<CalendarEventView> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.repository.lockBudget(tx, budgetId);
      return this.idempotency.execute<CalendarEventView & Record<string, unknown>>(
        tx,
        { budgetId, actorUserId: userId, key, operation, requestHash: hash(input) },
        async () => {
          const actor = await requireAccessActor(tx, model.workspaceId, userId);
          const { status, event } = await write(tx, actor, model.workspaceId);
          const body = await this.view(tx, model.workspaceId, budgetId, event, actor);
          return { status, body: body as CalendarEventView & Record<string, unknown> };
        },
      );
    });
    return result.body;
  }

  private async requireParticipants(tx: Tx, workspaceId: string, userIds: string[]): Promise<void> {
    const active = await this.repository.activeMemberIds(tx, workspaceId, userIds);
    if (userIds.some((id) => !active.has(id))) throw participantNotMember();
  }
}
