import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { formatMinorUnits } from '../common/money/minor-units.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { MetricsRegistry } from '../observability/observability.js';
import { LegacyAssignmentHistoryRepository } from '../reports/legacy-assignment-history.repository.js';
import { encodeCsv, type CsvExportResult } from './csv-export.application.service.js';
import { CsvExportV2Repository } from './csv-export-v2.repository.js';

export const exportV2Limit = 10_000;
const TX_OPTIONS = { maxWait: 5_000, timeout: 30_000 } as const;
const LEGACY_LABEL = 'Устаревшая семантика v1: не входит в остаток и «Свободно» модели 2';

const transactionHeaders = [
  'ID',
  'Модель',
  'Дата',
  'Тип',
  'Статус',
  'Сумма (коп.)',
  'Валюта',
  'Счёт',
  'Категория',
  'Назначение',
  'Источник дохода',
  'Торговая точка',
  'Комментарий',
  'Плановая',
  'Создано',
  'Подтверждено',
  'Отменено',
  'Удалено',
];
const assignmentHeaders = [
  'ID',
  'Вид источника',
  'Тип назначения',
  'Дата',
  'Статус',
  'Сумма (коп.)',
  'Назначение',
  'Период с',
  'Период по',
  'Откуда',
  'Период откуда с',
  'Период откуда по',
  'Куда',
  'Период куда с',
  'Период куда по',
  'ID дохода',
];
const legacyHeaders = [
  'ID',
  'Вид источника',
  'Дата',
  'Статус',
  'Сумма (коп.)',
  'Удалено',
  'Конверт архивирован',
  'ID конверта',
  'ID конверта-источника',
  'ID конверта-получателя',
  'ID дохода',
  'ID категории',
  'ID счёта',
  'Семантика',
];

const money = (value: bigint) => ({ value: formatMinorUnits(value), escapeFormula: false });
const yesNo = (value: boolean) => (value ? 'Да' : 'Нет');
const iso = (value: Date | null) => value?.toISOString() ?? '';

/**
 * OWNER-only CSV exports of a model-2 budget. Role, model and budget access are checked before
 * any data query; all reads share one REPEATABLE READ, READ ONLY snapshot. Files are built in
 * memory and never persisted. More than `limit` rows fails with 422 EXPORT_LIMIT_EXCEEDED.
 */
@Injectable()
export class CsvExportV2ApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: CsvExportV2Repository,
    private readonly legacyRepository: LegacyAssignmentHistoryRepository,
    private readonly metrics: MetricsRegistry,
    private readonly planModelPolicy: PlanModelPolicy,
    private readonly limit: number = exportV2Limit,
  ) {}

  exportTransactions(userId: string, budgetId: string): Promise<CsvExportResult> {
    return this.run(userId, budgetId, async (tx) => {
      const rows = await this.repository.transactions(tx, userId, budgetId, this.limit + 1);
      this.assertLimit(rows.length);
      return {
        filename: 'harmofin-transactions-v2.csv',
        content: encodeCsv(
          transactionHeaders,
          rows.map((row) => [
            row.id,
            String(row.accountingModelVersion),
            row.occurredOn.toISOString().slice(0, 10),
            row.transactionType,
            row.status,
            money(row.amountMinor),
            row.currency,
            row.accountName,
            row.categoryName,
            row.purposeName ?? '',
            row.sourceDescription ?? '',
            row.merchantName ?? '',
            row.comment ?? '',
            yesNo(row.isPlanned),
            row.createdAt.toISOString(),
            iso(row.confirmedAt),
            iso(row.cancelledAt),
            iso(row.deletedAt),
          ]),
        ),
      };
    });
  }

  exportAssignments(userId: string, budgetId: string): Promise<CsvExportResult> {
    return this.run(userId, budgetId, async (tx) => {
      const rows = await this.repository.assignments(tx, userId, budgetId, this.limit + 1);
      this.assertLimit(rows.length);
      return {
        filename: 'harmofin-assignments-v2.csv',
        content: encodeCsv(
          assignmentHeaders,
          rows.map((row) => [
            row.id,
            row.sourceKind,
            row.assignmentType ?? '',
            row.effectiveOn,
            row.status,
            money(row.amountMinor),
            row.envelopeName ?? '',
            row.periodStart ?? '',
            row.periodEnd ?? '',
            row.sourceEnvelopeName ?? '',
            row.sourcePeriodStart ?? '',
            row.sourcePeriodEnd ?? '',
            row.destinationEnvelopeName ?? '',
            row.destinationPeriodStart ?? '',
            row.destinationPeriodEnd ?? '',
            row.sourceIncomeTransactionId ?? '',
          ]),
        ),
      };
    });
  }

  exportLegacyAssignments(userId: string, budgetId: string): Promise<CsvExportResult> {
    return this.run(userId, budgetId, async (tx) => {
      const rows = await this.legacyRepository.page(tx, budgetId, undefined, this.limit + 1);
      this.assertLimit(rows.length);
      return {
        filename: 'harmofin-legacy-assignments-v1.csv',
        content: encodeCsv(
          legacyHeaders,
          rows.map((row) => [
            row.id,
            row.sourceKind,
            row.occurredOn,
            row.status,
            money(row.amountMinor),
            yesNo(row.isDeleted),
            yesNo(row.isEnvelopeArchived),
            row.envelopeId ?? '',
            row.sourceEnvelopeId ?? '',
            row.destinationEnvelopeId ?? '',
            row.incomeTransactionId ?? '',
            row.categoryId ?? '',
            row.accountId ?? '',
            LEGACY_LABEL,
          ]),
        ),
      };
    });
  }

  private async run(
    userId: string,
    budgetId: string,
    read: (tx: Prisma.TransactionClient) => Promise<CsvExportResult>,
  ): Promise<CsvExportResult> {
    await this.planModelPolicy.requireModel(userId, budgetId, 2);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const budget = await this.legacyRepository.findAccessibleBudget(tx, userId, budgetId);
        if (!budget) throw resourceNotFound();
        const role = await this.legacyRepository.findActiveRole(tx, budget.workspaceId, userId);
        if (role !== 'OWNER') throw forbidden();
        return read(tx);
      },
      { ...TX_OPTIONS, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private assertLimit(count: number): void {
    if (count <= this.limit) return;
    this.metrics.increment('export_failures_total');
    throw new UnprocessableEntityException({
      code: 'EXPORT_LIMIT_EXCEEDED',
      detail: `Экспорт содержит более ${this.limit} строк.`,
    });
  }
}
