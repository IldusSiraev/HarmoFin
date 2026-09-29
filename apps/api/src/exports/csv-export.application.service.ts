import { Injectable, UnprocessableEntityException } from '@nestjs/common';

import { formatMinorUnits } from '../common/money/minor-units.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { MetricsRegistry } from '../observability/observability.js';
import { listQuery } from '../transactions/transaction.application.service.js';
import { CsvExportRepository } from './csv-export.repository.js';
import type { ExportTransactionsInput } from './exports.schemas.js';

const exportLimit = 10_000;
const filename = 'harmofin-operations.csv';
const byteOrderMark = String.fromCharCode(0xfeff);
const headers = [
  'ID',
  'Дата',
  'Тип',
  'Статус',
  'Сумма (коп.)',
  'Валюта',
  'Счёт',
  'Категория',
  'Конверт',
  'Источник дохода',
  'Торговая точка',
  'Комментарий',
  'Плановая',
  'Создано',
  'Подтверждено',
  'Отменено',
  'Удалено',
];

export type CsvExportResult = {
  filename: string;
  content: string;
};

type CsvCell = string | { value: string; escapeFormula: boolean };

@Injectable()
export class CsvExportApplicationService {
  constructor(
    private readonly repository: CsvExportRepository,
    private readonly metrics: MetricsRegistry,
    private readonly planModelPolicy?: PlanModelPolicy,
  ) {}

  async exportTransactions(
    userId: string,
    budgetId: string,
    input: ExportTransactionsInput,
  ): Promise<CsvExportResult> {
    await this.requireBudgetPlanModel(userId, budgetId);
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    if (budget.workspace.memberships[0]?.role !== 'OWNER') throw forbidden();

    const query = listQuery({ ...input, limit: exportLimit }, budget);
    if (!(await this.repository.validateJournalReferences(budgetId, query)))
      throw resourceNotFound();

    const rows = await this.repository.listTransactions(userId, budgetId, query, exportLimit + 1);
    if (rows.length > exportLimit) {
      this.metrics.increment('export_failures_total');
      throw exportLimitExceeded();
    }

    return {
      filename,
      content: encodeCsv(
        headers,
        rows.map((row) => [
          row.id,
          dateText(row.occurredOn),
          row.transactionType,
          row.status,
          { value: formatMinorUnits(row.amountMinor), escapeFormula: false },
          row.currency,
          row.account.name,
          row.category.name,
          row.envelope?.name ?? '',
          row.sourceDescription ?? '',
          row.merchantName ?? '',
          row.comment ?? '',
          row.isPlanned ? 'Да' : 'Нет',
          row.createdAt.toISOString(),
          row.confirmedAt?.toISOString() ?? '',
          row.cancelledAt?.toISOString() ?? '',
          row.deletedAt?.toISOString() ?? '',
        ]),
      ),
    };
  }

  private async requireBudgetPlanModel(userId: string, budgetId: string): Promise<void> {
    const policy = this.planModelPolicy;
    if (policy) await policy.requireModel(userId, budgetId, 1);
  }
}

export function encodeCsv(headers: string[], rows: CsvCell[][]): string {
  return `${byteOrderMark}${headers.map((header) => encodeCell(header, false)).join(';')}\r\n${rows
    .map((row) => row.map(encodeCsvCell).join(';'))
    .join('\r\n')}${rows.length > 0 ? '\r\n' : ''}`;
}

function encodeCsvCell(cell: CsvCell): string {
  return typeof cell === 'string'
    ? encodeCell(cell, true)
    : encodeCell(cell.value, cell.escapeFormula);
}

function encodeCell(value: string, escapeFormula: boolean): string {
  const safeValue = escapeFormula && /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safeValue) ? `"${safeValue.replaceAll('"', '""')}"` : safeValue;
}

function dateText(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function exportLimitExceeded(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'EXPORT_LIMIT_EXCEEDED',
    detail: 'Экспорт содержит более 10000 строк. Сузьте фильтры журнала.',
  });
}
