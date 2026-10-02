import { createHash, randomUUID } from 'node:crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

import { createUuidV7 } from '../../common/identifiers/uuid-v7.js';
import { FinancialBalanceRepository } from '../../common/finance/financial-balance.repository.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { RolePolicy } from '../../common/policies/role-policy.js';
import { cycleAndPeriodFor, todayInTimezone } from '../../cycles/cycle-period.domain.js';
import { AssignmentRepository } from '../../envelope-plans/assignment.repository.js';
import { FundingRuleRepository } from '../../envelope-plans/funding-rule.repository.js';
import { previewMigration, type OwnerChoices } from './migration-preview.js';
import { preflight } from './preflight.js';

// Reserved: must never be set in the API or worker environment, or their sessions
// would be excluded from the freeze check.
export const CUTOVER_APPLICATION_NAME = 'harmofin-v2-cutover';
export const CUTOVER_IDEMPOTENCY_KEY = 'envelope-v2-cutover';
const CUTOVER_OPERATION = 'envelope-v2-cutover';
const MAX_SERIALIZATION_RETRIES = 3;

export class CutoverError extends Error {
  constructor(
    readonly code: string,
    readonly blockers: string[] = [],
  ) {
    super(code);
    this.name = 'CutoverError';
  }
}

export type CutoverParams = {
  budgetId: string;
  ownerId: string;
  approvedFingerprint: string;
  approvedAssignments: OwnerChoices['assignments'];
  approvedPeriodTargets: OwnerChoices['periodTargets'];
  approvedFundingRules: OwnerChoices['fundingRules'];
  dryRun: boolean;
};

export type CutoverResult = {
  beforeCash: string;
  afterCash: string;
  modelVersion: number;
  assignmentCount: number;
};

export type CutoverDeps = {
  checkFreeze?: (tx: Prisma.TransactionClient) => Promise<void>;
  /** Test seam: runs after all writes, before commit. */
  afterWrites?: () => Promise<void>;
  requestId?: string;
  now?: () => Date;
};

export type ForeignSession = { pid: number; applicationName: string };

/**
 * Sessions of this database that are not proven to be the cutover tool itself. Rows whose
 * database or application name are hidden by PostgreSQL privileges count as foreign.
 */
export async function foreignSessions(
  tx: Prisma.TransactionClient,
  selfApplicationName: string = CUTOVER_APPLICATION_NAME,
): Promise<ForeignSession[]> {
  return tx.$queryRaw<ForeignSession[]>`
    SELECT activity."pid"::int AS "pid", COALESCE(activity."application_name", '') AS "applicationName"
    FROM "pg_stat_activity" AS activity
    WHERE activity."backend_type" = 'client backend'
      AND activity."pid" <> pg_backend_pid()
      AND (activity."datname" = current_database() OR activity."datname" IS NULL)
      AND COALESCE(activity."application_name", '') <> ${selfApplicationName}
  `;
}

async function requireFreeze(tx: Prisma.TransactionClient): Promise<void> {
  let sessions: ForeignSession[];
  try {
    sessions = await foreignSessions(tx);
  } catch {
    throw new CutoverError('MAINTENANCE_FREEZE_NOT_PROVEN');
  }
  if (sessions.length > 0) throw new CutoverError('MAINTENANCE_FREEZE_NOT_PROVEN');
}

const idempotency = new IdempotencyService();
const rolePolicy = new RolePolicy();
const assignments = new AssignmentRepository();
const rules = new FundingRuleRepository();

export async function cutover(
  prisma: PrismaClient,
  params: CutoverParams,
  deps: CutoverDeps = {},
): Promise<CutoverResult> {
  return params.dryRun ? dryRun(prisma, params) : apply(prisma, params, deps);
}

function choicesOf(params: CutoverParams): OwnerChoices {
  return {
    fingerprint: params.approvedFingerprint,
    assignments: params.approvedAssignments,
    periodTargets: params.approvedPeriodTargets,
    fundingRules: params.approvedFundingRules,
  };
}

/** Validation only. It neither checks ownership nor proves the maintenance freeze. */
async function dryRun(prisma: PrismaClient, params: CutoverParams): Promise<CutoverResult> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const { report, preview } = await validate(tx, params);
      return {
        beforeCash: report.totalCashMinor,
        afterCash: report.totalCashMinor,
        modelVersion: 1,
        assignmentCount: preview.assignments.length,
      };
    },
    { isolationLevel: 'RepeatableRead', maxWait: 60_000, timeout: 60_000 },
  );
}

async function validate(tx: Prisma.TransactionClient, params: CutoverParams) {
  let report;
  try {
    report = await preflight(tx, params.budgetId);
  } catch (error) {
    if (
      error instanceof Error &&
      ['PLAN_MODEL_NOT_V1', 'BUDGET_NOT_FOUND'].includes(error.message)
    ) {
      throw new CutoverError(error.message);
    }
    throw error;
  }
  if (report.fingerprint !== params.approvedFingerprint)
    throw new CutoverError('STALE_FINGERPRINT');

  const choices = choicesOf(params);
  const preview = await previewMigration(tx, params.budgetId, report, choices);
  const blockers = [...preview.blockers];
  const perEnvelope = new Map<string, number>();
  for (const rule of params.approvedFundingRules) {
    perEnvelope.set(rule.envelopeId, (perEnvelope.get(rule.envelopeId) ?? 0) + 1);
  }
  if ([...perEnvelope.values()].some((count) => count > 1)) {
    blockers.push('MULTIPLE_RULES_PER_ENVELOPE');
  }
  const sumRuleEnvelopes = params.approvedFundingRules
    .filter((rule) => rule.type === 'SUM_OF_PLANS')
    .map((rule) => rule.envelopeId);
  if (sumRuleEnvelopes.length > 0) {
    const savings = await tx.regularPlan.count({
      where: {
        budgetId: params.budgetId,
        envelopeId: { in: sumRuleEnvelopes },
        planType: 'SAVINGS',
        isActive: true,
        deletedAt: null,
      },
    });
    if (savings > 0) blockers.push('SAVINGS_PLAN_DOUBLE_CONTRIBUTION');
  }
  if (blockers.length > 0) throw new CutoverError('PREVIEW_BLOCKED', blockers);
  return { report, preview };
}

function requestHash(params: CutoverParams): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        fingerprint: params.approvedFingerprint,
        assignments: params.approvedAssignments,
        periodTargets: params.approvedPeriodTargets,
        fundingRules: params.approvedFundingRules,
      }),
    )
    .digest('hex');
}

function isSerializationConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  return error.code === 'P2010' && (error.meta as { code?: unknown } | undefined)?.code === '40001';
}

async function apply(
  prisma: PrismaClient,
  params: CutoverParams,
  deps: CutoverDeps,
): Promise<CutoverResult> {
  const requestId = deps.requestId ?? randomUUID();
  for (let attempt = 1; ; attempt += 1) {
    try {
      const outcome = await prisma.$transaction(
        async (tx) => {
          await assignments.lockBudget(tx, params.budgetId);
          return idempotency.execute<CutoverResult>(
            tx,
            {
              budgetId: params.budgetId,
              actorUserId: params.ownerId,
              key: CUTOVER_IDEMPOTENCY_KEY,
              operation: CUTOVER_OPERATION,
              requestHash: requestHash(params),
            },
            async () => ({ status: 200, body: await write(tx, params, deps, requestId) }),
          );
        },
        { isolationLevel: 'Serializable', maxWait: 60_000, timeout: 120_000 },
      );
      return outcome.body;
    } catch (error) {
      if (!isSerializationConflict(error) || attempt >= MAX_SERIALIZATION_RETRIES) throw error;
    }
  }
}

async function write(
  tx: Prisma.TransactionClient,
  params: CutoverParams,
  deps: CutoverDeps,
  requestId: string,
): Promise<CutoverResult> {
  const budget = await tx.budget.findUnique({
    where: { id: params.budgetId },
    select: {
      workspaceId: true,
      timezone: true,
      cycleStartDay: true,
      periodBoundaryOffset: true,
    },
  });
  if (!budget) throw new CutoverError('BUDGET_NOT_FOUND');
  const membership = await tx.workspaceMembership.findFirst({
    where: { workspaceId: budget.workspaceId, userId: params.ownerId, isActive: true },
    select: { role: true },
  });
  if (!membership || !rolePolicy.canManage(membership.role))
    throw new CutoverError('OWNER_REQUIRED');

  await (deps.checkFreeze ?? requireFreeze)(tx);
  const { report, preview } = await validate(tx, params);

  const actor = { workspaceId: budget.workspaceId, userId: params.ownerId, requestId };
  const cutoverDate = todayInTimezone((deps.now ?? (() => new Date()))(), budget.timezone);

  const periodIds = new Map<string, string>();
  const periodKeys = new Set<string>();
  for (const row of [...preview.assignments, ...preview.periodTargets]) {
    if (row.periodStart !== null) periodKeys.add(`${row.envelopeId}|${row.periodStart}`);
  }
  for (const key of [...periodKeys].sort()) {
    const [envelopeId, periodStart] = key.split('|') as [string, string];
    const range = cycleAndPeriodFor(budget, periodStart).period;
    const opened = await rules.getOrCreatePeriod(
      tx,
      params.budgetId,
      envelopeId,
      range.start,
      range.end,
      actor,
    );
    periodIds.set(key, opened.id);
    const target = preview.periodTargets.find(
      (row) => row.envelopeId === envelopeId && row.periodStart === periodStart,
    );
    if (target && target.targetMinor !== null) {
      await rules.applyTarget(tx, {
        budgetId: params.budgetId,
        workspaceId: budget.workspaceId,
        actorUserId: params.ownerId,
        period: opened,
        targetMinor: BigInt(target.targetMinor),
        requestId,
      });
    }
  }

  for (const rule of preview.fundingRules) {
    await rules.saveRule(tx, {
      budgetId: params.budgetId,
      workspaceId: budget.workspaceId,
      actorUserId: params.ownerId,
      envelopeId: rule.envelopeId,
      type: rule.type,
      priority: rule.priority,
      fixedMinor: rule.fixedMinor === undefined ? null : BigInt(rule.fixedMinor),
      percentBasisPoints: rule.percentBasisPoints ?? null,
      requestId,
    });
  }

  for (const row of preview.assignments) {
    await assignments.createAssignment(tx, {
      budgetId: params.budgetId,
      workspaceId: budget.workspaceId,
      actorUserId: params.ownerId,
      envelopeId: row.envelopeId,
      periodId:
        row.periodStart === null
          ? null
          : (periodIds.get(`${row.envelopeId}|${row.periodStart}`) ?? null),
      sourceKind: 'OPENING',
      amountMinor: BigInt(row.openingMinor),
      effectiveOn: new Date(`${cutoverDate}T00:00:00.000Z`),
      sourceIncomeTransactionId: null,
      requestId,
    });
  }

  await tx.budget.update({
    where: { id: params.budgetId },
    data: { planModelVersion: 2, planModelActivatedOn: new Date(`${cutoverDate}T00:00:00.000Z`) },
  });
  await tx.auditEvent.create({
    data: {
      id: createUuidV7(),
      actorUserId: params.ownerId,
      workspaceId: budget.workspaceId,
      budgetId: params.budgetId,
      entityType: 'budget',
      entityId: params.budgetId,
      action: 'ENVELOPE_V2_CUTOVER',
      source: 'CLI',
      requestId,
      oldValues: { planModelVersion: 1 },
      newValues: {
        planModelVersion: 2,
        planModelActivatedOn: cutoverDate,
        assignmentCount: preview.assignments.length,
        periodCount: periodIds.size,
        fundingRuleCount: preview.fundingRules.length,
      },
    },
  });

  await deps.afterWrites?.();

  const accounts = await tx.account.findMany({
    where: { budgetId: params.budgetId },
    select: { id: true },
  });
  const balances = new FinancialBalanceRepository();
  let afterCash = 0n;
  for (const account of accounts) {
    afterCash += await balances.accountBalance(tx, params.budgetId, account.id);
  }
  if (afterCash.toString() !== report.totalCashMinor) throw new CutoverError('CASH_CHANGED');

  return {
    beforeCash: report.totalCashMinor,
    afterCash: afterCash.toString(),
    modelVersion: 2,
    assignmentCount: preview.assignments.length,
  };
}
