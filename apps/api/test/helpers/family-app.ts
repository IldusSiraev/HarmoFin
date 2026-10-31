import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { PrismaClient } from '@prisma/client';

import { createUuidV7 } from '../../src/common/identifiers/uuid-v7.js';
import { createApiApp } from '../../src/app.js';
import { loadApiConfig } from '../../src/config/env.js';

export const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const origin = 'http://localhost:3000';
const password = 'correct-password-10';

export interface FamilyActor {
  user: { id: string; email: string };
  cookie: string;
  csrfToken: string;
  /** Workspace and budget this actor works in (the family's, after `join`). */
  workspaceId: string;
  budgetId: string;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export class FamilyTestApp {
  readonly prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  server!: FastifyInstance;
  private app!: NestFastifyApplication;
  private readonly userIds = new Set<string>();

  async start(): Promise<void> {
    this.app = await createApiApp(
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
    await this.app.init();
    this.server = this.app.getHttpAdapter().getInstance() as FastifyInstance;
    await this.server.ready();
  }

  async register(): Promise<FamilyActor> {
    const email = `family-${randomUUID()}@harmofin.test`;
    const response = await this.server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload: { email, password },
    });
    const body = response.json<{
      user: { id: string; email: string };
      workspace: { id: string };
      budget: { id: string };
      csrfToken: string;
    }>();
    const cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value;
    if (!cookie) throw new Error(`Registration failed: ${response.statusCode} ${response.body}`);
    this.userIds.add(body.user.id);
    return {
      user: body.user,
      cookie,
      csrfToken: body.csrfToken,
      workspaceId: body.workspace.id,
      budgetId: body.budget.id,
    };
  }

  /** Adds `member` to the creator's family and returns the member pointed at that family. */
  async join(
    creator: FamilyActor,
    member: FamilyActor,
    role: 'EDITOR' | 'VIEWER',
  ): Promise<FamilyActor> {
    await this.prisma.workspaceMembership.create({
      data: { id: createUuidV7(), workspaceId: creator.workspaceId, userId: member.user.id, role },
    });
    await this.prisma.user.update({
      where: { id: member.user.id },
      data: { displayName: `Участник ${member.user.email.slice(7, 13)}` },
    });
    return { ...member, workspaceId: creator.workspaceId, budgetId: creator.budgetId };
  }

  inject(method: Method, url: string, actor: FamilyActor, payload?: Record<string, unknown>) {
    const headers: Record<string, string> = { origin };
    if (method !== 'GET') {
      headers['x-csrf-token'] = actor.csrfToken;
      headers['idempotency-key'] = `family-${randomUUID()}`;
    }
    const options: InjectOptions = {
      method,
      url,
      headers,
      cookies: { harmofin_session: actor.cookie },
    };
    if (payload !== undefined) options.payload = payload;
    return this.server.inject(options);
  }

  /** Creates an account through the API as `actor`; returns its id. */
  async createAccount(actor: FamilyActor, name: string, startingBalance = '0'): Promise<string> {
    const response = await this.inject(
      'POST',
      `/api/v1/budgets/${actor.budgetId}/accounts`,
      actor,
      {
        name,
        accountType: 'CASH',
        currency: 'RUB',
        startingBalance,
        accountingStartDate: '2026-01-01',
      },
    );
    if (response.statusCode !== 201)
      throw new Error(`createAccount ${response.statusCode} ${response.body}`);
    return response.json<{ id: string }>().id;
  }

  /** Creates a CUSTOM envelope through the API as `actor`; returns its id. */
  async createEnvelope(actor: FamilyActor, name: string): Promise<string> {
    const response = await this.inject(
      'POST',
      `/api/v2/budgets/${actor.budgetId}/envelopes`,
      actor,
      {
        name,
        envelopeType: 'CUSTOM',
      },
    );
    if (response.statusCode !== 201)
      throw new Error(`createEnvelope ${response.statusCode} ${response.body}`);
    return response.json<{ id: string }>().id;
  }

  /** Any active category of the budget with the given type (registration seeds defaults). */
  async categoryId(budgetId: string, type: 'INCOME' | 'EXPENSE'): Promise<string> {
    const category = await this.prisma.category.findFirst({
      where: { budgetId, categoryType: type, archivedAt: null },
      select: { id: true },
    });
    if (category) return category.id;
    const created = await this.prisma.category.create({
      data: {
        id: createUuidV7(),
        budgetId,
        name: `${type}-${randomUUID().slice(0, 8)}`,
        categoryType: type,
        displayOrder: 1,
      },
      select: { id: true },
    });
    return created.id;
  }

  /** Records a confirmed income or expense through the API as `actor`; returns its id. */
  async record(
    actor: FamilyActor,
    input: { type: 'INCOME' | 'EXPENSE'; accountId: string; amount: string; envelopeId?: string },
  ): Promise<string> {
    const response = await this.inject(
      'POST',
      `/api/v2/budgets/${actor.budgetId}/transactions`,
      actor,
      {
        transactionType: input.type,
        status: 'CONFIRMED',
        amount: input.amount,
        occurredOn: new Date().toISOString().slice(0, 10),
        accountId: input.accountId,
        categoryId: await this.categoryId(actor.budgetId, input.type),
        envelopeId: input.envelopeId ?? null,
      },
    );
    if (response.statusCode !== 201)
      throw new Error(`record ${response.statusCode} ${response.body}`);
    return response.json<{ id: string }>().id;
  }

  async stop(): Promise<void> {
    // Delete every row created for the registered users' workspaces, children first.
    await this.cleanup();
    await this.app.close();
    await this.prisma.$disconnect();
  }

  private async cleanup(): Promise<void> {
    const workspaceIds = new Set<string>();
    for (const userId of this.userIds) {
      for (const { workspaceId } of await this.prisma.workspaceMembership.findMany({
        where: { userId },
        select: { workspaceId: true },
      })) {
        workspaceIds.add(workspaceId);
      }
    }
    const ids = [...workspaceIds];
    const budgetIds = (
      await this.prisma.budget.findMany({
        where: { workspaceId: { in: ids } },
        select: { id: true },
      })
    ).map((budget) => budget.id);
    const byBudget = { budgetId: { in: budgetIds } };
    await this.prisma.notificationDelivery.deleteMany({ where: { workspaceId: { in: ids } } });
    await this.prisma.activityFeedCursor.deleteMany({ where: byBudget });
    await this.prisma.notification.deleteMany({ where: { workspaceId: { in: ids } } });
    await this.prisma.idempotencyRecord.deleteMany({ where: byBudget });
    await this.prisma.envelopeMovement.deleteMany({ where: byBudget });
    await this.prisma.envelopeAssignment.deleteMany({ where: byBudget });
    await this.prisma.planPayment.deleteMany({ where: byBudget });
    await this.prisma.planOccurrence.deleteMany({ where: byBudget });
    await this.prisma.regularPlan.deleteMany({ where: byBudget });
    await this.prisma.incomeAllocation.deleteMany({ where: byBudget });
    await this.prisma.transferPart.deleteMany({ where: byBudget });
    await this.prisma.transfer.deleteMany({ where: byBudget });
    await this.prisma.transaction.deleteMany({ where: byBudget });
    await this.prisma.envelopeFundingRule.deleteMany({ where: byBudget });
    await this.prisma.envelopePeriod.deleteMany({ where: byBudget });
    await this.prisma.budgetCycleRevision.deleteMany({ where: byBudget });
    await this.prisma.workspaceInvitation.deleteMany({ where: { workspaceId: { in: ids } } });
    await this.prisma.auditEvent.deleteMany({ where: { workspaceId: { in: ids } } });
    await this.prisma.budget.updateMany({
      where: { id: { in: budgetIds } },
      data: { incomeAllocationSourceCategoryId: null, incomeAllocationTargetEnvelopeId: null },
    });
    await this.prisma.account.deleteMany({ where: byBudget });
    await this.prisma.envelope.deleteMany({ where: byBudget });
    await this.prisma.category.deleteMany({ where: byBudget });
    await this.prisma.budget.deleteMany({ where: { id: { in: budgetIds } } });
    for (const userId of this.userIds) {
      await this.prisma.notificationDelivery.deleteMany({ where: { userId } });
      await this.prisma.notificationChannelSetting.deleteMany({ where: { userId } });
      await this.prisma.emailVerificationToken.deleteMany({ where: { userId } });
      await this.prisma.session.deleteMany({ where: { userId } });
      await this.prisma.recoveryToken.deleteMany({ where: { userId } });
      await this.prisma.userConsent.deleteMany({ where: { userId } });
    }
    await this.prisma.workspaceMembership.deleteMany({ where: { workspaceId: { in: ids } } });
    await this.prisma.workspace.deleteMany({ where: { id: { in: ids } } });
    await this.prisma.user.deleteMany({ where: { id: { in: [...this.userIds] } } });
  }
}
