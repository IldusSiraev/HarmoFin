import type { Prisma } from '@prisma/client';
import {
  BadRequestException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';

import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { RolePolicy } from '../common/policies/role-policy.js';
import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { cycleAndPeriodFor, todayInTimezone } from '../cycles/cycle-period.domain.js';
import { PrismaService } from '../database/prisma.service.js';
import { AssignmentBalanceRepository } from '../envelope-plans/assignment-balance.repository.js';
import { AssignmentRepository } from '../envelope-plans/assignment.repository.js';
import {
  type EnvelopePeriodRecord,
  FundingRuleRepository,
} from '../envelope-plans/funding-rule.repository.js';
import { mandatoryFundingGap } from '../obligations/mandatory-due.domain.js';
import { MandatoryDueRepository } from '../obligations/mandatory-due.repository.js';
import { PlanOccurrenceRepository } from '../plans/plan-occurrence.repository.js';
import { RegularPlanRepository } from '../plans/regular-plan.repository.js';
import { V2OccurrenceMaterializer } from '../plans/v2-occurrence-materializer.js';
import {
  type FundingPreviewState,
  type FundingSourceKind,
  computePreviewHash,
} from './funding-state.js';
import {
  FundingPreviewRepository,
  type PreviewEnvelope,
  type PreviewRule,
} from './funding-preview.repository.js';
import { type FundingRuleInput, suggestFunding } from './rule-engine.js';

const RUB_SCALE = 2;
const DAY_MS = 86_400_000;

export type FundingPreviewInput = {
  sourceKind: FundingSourceKind;
  incomeTransactionId?: string | undefined;
  overrides?:
    Array<{ envelopeId: string; periodId?: string | undefined; amount: string }> | undefined;
  /** Draft period ids the user keeps selected; omitted means every draft is selected. */
  confirmPeriodTargets?: string[] | undefined;
};

export type FundingPreviewBody = {
  sourceKind: FundingSourceKind;
  sourceAvailableMinor: string;
  periodTargetDrafts: Array<{
    periodId: string;
    targetMinor: string;
    selectedForConfirmation: boolean;
  }>;
  lines: Array<{ envelopeId: string; periodId: string | null; suggestedMinor: string }>;
  remainingMinor: string;
  mandatoryGapMinor: string;
  previewHash: string;
  errors: Array<{ code: string; detail: string }>;
};

export type FundingPreviewComputation = { body: FundingPreviewBody; state: FundingPreviewState };

type Line = { envelopeId: string; periodId: string | null; amountMinor: bigint };

const dateValue = (value: string) => new Date(`${value}T00:00:00.000Z`);
const isoDate = (value: Date) => value.toISOString().slice(0, 10);
const positive = (value: bigint) => (value > 0n ? value : 0n);
const lineKey = (envelopeId: string, periodId: string | null) => `${envelopeId}|${periodId ?? ''}`;

function addDays(value: string, days: number): string {
  return isoDate(new Date(dateValue(value).getTime() + days * DAY_MS));
}

function unprocessable(code: string, detail: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ code, detail });
}

function validationFailed(detail: string, field: string): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_FAILED',
    detail,
    fieldErrors: [{ field, message: detail, code: 'invalid' }],
  });
}

/**
 * Server-side funding preview (R03b). It proposes assignments of one source (INCOME, OPENING or
 * FREE) and never writes money: no assignment, no confirmed target, no financial audit.
 *
 * Authority: OWNER only, the same as the future confirm (R04); VIEWER/EDITOR get 403.
 * Locking: preview is a POST that takes the budget row lock (FOR UPDATE) because the mandatory
 * recompute materializes occurrences and may create DRAFT/UNSET EnvelopePeriod rows (idempotent
 * structural writes through FundingRuleRepository.getOrCreatePeriod; they keep their usual
 * structural `envelope_period` audit event). Period rows are only created for the current period of
 * envelopes with a FIXED_PER_PERIOD rule (and for the category-suggestion target).
 *
 * Source availability:
 *  - FREE: freeToAssign = cash - sum(positive envelope/period balances), the same definition the
 *    assignment service enforces.
 *  - OPENING: the same, allowed only before the first confirmed fact of the budget.
 *  - INCOME: min(income - already assigned INCOME-sourced amounts (L03 cap), freeToAssign).
 * Scope: the current period (budget timezone) only; mandatory need uses the finite horizon of R02.
 */
@Injectable()
export class FundingPreviewApplicationService {
  private readonly repository = new FundingPreviewRepository();
  private readonly assignments = new AssignmentRepository();
  private readonly balances = new AssignmentBalanceRepository();
  private readonly rules = new FundingRuleRepository();
  private readonly rolePolicy = new RolePolicy();
  private readonly mandatory: MandatoryDueRepository;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {
    const plans = new RegularPlanRepository(prisma);
    this.mandatory = new MandatoryDueRepository(
      plans,
      new V2OccurrenceMaterializer(plans, new PlanOccurrenceRepository()),
    );
  }

  async preview(
    userId: string,
    budgetId: string,
    input: FundingPreviewInput,
    requestId?: string,
  ): Promise<FundingPreviewBody> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    return this.prisma.$transaction(async (tx) => {
      // Cheap role read first: EDITOR/VIEWER get 403 without taking the budget lock.
      const early = await this.repository.findMemberRole(tx, model.workspaceId, userId);
      if (!early || !this.rolePolicy.canManage(early)) throw forbidden();
      await this.assignments.lockBudget(tx, budgetId);
      const role = await this.repository.findMemberRole(tx, model.workspaceId, userId);
      if (!role || !this.rolePolicy.canManage(role)) throw forbidden();
      const { body } = await this.compute(tx, {
        budgetId,
        workspaceId: model.workspaceId,
        userId,
        input,
        requestId,
      });
      return body;
    });
  }

  /**
   * Recomputes the preview inside a transaction that already holds the budget lock and passed the
   * authorization checks. R04 calls it with the user's lines to compare `state` hashes.
   */
  async compute(
    tx: Prisma.TransactionClient,
    params: {
      budgetId: string;
      workspaceId: string;
      userId: string;
      input: FundingPreviewInput;
      requestId?: string | undefined;
    },
  ): Promise<FundingPreviewComputation> {
    const { budgetId, input } = params;
    const errors: Array<{ code: string; detail: string }> = [];
    const timezone = await this.assignments.requireBudgetTimezone(tx, budgetId);
    const today = todayInTimezone(new Date(), timezone);
    const settings = await this.rules.settingsAt(tx, budgetId, today);
    if (!settings) throw unprocessable('BUDGET_SETTINGS_MISSING', 'Настройки бюджета недоступны.');
    const asOfDate = dateValue(today);
    const currentPeriod = cycleAndPeriodFor(settings, today).period;
    const nextPeriod = cycleAndPeriodFor(settings, addDays(currentPeriod.end, 1)).period;
    const actor = {
      workspaceId: params.workspaceId,
      userId: params.userId,
      requestId: params.requestId,
    };

    const envelopes = await this.repository.listEnvelopes(tx, budgetId);
    const envelopeById = new Map(envelopes.map((envelope) => [envelope.id, envelope]));
    const ruleRows = await this.repository.listRules(tx, budgetId);

    // Source resolution: income ownership and state first (404 before any structural write).
    let income: { id: string; amountMinor: bigint; categoryId: string | null } | null = null;
    if (input.sourceKind === 'INCOME') {
      income = input.incomeTransactionId
        ? await this.repository.findIncome(tx, budgetId, input.incomeTransactionId)
        : null;
      if (!income) throw resourceNotFound();
    }

    // Structural: current period rows of FIXED_PER_PERIOD period envelopes (DRAFT|UNSET only).
    const periodRows = new Map<string, EnvelopePeriodRecord>();
    for (const rule of ruleRows) {
      const envelope = envelopeById.get(rule.envelopeId);
      if (!envelope || envelope.archivedAt || envelope.periodSlot !== currentPeriod.id) continue;
      if (rule.type === 'MANUAL' || rule.type === 'SUM_OF_PLANS') continue;
      const row =
        rule.type === 'FIXED_PER_PERIOD'
          ? await this.rules.getOrCreatePeriod(
              tx,
              budgetId,
              envelope.id,
              currentPeriod.start,
              currentPeriod.end,
              actor,
            )
          : await this.rules.findPeriodByStart(tx, budgetId, envelope.id, currentPeriod.start);
      if (row) periodRows.set(envelope.id, row);
    }

    // Category suggestion target (setting only; this preview proposes, never assigns).
    const suggestion = await this.repository.categorySuggestion(tx, budgetId);
    let overrideLine: { envelopeId: string; periodId: string | null } | undefined;
    let categoryTargetRow: EnvelopePeriodRecord | null = null;
    if (
      income &&
      suggestion.enabled &&
      suggestion.sourceCategoryId !== null &&
      income.categoryId === suggestion.sourceCategoryId &&
      suggestion.targetEnvelopeId !== null
    ) {
      const target = envelopeById.get(suggestion.targetEnvelopeId);
      if (target && !target.archivedAt) {
        let periodId: string | null = null;
        if (target.periodSlot) {
          const range = target.periodSlot === currentPeriod.id ? currentPeriod : nextPeriod;
          const row =
            periodRows.get(target.id) && target.periodSlot === currentPeriod.id
              ? periodRows.get(target.id)!
              : await this.rules.getOrCreatePeriod(
                  tx,
                  budgetId,
                  target.id,
                  range.start,
                  range.end,
                  actor,
                );
          periodId = row.id;
          categoryTargetRow = row;
        }
        overrideLine = { envelopeId: target.id, periodId };
      }
    }

    // Mandatory need (R02 contract: caller holds the budget lock).
    const dueMinor = await this.mandatory.mandatoryDue(tx, budgetId, today, nextPeriod.end);

    const balanceRows = await this.balances.allBalances(tx, budgetId, asOfDate);
    const cash = await this.assignments.cashAt(tx, budgetId, asOfDate);
    const protectedMinor = balanceRows.reduce((sum, row) => sum + positive(row.balance), 0n);
    const freeToAssign = positive(cash - protectedMinor);
    const mandatoryBalance = balanceRows
      .filter((row) => envelopeById.get(row.envelopeId)?.envelopeType === 'MANDATORY_EXPENSES')
      .filter((row) => !envelopeById.get(row.envelopeId)?.archivedAt)
      .reduce((sum, row) => sum + row.balance, 0n);
    const mandatoryGap = mandatoryFundingGap(dueMinor, mandatoryBalance);

    let incomeAssigned = 0n;
    let assignedByEnvelope = new Map<string, bigint>();
    let sourceAvailable = freeToAssign;
    if (income) {
      incomeAssigned = await this.assignments.sumIncomeAssigned(tx, budgetId, income.id);
      assignedByEnvelope = await this.repository.incomeAssignedByEnvelope(tx, budgetId, income.id);
      sourceAvailable = positive(income.amountMinor - incomeAssigned);
      if (sourceAvailable > freeToAssign) sourceAvailable = freeToAssign;
    } else if (input.sourceKind === 'OPENING') {
      if (await this.assignments.hasConfirmedFact(tx, budgetId, asOfDate)) {
        throw unprocessable(
          'OPENING_NOT_AVAILABLE',
          'Начальное назначение (OPENING) доступно только до первой подтверждённой операции бюджета. Используйте FREE.',
        );
      }
    }

    // Draft period targets and the user's selection (default: all selected).
    const drafts = [...periodRows.values()]
      .filter((row) => row.targetStatus === 'DRAFT' && row.targetMinor !== null)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const selectedIds = new Set(
      input.confirmPeriodTargets === undefined
        ? drafts.map((row) => row.id)
        : drafts.filter((row) => input.confirmPeriodTargets!.includes(row.id)).map((row) => row.id),
    );

    const fundedOf = (envelopeId: string, periodId: string | null): bigint =>
      balanceRows.find((row) => row.envelopeId === envelopeId && row.periodId === periodId)
        ?.funded ?? 0n;

    // Ordered rules for the engine.
    const orderedRules: FundingRuleInput[] = [];
    let mandatoryNeedGiven = false;
    const sortedRules = [...ruleRows].sort(
      (a, b) =>
        a.priority - b.priority ||
        (a.envelopeId < b.envelopeId ? -1 : a.envelopeId > b.envelopeId ? 1 : 0),
    );
    for (const rule of sortedRules) {
      const envelope = envelopeById.get(rule.envelopeId);
      if (!envelope || envelope.archivedAt || rule.type === 'MANUAL') continue;
      const scope = this.scopeOf(envelope, periodRows);
      if (scope === undefined) continue;
      const base = { envelopeId: envelope.id, periodId: scope, priority: rule.priority };
      const fromThisIncome = assignedByEnvelope.get(envelope.id) ?? 0n;

      if (rule.type === 'SUM_OF_PLANS') {
        if (envelope.envelopeType !== 'MANDATORY_EXPENSES') continue;
        const need = mandatoryNeedGiven ? 0n : mandatoryGap;
        mandatoryNeedGiven = true;
        orderedRules.push({ ...base, kind: 'SUM_OF_PLANS', needMinor: need });
      } else if (rule.type === 'FIXED_PER_PERIOD') {
        const row = periodRows.get(envelope.id);
        if (!row || row.targetMinor === null) continue;
        const counts =
          row.targetStatus === 'CONFIRMED' ||
          (row.targetStatus === 'DRAFT' && selectedIds.has(row.id));
        const need = counts ? positive(row.targetMinor - fundedOf(envelope.id, row.id)) : 0n;
        orderedRules.push({ ...base, kind: 'FIXED_PER_PERIOD', needMinor: need });
      } else if (rule.type === 'SUGGESTED_FIXED') {
        if (rule.fixedMinor === null) continue;
        orderedRules.push({
          ...base,
          kind: 'SUGGESTED_FIXED',
          needMinor: positive(rule.fixedMinor - fromThisIncome),
        });
      } else if (rule.type === 'PERCENT_OF_INCOME') {
        if (!this.validPercent(rule)) {
          errors.push({
            code: 'FUNDING_RULE_INVALID',
            detail: 'Правило с процентом пропущено: значение должно быть целым от 0 до 10000.',
          });
          continue;
        }
        orderedRules.push({
          ...base,
          kind: 'PERCENT_OF_INCOME',
          needMinor: 0n,
          percentBasisPoints: rule.percentBasisPoints!,
          alreadyAllocatedFromIncomeMinor: fromThisIncome,
        });
      }
    }

    const suggested = suggestFunding({
      available: sourceAvailable,
      incomeAmount: income ? income.amountMinor : null,
      orderedRules,
      ...(overrideLine ? { categoryOverride: overrideLine } : {}),
    });

    // User overrides replace or add lines; remaining and errors are recomputed server-side.
    const lines: Line[] = suggested.map((line) => ({ ...line }));
    const overrideStates: FundingPreviewState['overrides'] = [];
    const seenOverrides = new Set<string>();
    for (const override of input.overrides ?? []) {
      const envelope = envelopeById.get(override.envelopeId);
      if (!envelope) throw resourceNotFound();
      if (envelope.archivedAt) {
        throw unprocessable('ENVELOPE_ARCHIVED', 'Архивированный конверт не принимает назначения.');
      }
      let periodId: string | null = null;
      if (envelope.periodSlot) {
        if (!override.periodId) {
          throw unprocessable('PERIOD_REQUIRED', 'Для периодного конверта укажите periodId.');
        }
        const period = await this.assignments.findPeriod(
          tx,
          budgetId,
          envelope.id,
          override.periodId,
        );
        if (!period) throw resourceNotFound();
        periodId = period.id;
      } else if (override.periodId) {
        throw unprocessable('PERIOD_NOT_ALLOWED', 'У этого конверта нет периодов.');
      }
      const key = lineKey(envelope.id, periodId);
      if (seenOverrides.has(key)) {
        throw validationFailed('Строка конверта указана дважды.', 'overrides');
      }
      seenOverrides.add(key);
      const amountMinor = parseDecimalToMinorUnits(override.amount, RUB_SCALE, false);
      overrideStates.push({ envelopeId: envelope.id, periodId, amountMinor });
      const existing = lines.find((line) => lineKey(line.envelopeId, line.periodId) === key);
      if (existing) existing.amountMinor = amountMinor;
      else lines.push({ envelopeId: envelope.id, periodId, amountMinor });
    }
    const finalLines = lines.filter((line) => line.amountMinor > 0n);
    const total = finalLines.reduce((sum, line) => sum + line.amountMinor, 0n);
    let remaining = sourceAvailable - total;
    if (remaining < 0n) {
      errors.push({
        code: 'OVERRIDES_EXCEED_SOURCE',
        detail: 'Сумма назначений больше доступных средств источника.',
      });
      remaining = 0n;
    }

    const state: FundingPreviewState = {
      budgetId,
      asOf: today,
      sourceKind: input.sourceKind,
      incomeTransactionId: income?.id ?? null,
      incomeAmountMinor: income?.amountMinor ?? null,
      incomeCategoryId: income?.categoryId ?? null,
      incomeAssignedMinor: incomeAssigned,
      incomeAssignedByEnvelope: [...assignedByEnvelope].map(([envelopeId, amountMinor]) => ({
        envelopeId,
        amountMinor,
      })),
      envelopes: envelopes.map((envelope) => ({
        envelopeId: envelope.id,
        envelopeType: envelope.envelopeType,
        periodSlot: envelope.periodSlot,
        archived: envelope.archivedAt !== null,
      })),
      periodRanges: { current: currentPeriod, next: nextPeriod },
      categoryTargetPeriod: categoryTargetRow
        ? {
            periodId: categoryTargetRow.id,
            envelopeId: categoryTargetRow.envelopeId,
            targetMinor: categoryTargetRow.targetMinor,
            targetStatus: categoryTargetRow.targetStatus,
          }
        : null,
      cashMinor: cash,
      freeToAssignMinor: freeToAssign,
      sourceAvailableMinor: sourceAvailable,
      balances: balanceRows.map((row) => ({
        envelopeId: row.envelopeId,
        periodId: row.periodId,
        fundedMinor: row.funded,
        spentMinor: row.spent,
      })),
      mandatoryDueMinor: dueMinor,
      rules: ruleRows.map((rule) => ({
        envelopeId: rule.envelopeId,
        type: rule.type,
        priority: rule.priority,
        fixedMinor: rule.fixedMinor,
        percentBasisPoints: rule.percentBasisPoints,
      })),
      periods: [...periodRows.values()].map((row) => ({
        periodId: row.id,
        envelopeId: row.envelopeId,
        targetMinor: row.targetMinor,
        targetStatus: row.targetStatus,
      })),
      selectedDraftPeriodIds: [...selectedIds],
      categorySuggestion: suggestion,
      overrides: overrideStates,
    };

    return {
      state,
      body: {
        sourceKind: input.sourceKind,
        sourceAvailableMinor: formatMinorUnits(sourceAvailable),
        periodTargetDrafts: drafts.map((row) => ({
          periodId: row.id,
          targetMinor: formatMinorUnits(row.targetMinor!),
          selectedForConfirmation: selectedIds.has(row.id),
        })),
        lines: finalLines.map((line) => ({
          envelopeId: line.envelopeId,
          periodId: line.periodId,
          suggestedMinor: formatMinorUnits(line.amountMinor),
        })),
        remainingMinor: formatMinorUnits(remaining),
        mandatoryGapMinor: formatMinorUnits(mandatoryGap),
        previewHash: computePreviewHash(state),
        errors,
      },
    };
  }

  /** Period scope of a rule line: null (whole envelope), a period id, or undefined (skip). */
  private scopeOf(
    envelope: PreviewEnvelope,
    periodRows: Map<string, EnvelopePeriodRecord>,
  ): string | null | undefined {
    if (!envelope.periodSlot) return null;
    return periodRows.get(envelope.id)?.id;
  }

  private validPercent(rule: PreviewRule): boolean {
    const value = rule.percentBasisPoints;
    return value !== null && Number.isInteger(value) && value >= 0 && value <= 10_000;
  }
}
