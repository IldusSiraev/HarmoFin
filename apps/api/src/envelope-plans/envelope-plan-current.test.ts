import type { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvelopePlanApplicationService } from './envelope-plan.application.service.js';
import { EnvelopePlanRepository } from './envelope-plan.repository.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import type { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';

const settings = { timezone: 'Asia/Yekaterinburg', cycleStartDay: 10, periodBoundaryOffset: 15 };

describe('envelope period current selection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([
    ['2026-11-13T08:00:00Z', '2026-11-10', '2026-11-24', 'FIRST'],
    ['2026-11-25T08:00:00Z', '2026-11-25', '2026-12-09', 'SECOND'],
    ['2026-11-24T20:00:00Z', '2026-11-25', '2026-12-09', 'SECOND'],
    ['2026-11-13T08:00:00Z', '2026-10-25', '2026-11-09', 'NONE'],
    ['2026-11-13T08:00:00Z', '2026-11-25', '2026-12-09', 'NONE'],
    ['2026-11-13T08:00:00Z', '2026-11-10', '2026-11-24', 'SECOND', true],
  ])(
    'marks only the actual half at %s and retains cross-half money',
    async (now, start, end, expected, revised = false) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(now));
      const envelopes = ['FIRST', 'SECOND', 'CUSTOM'].map((slot) => ({
        id: slot,
        periodSlot: slot === 'CUSTOM' ? null : (slot as 'FIRST' | 'SECOND'),
      }));
      const periods = envelopes.map((e) => ({
        id: e.id,
        envelopeId: e.id,
        startsOn: new Date(start),
        endsOn: new Date(end),
        envelope: { periodSlot: e.periodSlot },
      }));
      vi.spyOn(EnvelopePlanRepository.prototype, 'listPeriods').mockResolvedValue(periods);
      vi.spyOn(EnvelopePlanRepository.prototype, 'requireBudgetSettings').mockResolvedValue(
        settings,
      );
      const tx = {
        budget: {
          findUnique: vi.fn().mockResolvedValue(settings),
          findFirst: vi.fn().mockResolvedValue(settings),
        },
        envelope: { findMany: vi.fn().mockResolvedValue(envelopes) },
        budgetCycleRevision: {
          findFirst: vi
            .fn()
            .mockImplementation((query) =>
              Promise.resolve(
                revised && query.where.effectiveOn.lte
                  ? { ...settings, cycleStartDay: 1, periodBoundaryOffset: 10 }
                  : null,
              ),
            ),
        },
      } as unknown as Prisma.TransactionClient;
      const service = new EnvelopePlanApplicationService(
        {} as PrismaService,
        {} as IdempotencyService,
        {} as PlanModelPolicy,
      );
      const rows = envelopes.map((e) => ({
        envelopeId: e.id,
        periodId: e.id,
        funded: 1000n,
        spent: 300n,
        balance: 700n,
      }));
      const result = await service['periodsByEnvelope'](
        tx,
        'budget-id',
        envelopes.map((e) => e.id),
        rows,
      );
      for (const e of envelopes) {
        expect(result.get(e.id)?.[0]).toMatchObject({
          current: e.id === expected || (e.id === 'CUSTOM' && expected !== 'NONE'),
          fundedMinor: '1000',
          spentMinor: '300',
          balanceMinor: '700',
        });
      }
    },
  );
});
