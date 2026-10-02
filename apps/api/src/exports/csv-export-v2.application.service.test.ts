import { describe, expect, it, vi } from 'vitest';

import type { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { MetricsRegistry } from '../observability/observability.js';
import type { LegacyAssignmentHistoryRepository } from '../reports/legacy-assignment-history.repository.js';
import { CsvExportV2ApplicationService } from './csv-export-v2.application.service.js';
import type {
  CsvExportV2Repository,
  ExportAssignmentV2Row,
  ExportTransactionV2Row,
} from './csv-export-v2.repository.js';

const LIMIT = 3;

const transaction = (index: number): ExportTransactionV2Row => ({
  id: `t${index}`,
  accountingModelVersion: 2,
  occurredOn: new Date('2026-03-01T00:00:00.000Z'),
  transactionType: 'EXPENSE',
  status: 'CONFIRMED',
  amountMinor: 1n,
  currency: 'RUB',
  accountName: 'A',
  categoryName: 'C',
  purposeName: null,
  sourceDescription: null,
  merchantName: null,
  comment: null,
  isPlanned: false,
  createdAt: new Date('2026-03-01T00:00:00.000Z'),
  confirmedAt: null,
  cancelledAt: null,
  deletedAt: null,
});
const assignment = (
  index: number,
  sourceKind: 'ASSIGNMENT' | 'MOVEMENT',
): ExportAssignmentV2Row => ({
  sourceKind,
  id: `a${index}`,
  effectiveOn: '2026-03-01',
  assignmentType: null,
  status: 'CONFIRMED',
  amountMinor: 1n,
  envelopeName: null,
  periodStart: null,
  periodEnd: null,
  sourceEnvelopeName: null,
  sourcePeriodStart: null,
  sourcePeriodEnd: null,
  destinationEnvelopeName: null,
  destinationPeriodStart: null,
  destinationPeriodEnd: null,
  sourceIncomeTransactionId: null,
});
const legacy = (index: number) => ({
  sourceKind: 'LEGACY_ALLOCATION' as const,
  id: `l${index}`,
  occurredOn: '2025-12-01',
  amountMinor: 1n,
  status: 'CONFIRMED' as const,
  isDeleted: false,
  isEnvelopeArchived: false,
  envelopeId: null,
  sourceEnvelopeId: null,
  destinationEnvelopeId: null,
  incomeTransactionId: null,
  categoryId: null,
  accountId: null,
});

/** Repositories honour `take` like the real SQL: they never return more rows than requested. */
function build(counts: {
  transactions?: number;
  assignments?: number;
  movements?: number;
  legacy?: number;
}) {
  const tx = { $executeRaw: vi.fn() };
  const prisma = { $transaction: vi.fn((fn: (client: unknown) => unknown) => fn(tx)) };
  const mixed = [
    ...Array.from({ length: counts.assignments ?? 0 }, (_, i) => assignment(i, 'ASSIGNMENT')),
    ...Array.from({ length: counts.movements ?? 0 }, (_, i) => assignment(1000 + i, 'MOVEMENT')),
  ];
  const repository = {
    transactions: vi.fn(async (_tx: unknown, _u: string, _b: string, take: number) =>
      Array.from({ length: counts.transactions ?? 0 }, (_, i) => transaction(i)).slice(0, take),
    ),
    // Real repository takes `take` from each source, then merges: assignments + movements may sum
    // to more than `take`, so no slicing here.
    assignments: vi.fn(async () => mixed),
  };
  const legacyRepository = {
    findAccessibleBudget: vi.fn(async () => ({ id: 'b', workspaceId: 'w' })),
    findActiveRole: vi.fn(async () => 'OWNER'),
    page: vi.fn(async (_tx: unknown, _b: string, _c: unknown, take: number) =>
      Array.from({ length: counts.legacy ?? 0 }, (_, i) => legacy(i)).slice(0, take),
    ),
  };
  const metrics = { increment: vi.fn() };
  const policy = { requireModel: vi.fn(async () => ({})) };
  const service = new CsvExportV2ApplicationService(
    prisma as unknown as PrismaService,
    repository as unknown as CsvExportV2Repository,
    legacyRepository as unknown as LegacyAssignmentHistoryRepository,
    metrics as unknown as MetricsRegistry,
    policy as unknown as PlanModelPolicy,
    LIMIT,
  );
  return { service, metrics };
}

const dataRows = (csv: string) => csv.trimEnd().split('\r\n').length - 1;

describe('CsvExportV2ApplicationService: лимит строк', () => {
  it('transactions: N строк проходит, N+1 даёт 422 EXPORT_LIMIT_EXCEEDED', async () => {
    const ok = build({ transactions: LIMIT });
    expect(dataRows((await ok.service.exportTransactions('u', 'b')).content)).toBe(LIMIT);
    const over = build({ transactions: LIMIT + 5 });
    await expect(over.service.exportTransactions('u', 'b')).rejects.toMatchObject({
      response: { code: 'EXPORT_LIMIT_EXCEEDED' },
      status: 422,
    });
    expect(over.metrics.increment).toHaveBeenCalledWith('export_failures_total');
  });

  it('assignments: N проходит, N+1 даёт 422, в том числе при split assignments + movements', async () => {
    const ok = build({ assignments: 2, movements: 1 });
    expect(dataRows((await ok.service.exportAssignments('u', 'b')).content)).toBe(LIMIT);
    for (const counts of [
      { assignments: LIMIT + 1 },
      { movements: LIMIT + 1 },
      { assignments: 2, movements: 2 },
    ]) {
      const over = build(counts);
      await expect(over.service.exportAssignments('u', 'b')).rejects.toMatchObject({
        status: 422,
        response: { code: 'EXPORT_LIMIT_EXCEEDED' },
      });
    }
  });

  it('legacy-assignments: N проходит, N+1 даёт 422', async () => {
    const ok = build({ legacy: LIMIT });
    expect(dataRows((await ok.service.exportLegacyAssignments('u', 'b')).content)).toBe(LIMIT);
    const over = build({ legacy: LIMIT + 5 });
    await expect(over.service.exportLegacyAssignments('u', 'b')).rejects.toMatchObject({
      status: 422,
      response: { code: 'EXPORT_LIMIT_EXCEEDED' },
    });
  });
});
