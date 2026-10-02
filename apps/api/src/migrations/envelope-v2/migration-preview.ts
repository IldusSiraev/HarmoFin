import type { Prisma, PrismaClient } from '@prisma/client';

import { assertIsoDate, cycleAndPeriodFor } from '../../cycles/cycle-period.domain.js';
import { preflight, type PreflightReport } from './preflight.js';

export type FundingRuleType =
  'MANUAL' | 'SUM_OF_PLANS' | 'FIXED_PER_PERIOD' | 'SUGGESTED_FIXED' | 'PERCENT_OF_INCOME';

export type OwnerChoices = {
  fingerprint?: string;
  assignments: Array<{ envelopeId: string; periodStart?: string; openingMinor: string }>;
  periodTargets: Array<{ envelopeId: string; periodStart: string; targetMinor: string | null }>;
  fundingRules: Array<{
    envelopeId: string;
    type: FundingRuleType;
    priority: number;
    fixedMinor?: string;
    percentBasisPoints?: number;
  }>;
};

export type MigrationPreview = {
  fingerprint: string;
  assignments: Array<{
    envelopeId: string;
    periodStart: string | null;
    openingMinor: string;
    sourceKind: 'OPENING';
  }>;
  periodTargets: Array<{ envelopeId: string; periodStart: string; targetMinor: string | null }>;
  fundingRules: Array<{
    envelopeId: string;
    type: FundingRuleType;
    priority: number;
    fixedMinor?: string;
    percentBasisPoints?: number;
    mandatory: boolean;
  }>;
  totalCashMinor: string;
  freeToAssignMinor: string;
  unbackedMinor: string;
  blockers: string[];
};

const RULE_TYPES: readonly FundingRuleType[] = [
  'MANUAL',
  'SUM_OF_PLANS',
  'FIXED_PER_PERIOD',
  'SUGGESTED_FIXED',
  'PERCENT_OF_INCOME',
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIVE_MINOR = /^[1-9][0-9]*$/;
const NON_NEGATIVE_MINOR = /^(0|[1-9][0-9]*)$/;

/** Fresh preflight and preview in one RepeatableRead read-only transaction. */
export function runPreview(
  prisma: PrismaClient,
  budgetId: string,
  choices: OwnerChoices,
): Promise<MigrationPreview> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return previewMigration(tx, budgetId, await preflight(tx, budgetId), choices);
    },
    { isolationLevel: 'RepeatableRead', maxWait: 60_000, timeout: 60_000 },
  );
}

export async function previewMigration(
  tx: Prisma.TransactionClient,
  budgetId: string,
  report: PreflightReport,
  choices: OwnerChoices,
): Promise<MigrationPreview> {
  const blockers = new Set<string>(report.blockers);
  const current = await preflight(tx, budgetId);
  if (current.fingerprint !== report.fingerprint) blockers.add('STALE_PREFLIGHT');
  if (choices.fingerprint !== undefined && choices.fingerprint !== report.fingerprint) {
    blockers.add('FINGERPRINT_MISMATCH');
  }

  const budget = await tx.budget.findUniqueOrThrow({
    where: { id: budgetId },
    select: { cycleStartDay: true, periodBoundaryOffset: true, timezone: true },
  });
  const ids = [
    ...choices.assignments.map((row) => row.envelopeId),
    ...choices.periodTargets.map((row) => row.envelopeId),
    ...choices.fundingRules.map((row) => row.envelopeId),
  ];
  const envelopes = new Map(
    (
      await tx.envelope.findMany({
        where: { budgetId, id: { in: [...new Set(ids.filter((id) => UUID.test(id)))] } },
        select: { id: true, archivedAt: true, envelopeType: true, periodSlot: true },
      })
    ).map((row) => [row.id, row]),
  );

  const activeEnvelope = (envelopeId: string) => {
    const envelope = envelopes.get(envelopeId);
    if (!envelope) {
      blockers.add('ENVELOPE_NOT_FOUND');
      return null;
    }
    if (envelope.archivedAt !== null) {
      blockers.add('ENVELOPE_ARCHIVED');
      return null;
    }
    return envelope;
  };
  const checkPeriod = (envelopeId: string, periodStart: string) => {
    const envelope = envelopes.get(envelopeId);
    let period;
    try {
      assertIsoDate(periodStart);
      period = cycleAndPeriodFor(budget, periodStart).period;
    } catch {
      blockers.add('PERIOD_NOT_IN_CYCLE');
      return;
    }
    if (period.start !== periodStart) blockers.add('PERIOD_NOT_IN_CYCLE');
    else if (envelope?.periodSlot && envelope.periodSlot !== period.id) {
      blockers.add('PERIOD_SLOT_MISMATCH');
    }
  };

  const assignments: MigrationPreview['assignments'] = [];
  const seenAssignments = new Set<string>();
  let assigned = 0n;
  for (const row of choices.assignments) {
    const envelope = activeEnvelope(row.envelopeId);
    if (row.periodStart !== undefined) checkPeriod(row.envelopeId, row.periodStart);
    const key = `${row.envelopeId}|${row.periodStart ?? ''}`;
    if (seenAssignments.has(key)) blockers.add('DUPLICATE_ASSIGNMENT');
    seenAssignments.add(key);
    if (typeof row.openingMinor !== 'string' || !POSITIVE_MINOR.test(row.openingMinor)) {
      blockers.add('INVALID_AMOUNT');
      continue;
    }
    assigned += BigInt(row.openingMinor);
    if (envelope) {
      assignments.push({
        envelopeId: row.envelopeId,
        periodStart: row.periodStart ?? null,
        openingMinor: row.openingMinor,
        sourceKind: 'OPENING',
      });
    }
  }

  const periodTargets: MigrationPreview['periodTargets'] = [];
  const seenTargets = new Set<string>();
  for (const row of choices.periodTargets) {
    const envelope = activeEnvelope(row.envelopeId);
    checkPeriod(row.envelopeId, row.periodStart);
    const key = `${row.envelopeId}|${row.periodStart}`;
    if (seenTargets.has(key)) blockers.add('DUPLICATE_PERIOD_TARGET');
    seenTargets.add(key);
    if (
      row.targetMinor !== null &&
      (typeof row.targetMinor !== 'string' || !NON_NEGATIVE_MINOR.test(row.targetMinor))
    ) {
      blockers.add('INVALID_AMOUNT');
      continue;
    }
    if (envelope) {
      periodTargets.push({
        envelopeId: row.envelopeId,
        periodStart: row.periodStart,
        targetMinor: row.targetMinor,
      });
    }
  }

  const fundingRules: MigrationPreview['fundingRules'] = [];
  const seenPriorities = new Set<string>();
  for (const row of choices.fundingRules) {
    const envelope = activeEnvelope(row.envelopeId);
    const key = `${row.envelopeId}|${row.priority}`;
    if (seenPriorities.has(key)) blockers.add('DUPLICATE_FUNDING_PRIORITY');
    seenPriorities.add(key);
    if (!ruleShapeValid(row)) {
      blockers.add('INVALID_FUNDING_RULE');
      continue;
    }
    if (row.type === 'SUM_OF_PLANS' && envelope && envelope.envelopeType !== 'MANDATORY_EXPENSES') {
      blockers.add('FUNDING_RULE_TYPE_NOT_ALLOWED');
    }
    if (envelope) {
      fundingRules.push({
        envelopeId: row.envelopeId,
        type: row.type,
        priority: row.priority,
        ...(row.fixedMinor !== undefined ? { fixedMinor: row.fixedMinor } : {}),
        ...(row.percentBasisPoints !== undefined
          ? { percentBasisPoints: row.percentBasisPoints }
          : {}),
        mandatory: row.type === 'SUM_OF_PLANS',
      });
    }
  }

  const percentTotal = fundingRules
    .filter((rule) => rule.type === 'PERCENT_OF_INCOME')
    .reduce((sum, rule) => sum + (rule.percentBasisPoints ?? 0), 0);
  if (percentTotal > 10_000) blockers.add('PERCENT_TOTAL_EXCEEDS');

  const cash = BigInt(report.totalCashMinor);
  if (cash < 0n) blockers.add('NEGATIVE_TOTAL_CASH');
  const unbacked = assigned > cash ? assigned - cash : 0n;
  if (unbacked > 0n) blockers.add('ASSIGNMENTS_EXCEED_CASH');

  return {
    fingerprint: report.fingerprint,
    assignments,
    periodTargets,
    fundingRules,
    totalCashMinor: report.totalCashMinor,
    freeToAssignMinor: (unbacked > 0n || cash < 0n ? 0n : cash - assigned).toString(),
    unbackedMinor: unbacked.toString(),
    blockers: [...blockers],
  };
}

function ruleShapeValid(row: OwnerChoices['fundingRules'][number]): boolean {
  if (!RULE_TYPES.includes(row.type)) return false;
  if (!Number.isInteger(row.priority) || row.priority < 0) return false;
  const hasFixed = row.fixedMinor !== undefined;
  const hasPercent = row.percentBasisPoints !== undefined;
  if (row.type === 'FIXED_PER_PERIOD' || row.type === 'SUGGESTED_FIXED') {
    return (
      !hasPercent &&
      hasFixed &&
      typeof row.fixedMinor === 'string' &&
      POSITIVE_MINOR.test(row.fixedMinor)
    );
  }
  if (row.type === 'PERCENT_OF_INCOME') {
    return (
      !hasFixed &&
      Number.isInteger(row.percentBasisPoints) &&
      row.percentBasisPoints! >= 0 &&
      row.percentBasisPoints! <= 10_000
    );
  }
  return !hasFixed && !hasPercent;
}

function rub(minor: string): string {
  const value = BigInt(minor);
  const abs = value < 0n ? -value : value;
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${value < 0n ? '-' : ''}${abs / 100n}.${fraction} ₽`;
}

export function formatPreviewRu(preview: MigrationPreview): string {
  const lines = [
    'Предпросмотр перехода на модель конвертов v2',
    `Фактические деньги на счетах: ${rub(preview.totalCashMinor)}`,
    `Начальные назначения (по вашему выбору): ${preview.assignments.length}`,
    ...preview.assignments.map(
      (a) =>
        `  - конверт ${a.envelopeId}${a.periodStart ? `, период с ${a.periodStart}` : ''}: ${rub(a.openingMinor)}`,
    ),
    `Цели периодов: ${preview.periodTargets.length}`,
    ...preview.periodTargets.map(
      (t) =>
        `  - конверт ${t.envelopeId}, период с ${t.periodStart}: ${t.targetMinor === null ? 'без цели' : rub(t.targetMinor)}`,
    ),
    `Правила пополнения: ${preview.fundingRules.length} (без выбора действует MANUAL)`,
    ...preview.fundingRules.map(
      (r) => `  - конверт ${r.envelopeId}: ${r.type}, приоритет ${r.priority}`,
    ),
    `Свободно для распределения: ${rub(preview.freeToAssignMinor)}`,
    `Не обеспечено деньгами: ${rub(preview.unbackedMinor)}`,
    preview.blockers.length > 0
      ? `Переход невозможен, причины: ${preview.blockers.join(', ')}`
      : 'Блокирующих причин нет. Старые распределения и переводы между конвертами не переносятся.',
    `Отпечаток данных: ${preview.fingerprint}`,
  ];
  return lines.join('\n');
}
