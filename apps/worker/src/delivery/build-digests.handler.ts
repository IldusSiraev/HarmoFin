import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import type { WorkerJobHandler } from '../job-runner.js';
import { digestDedupeKey, digestSlot, digestWindowStart } from './digest-schedule.js';

export const DELIVERY_RETENTION_MS = 90 * 86_400_000;

/**
 * Queues one digest per user and budget per slot. The unique dedupe key makes reruns and overlapping
 * runs no-ops. Only the window is stored; the content is built when the letter is sent. Also drops
 * finished queue rows older than 90 days (their unsubscribe links expire with them). `budgetId`
 * narrows the run to one budget (tests); the cleanup then runs for that budget only.
 */
export class BuildEmailDigestsHandler implements WorkerJobHandler {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(now: Date, budgetId?: string): Promise<void> {
    const settings = await this.prisma.notificationChannelSetting.findMany({
      where: {
        channel: 'EMAIL',
        enabled: true,
        digestFrequency: { not: 'OFF' },
        user: { status: 'ACTIVE', emailVerifiedAt: { not: null } },
      },
      select: { userId: true, digestFrequency: true },
    });

    for (const setting of settings) {
      const frequency = setting.digestFrequency === 'WEEKLY' ? 'WEEKLY' : 'DAILY';
      const memberships = await this.prisma.workspaceMembership.findMany({
        where: { userId: setting.userId, isActive: true, workspace: { status: 'ACTIVE' } },
        select: {
          workspaceId: true,
          workspace: {
            select: {
              budgets: {
                where: {
                  status: 'ACTIVE',
                  planModelVersion: 2,
                  ...(budgetId ? { id: budgetId } : {}),
                },
                select: { id: true, timezone: true },
              },
            },
          },
        },
      });
      for (const membership of memberships) {
        for (const budget of membership.workspace.budgets) {
          const localDate = digestSlot(now, budget.timezone, frequency);
          if (!localDate) continue;
          const previous = await this.prisma.notificationDelivery.findFirst({
            where: {
              userId: setting.userId,
              budgetId: budget.id,
              kind: 'DIGEST',
              status: { in: ['SENT', 'CANCELLED'] },
            },
            orderBy: { digestPeriodEnd: 'desc' },
            select: { digestPeriodEnd: true },
          });
          await this.prisma.notificationDelivery.createMany({
            data: {
              id: randomUUID(),
              workspaceId: membership.workspaceId,
              budgetId: budget.id,
              userId: setting.userId,
              channel: 'EMAIL',
              kind: 'DIGEST',
              digestPeriodStart: digestWindowStart(
                now,
                frequency,
                previous?.digestPeriodEnd ?? null,
              ),
              digestPeriodEnd: now,
              dedupeKey: digestDedupeKey(frequency, localDate),
              nextAttemptAt: now,
            },
            skipDuplicates: true,
          });
        }
      }
    }

    await this.prisma.notificationDelivery.deleteMany({
      where: {
        status: { in: ['SENT', 'CANCELLED', 'FAILED'] },
        updatedAt: { lt: new Date(now.getTime() - DELIVERY_RETENTION_MS) },
        ...(budgetId ? { budgetId } : {}),
      },
    });
  }
}
