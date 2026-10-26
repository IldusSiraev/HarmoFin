import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { NotificationRuleHandler } from '../../worker/src/notification.handler.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const today = '2026-09-10';
const now = new Date(`${today}T12:00:00.000Z`);
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

type Session = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
  accountId: string;
  envelopeId: string;
  categoryId: string;
  planId: string;
  todayId: string;
  overdueId: string;
  upcomingId: string;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
let v2: Session;
let other: Session;

const notifications = (session: Session) =>
  prisma.notification.findMany({
    where: { budgetId: session.budgetId },
    select: {
      notificationType: true,
      occurrenceId: true,
      resolvedAt: true,
      actionPath: true,
      body: true,
      title: true,
      notificationKey: true,
    },
  });

const open = async (session: Session, type: 'PLAN_TODAY' | 'PLAN_OVERDUE') =>
  (await notifications(session)).filter(
    (item) => item.notificationType === type && item.resolvedAt === null,
  );

describe('v2 notifications', () => {
  beforeAll(async () => {
    app = await createApiApp(
      loadApiConfig({
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        WEB_ORIGIN: origin,
        AUTH_TOKEN_HASH_SECRET: 'test-only-secret-with-at-least-32-bytes',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        MAIL_FROM: 'no-reply@harmofin.test',
        WEB_BASE_URL: origin,
        LOG_LEVEL: 'silent',
      }),
    );
    await app.init();
    server = app.getHttpAdapter().getInstance() as FastifyInstance;
    await server.ready();
    v2 = await register(`v2-notif-${randomUUID()}@harmofin.test`);
    other = await register(`other-notif-${randomUUID()}@harmofin.test`);
    await seed(v2);
    await seed(other);
    await prisma.budget.update({
      where: { id: v2.budgetId },
      data: { planModelVersion: 2, planModelActivatedOn: day('2026-08-01'), timezone: 'UTC' },
    });
  });

  afterAll(async () => {
    await cleanup(v2);
    await cleanup(other);
    await app.close();
    await prisma.$disconnect();
  });

  it('sends due and overdue once for a model 2 budget and no old financial types', async () => {
    const handler = new NotificationRuleHandler(prisma);
    await handler.execute(now, v2.budgetId);
    await handler.execute(now, v2.budgetId);

    const v2Notifications = await notifications(v2);
    expect(v2Notifications.map((item) => item.notificationType).sort()).toEqual([
      'PLAN_OVERDUE',
      'PLAN_TODAY',
    ]);
    expect(
      v2Notifications.some(
        (item) => item.notificationType === 'INSUFFICIENT_MANDATORY_OBLIGATIONS',
      ),
    ).toBe(false);
    expect(v2Notifications.find((item) => item.notificationType === 'PLAN_TODAY')).toMatchObject({
      occurrenceId: v2.todayId,
      actionPath: `/app/plans?occurrence=${v2.todayId}`,
      notificationKey: `occurrence:${v2.todayId}:PLAN_TODAY`,
    });
    expect(v2Notifications.find((item) => item.notificationType === 'PLAN_OVERDUE')).toMatchObject({
      occurrenceId: v2.overdueId,
    });
    expect(JSON.stringify(v2Notifications)).not.toMatch(/\b100\b|1\.00/);
  });

  it('keeps a partially paid occurrence and resolves after full payment', async () => {
    await pay(v2, v2.overdueId, 40n);
    await new NotificationRuleHandler(prisma).execute(now, v2.budgetId);
    expect(await open(v2, 'PLAN_OVERDUE')).toHaveLength(1);

    await pay(v2, v2.overdueId, 60n);
    await new NotificationRuleHandler(prisma).execute(now, v2.budgetId);
    expect(await open(v2, 'PLAN_OVERDUE')).toHaveLength(0);
  });

  it('resolves after skip and after confirmed completion', async () => {
    await prisma.planOccurrence.update({
      where: { id: v2.todayId },
      data: { status: 'SKIPPED', skippedAt: new Date() },
    });
    await new NotificationRuleHandler(prisma).execute(now, v2.budgetId);
    expect(await open(v2, 'PLAN_TODAY')).toHaveLength(0);
    await new NotificationRuleHandler(prisma).execute(now, v2.budgetId);
    expect(
      (await notifications(v2)).filter((item) => item.notificationType === 'PLAN_TODAY'),
    ).toHaveLength(1);

    await prisma.planOccurrence.update({
      where: { id: v2.overdueId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await new NotificationRuleHandler(prisma).execute(now, v2.budgetId);
    expect(await open(v2, 'PLAN_OVERDUE')).toHaveLength(0);
  });

  it('notifies every active OWNER and EDITOR, never a VIEWER, and resolves on payment', async () => {
    const editorId = randomUUID();
    const viewerId = randomUUID();
    await prisma.user.createMany({
      data: [
        { id: editorId, email: `editor-${randomUUID()}@harmofin.test`, passwordHash: 'x' },
        { id: viewerId, email: `viewer-${randomUUID()}@harmofin.test`, passwordHash: 'x' },
      ],
    });
    await prisma.workspaceMembership.createMany({
      data: [
        { id: randomUUID(), workspaceId: v2.workspaceId, userId: editorId, role: 'EDITOR' },
        { id: randomUUID(), workspaceId: v2.workspaceId, userId: viewerId, role: 'VIEWER' },
      ],
    });
    const occurrenceId = randomUUID();
    await prisma.planOccurrence.create({
      data: {
        id: occurrenceId,
        workspaceId: v2.workspaceId,
        budgetId: v2.budgetId,
        planId: v2.planId,
        scheduledOn: day('2026-09-08'),
        planName: 'Аренда',
        planType: 'EXPENSE',
        amountMinor: 100n,
        accountId: v2.accountId,
        categoryId: v2.categoryId,
        envelopeId: v2.envelopeId,
        status: 'DUE',
      },
    });

    await new NotificationRuleHandler(prisma).execute(now, v2.budgetId);

    const overdueRecipients = await prisma.notification.findMany({
      where: {
        budgetId: v2.budgetId,
        notificationType: 'PLAN_OVERDUE',
        occurrenceId,
        resolvedAt: null,
      },
      select: { userId: true },
      orderBy: { userId: 'asc' },
    });
    expect(overdueRecipients).toEqual(
      [{ userId: v2.userId }, { userId: editorId }].sort((a, b) =>
        a.userId.localeCompare(b.userId),
      ),
    );
    expect(overdueRecipients.some((item) => item.userId === viewerId)).toBe(false);

    await pay(v2, occurrenceId, 100n);
    await new NotificationRuleHandler(prisma).execute(now, v2.budgetId);

    const afterPayment = await prisma.notification.findMany({
      where: { budgetId: v2.budgetId, notificationType: 'PLAN_OVERDUE', occurrenceId },
      select: { userId: true, resolvedAt: true },
    });
    expect(afterPayment).toHaveLength(2);
    expect(afterPayment.every((item) => item.resolvedAt !== null)).toBe(true);

    await prisma.notification.deleteMany({
      where: { budgetId: v2.budgetId, userId: { in: [editorId, viewerId] } },
    });
    await prisma.workspaceMembership.deleteMany({
      where: { workspaceId: v2.workspaceId, userId: { in: [editorId, viewerId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [editorId, viewerId] } } });
  });

  it('resolves open notifications of a member demoted to VIEWER or deactivated, with an audit event, and leaves the owner unaffected', async () => {
    const demotedId = randomUUID();
    const deactivatedId = randomUUID();
    await prisma.user.createMany({
      data: [
        { id: demotedId, email: `demoted-${randomUUID()}@harmofin.test`, passwordHash: 'x' },
        {
          id: deactivatedId,
          email: `deactivated-${randomUUID()}@harmofin.test`,
          passwordHash: 'x',
        },
      ],
    });
    const demotedMembershipId = randomUUID();
    const deactivatedMembershipId = randomUUID();
    await prisma.workspaceMembership.createMany({
      data: [
        {
          id: demotedMembershipId,
          workspaceId: v2.workspaceId,
          userId: demotedId,
          role: 'EDITOR',
        },
        {
          id: deactivatedMembershipId,
          workspaceId: v2.workspaceId,
          userId: deactivatedId,
          role: 'EDITOR',
        },
      ],
    });
    const occurrenceId = randomUUID();
    await prisma.planOccurrence.create({
      data: {
        id: occurrenceId,
        workspaceId: v2.workspaceId,
        budgetId: v2.budgetId,
        planId: v2.planId,
        scheduledOn: day('2026-09-07'),
        planName: 'Аренда',
        planType: 'EXPENSE',
        amountMinor: 100n,
        accountId: v2.accountId,
        categoryId: v2.categoryId,
        envelopeId: v2.envelopeId,
        status: 'DUE',
      },
    });

    // Both are EDITORs first: each gets the open overdue notification.
    await new NotificationRuleHandler(prisma).execute(now, v2.budgetId);
    const beforeChange = await prisma.notification.findMany({
      where: { budgetId: v2.budgetId, notificationType: 'PLAN_OVERDUE', occurrenceId },
      select: { userId: true, resolvedAt: true },
    });
    expect(beforeChange.filter((item) => item.resolvedAt === null)).toHaveLength(3);

    // Demote one to VIEWER, deactivate the other's membership.
    await prisma.workspaceMembership.update({
      where: { id: demotedMembershipId },
      data: { role: 'VIEWER' },
    });
    await prisma.workspaceMembership.update({
      where: { id: deactivatedMembershipId },
      data: { isActive: false },
    });

    await new NotificationRuleHandler(prisma).execute(now, v2.budgetId);

    const afterChange = await prisma.notification.findMany({
      where: { budgetId: v2.budgetId, notificationType: 'PLAN_OVERDUE', occurrenceId },
      select: { userId: true, resolvedAt: true },
    });
    const ownerRow = afterChange.find((item) => item.userId === v2.userId);
    const demotedRow = afterChange.find((item) => item.userId === demotedId);
    const deactivatedRow = afterChange.find((item) => item.userId === deactivatedId);
    expect(ownerRow?.resolvedAt).toBeNull();
    expect(demotedRow?.resolvedAt).not.toBeNull();
    expect(deactivatedRow?.resolvedAt).not.toBeNull();

    const audit = await prisma.auditEvent.findMany({
      where: {
        workspaceId: v2.workspaceId,
        entityType: 'notification',
        action: 'RESOLVED',
      },
      select: { entityId: true },
    });
    const auditedNotificationIds = new Set(audit.map((item) => item.entityId));
    const demotedNotification = await prisma.notification.findFirst({
      where: { budgetId: v2.budgetId, userId: demotedId, occurrenceId },
      select: { id: true },
    });
    const deactivatedNotification = await prisma.notification.findFirst({
      where: { budgetId: v2.budgetId, userId: deactivatedId, occurrenceId },
      select: { id: true },
    });
    expect(auditedNotificationIds.has(demotedNotification?.id as string)).toBe(true);
    expect(auditedNotificationIds.has(deactivatedNotification?.id as string)).toBe(true);

    await prisma.notification.deleteMany({
      where: { budgetId: v2.budgetId, userId: { in: [demotedId, deactivatedId] } },
    });
    await prisma.workspaceMembership.deleteMany({
      where: { workspaceId: v2.workspaceId, userId: { in: [demotedId, deactivatedId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [demotedId, deactivatedId] } } });
  });

  it('shows the inbox only to the budget member', async () => {
    const own = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${v2.budgetId}/notifications`,
      cookies: { harmofin_session: v2.cookie },
    });
    const foreign = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${v2.budgetId}/notifications`,
      cookies: { harmofin_session: other.cookie },
    });
    expect(own.statusCode).toBe(200);
    expect(foreign.statusCode).toBe(404);
  });

  async function pay(session: Session, occurrenceId: string, amount: bigint) {
    const transactionId = randomUUID();
    await prisma.transaction.create({
      data: {
        id: transactionId,
        budgetId: session.budgetId,
        transactionType: 'EXPENSE',
        status: 'CONFIRMED',
        amountMinor: amount,
        occurredOn: day(today),
        accountId: session.accountId,
        categoryId: session.categoryId,
        envelopeId: session.envelopeId,
        confirmedAt: new Date(),
        createdByUserId: session.userId,
        updatedByUserId: session.userId,
      },
    });
    await prisma.planPayment.create({
      data: { id: randomUUID(), budgetId: session.budgetId, occurrenceId, transactionId },
    });
  }

  async function seed(session: Session) {
    session.accountId = randomUUID();
    session.envelopeId = randomUUID();
    session.categoryId = randomUUID();
    session.planId = randomUUID();
    const incomeCategoryId = randomUUID();
    await prisma.account.create({
      data: {
        id: session.accountId,
        budgetId: session.budgetId,
        ownerUserId: session.userId,
        name: 'Минусовый счёт',
        accountType: 'CASH',
        startingBalanceMinor: -1_000n,
        accountingStartDate: day(today),
      },
    });
    await prisma.envelope.create({
      data: {
        id: session.envelopeId,
        budgetId: session.budgetId,
        ownerUserId: session.userId,
        name: 'Обязательные',
        envelopeType: 'MANDATORY_EXPENSES',
        startingBalanceMinor: -50n,
        displayOrder: 0,
      },
    });
    await prisma.category.createMany({
      data: [
        {
          id: session.categoryId,
          budgetId: session.budgetId,
          name: 'Аренда',
          categoryType: 'EXPENSE',
          displayOrder: 0,
        },
        {
          id: incomeCategoryId,
          budgetId: session.budgetId,
          name: 'Доход',
          categoryType: 'INCOME',
          displayOrder: 1,
        },
      ],
    });
    await prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId: session.budgetId,
        transactionType: 'INCOME',
        status: 'CONFIRMED',
        amountMinor: 500n,
        occurredOn: day(today),
        accountId: session.accountId,
        categoryId: incomeCategoryId,
        confirmedAt: day(today),
        createdByUserId: session.userId,
        updatedByUserId: session.userId,
      },
    });
    await prisma.regularPlan.create({
      data: {
        id: session.planId,
        workspaceId: session.workspaceId,
        budgetId: session.budgetId,
        ownerUserId: session.userId,
        name: 'Аренда',
        planType: 'EXPENSE',
        amountMinor: 100n,
        anchorOn: day(today),
        startOn: day(today),
        recurrence: 'MONTHLY',
        accountId: session.accountId,
        categoryId: session.categoryId,
        envelopeId: session.envelopeId,
        createdByUserId: session.userId,
        updatedByUserId: session.userId,
      },
    });
    const occurrence = async (scheduledOn: string, status: 'PENDING' | 'DUE') => {
      const id = randomUUID();
      await prisma.planOccurrence.create({
        data: {
          id,
          workspaceId: session.workspaceId,
          budgetId: session.budgetId,
          planId: session.planId,
          scheduledOn: day(scheduledOn),
          planName: 'Аренда',
          planType: 'EXPENSE',
          amountMinor: 100n,
          accountId: session.accountId,
          categoryId: session.categoryId,
          envelopeId: session.envelopeId,
          status,
        },
      });
      return id;
    };
    session.todayId = await occurrence(today, 'DUE');
    session.upcomingId = await occurrence('2026-09-13', 'PENDING');
    session.overdueId = await occurrence('2026-09-09', 'DUE');
  }

  async function register(email: string): Promise<Session> {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload: { email, password },
    });
    const body = response.json<{
      user: { id: string };
      workspace: { id: string };
      budget: { id: string };
    }>();
    const cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value;
    if (!cookie) throw new Error('Missing session cookie');
    return {
      userId: body.user.id,
      workspaceId: body.workspace.id,
      budgetId: body.budget.id,
      cookie,
    } as Session;
  }

  async function cleanup(session: Session) {
    const budgetIds = (
      await prisma.budget.findMany({
        where: { workspaceId: session.workspaceId },
        select: { id: true },
      })
    ).map((budget) => budget.id);
    await prisma.auditEvent.deleteMany({ where: { workspaceId: session.workspaceId } });
    await prisma.notification.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.planPayment.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.planOccurrence.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.regularPlan.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.incomeAllocation.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.transaction.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.account.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.category.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.envelope.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId: session.workspaceId } });
    await prisma.budget.deleteMany({ where: { id: { in: budgetIds } } });
    await prisma.workspace.deleteMany({ where: { id: session.workspaceId } });
    await prisma.session.deleteMany({ where: { userId: session.userId } });
    await prisma.user.deleteMany({ where: { id: session.userId } });
  }
});
