import type { Prisma } from '@prisma/client';
import {
  BadRequestException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';

import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { findAccessActor, requireAccessActor } from '../common/policies/access-actor.repository.js';
import { BudgetAccessPolicy } from '../common/policies/budget-access.policy.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { cycleAndPeriodFor, todayInTimezone } from '../cycles/cycle-period.domain.js';
import { PrismaService } from '../database/prisma.service.js';
import { AssignmentBalanceRepository } from '../envelope-plans/assignment-balance.repository.js';
import { AssignmentRepository } from '../envelope-plans/assignment.repository.js';
import {
  type EnvelopePeriodRecord,
  FundingRuleRepository,
  type PeriodActor,
} from '../envelope-plans/funding-rule.repository.js';
import {
  mandatoryFundingGap,
  mandatoryLineId,
  mandatorySliceGaps,
} from '../obligations/mandatory-due.domain.js';
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
import { compareFundingRules, type FundingRuleInput, suggestFunding } from './rule-engine.js';

const RUB_SCALE = 2;
const DAY_MS = 86_400_000;

export type FundingPreviewInput = {
  sourceKind: FundingSourceKind;
  incomeTransactionId?: string | undefined;
  overrides?:
    | Array<{
        envelopeId: string;
        periodId?: string | undefined;
        lineId?: string | undefined;
        amount: string;
      }>
    | undefined;
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
  lines: Array<{
    envelopeId: string;
    periodId: string | null;
    /** Stable id of a suggestion line, null for plain lines. */
    lineId: string | null;
    suggestedMinor: string;
    /** 1-based position in the rule queue; null for envelopes without a queued rule. */
    queuePosition: number | null;
    /** Period of the line (YYYY-MM-DD); null for envelopes without periods. */
    periodStartsOn: string | null;
    periodEndsOn: string | null;
  }>;
  remainingMinor: string;
  mandatoryGapMinor: string;
  /** Unpaid mandatory slice of the current period (includes overdue). */
  mandatoryDueCurrentMinor: string;
  /** Unpaid mandatory slice of the next period. */
  mandatoryDueNextMinor: string;
  previewHash: string;
  errors: Array<{ code: string; detail: string }>;
};

export type FundingPreviewComputation = { body: FundingPreviewBody; state: FundingPreviewState };

type Line = {
  envelopeId: string;
  periodId: string | null;
  amountMinor: bigint;
  lineId?: string;
  queuePosition?: number | null;
  periodStartsOn?: string | null;
  periodEndsOn?: string | null;
};

type PeriodRange = { id: string; start: string; end: string };

const dateValue = (value: string) => new Date(`${value}T00:00:00.000Z`);
const isoDate = (value: Date) => value.toISOString().slice(0, 10);
const positive = (value: bigint) => (value > 0n ? value : 0n);
const lineKey = (envelopeId: string, periodId: string | null) => `${envelopeId}|${periodId ?? ''}`;

/**
 * Whether an override targets a suggestion line. With `lineId`: exact id match only. Without it
 * (legacy key `envelopeId|periodId`): the line without an id, or the mandatory current slice whose
 * legacy key collides with the next one.
 */
function lineMatchesOverride(
  line: Line,
  overrideLineId: string | undefined,
  legacyKey: string,
): boolean {
  if (overrideLineId !== undefined) return line.lineId === overrideLineId;
  if (lineKey(line.envelopeId, line.periodId) !== legacyKey) return false;
  return (
    line.lineId === undefined ||
    line.lineId === mandatoryLineId(line.envelopeId, 'MANDATORY_CURRENT')
  );
}

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
 * structural `envelope_period` audit event). Every active period envelope gets the period of its
 * line up front: the current half for its own slot, otherwise the next half (and the
 * category-suggestion target its period).
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
  private readonly access = new BudgetAccessPolicy();
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
      // Cheap role read first: VIEWER gets 403 without taking the budget lock.
      const early = await findAccessActor(this.prisma, model.workspaceId, userId);
      if (!early) throw forbidden();
      this.access.requireWriter(early);
      await this.assignments.lockBudget(tx, budgetId);
      const actor = await requireAccessActor(tx, model.workspaceId, userId);
      this.access.requireWriter(actor);
      if (input.sourceKind === 'INCOME' && input.incomeTransactionId) {
        const income = await this.assignments.requireIncome(
          tx,
          budgetId,
          input.incomeTransactionId,
        );
        this.access.requireIncomeAuthor(actor, income);
      }
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

    // Structural: every active period envelope gets the period of its line (current half for its
    // own slot, otherwise the next half) before anything is read. The recomputation in R04 then
    // sees the same period rows, rule scopes and balances as the preview the user saw.
    for (const envelope of envelopes) {
      if (envelope.archivedAt || !envelope.periodSlot) continue;
      const range = envelope.periodSlot === currentPeriod.id ? currentPeriod : nextPeriod;
      await this.rules.getOrCreatePeriod(tx, budgetId, envelope.id, range.start, range.end, actor);
    }

    // Current period rows of rule-driven period envelopes (DRAFT|UNSET only).
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

    // Mandatory need (R02 contract: caller holds the budget lock), split current/next slices.
    const dueSlices = await this.mandatory.mandatoryDue(
      tx,
      budgetId,
      today,
      currentPeriod.end,
      nextPeriod.end,
    );

    const balanceRows = await this.balances.allBalances(tx, budgetId, asOfDate);
    const cash = await this.assignments.cashAt(tx, budgetId, asOfDate);
    const protectedMinor = balanceRows.reduce((sum, row) => sum + positive(row.balance), 0n);
    const freeToAssign = positive(cash - protectedMinor);
    const mandatoryBalance = balanceRows
      .filter((row) => envelopeById.get(row.envelopeId)?.envelopeType === 'MANDATORY_EXPENSES')
      .filter((row) => !envelopeById.get(row.envelopeId)?.archivedAt)
      .reduce((sum, row) => sum + row.balance, 0n);
    const mandatoryGap = mandatoryFundingGap(dueSlices.totalMinor, mandatoryBalance);
    const mandatoryGaps = mandatorySliceGaps(
      dueSlices.currentSliceMinor,
      dueSlices.nextSliceMinor,
      mandatoryBalance,
    );

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
          'Начальное распределение (OPENING) доступно только до первой подтверждённой операции бюджета. Используйте FREE.',
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

    // Ordered rules for the engine. The first SUM_OF_PLANS mandatory rule gets two lines in
    // place of one: the current-period slice (including overdue) with the rule's priority, and the
    // next-period slice which sorts after every normal line via `slotAfterPeriod`.
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
        if (envelope.envelopeType !== 'MANDATORY_EXPENSES' || mandatoryNeedGiven) continue;
        mandatoryNeedGiven = true;
        orderedRules.push({
          ...base,
          kind: 'SUM_OF_PLANS',
          needMinor: mandatoryGaps.currentGapMinor,
          lineId: mandatoryLineId(envelope.id, 'MANDATORY_CURRENT'),
        });
        orderedRules.push({
          ...base,
          kind: 'SUM_OF_PLANS',
          needMinor: mandatoryGaps.nextGapMinor,
          lineId: mandatoryLineId(envelope.id, 'MANDATORY_NEXT'),
          slotAfterPeriod: true,
        });
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

    // Every active envelope has a line; rule suggestions fill their own slot.
    const lines = await this.lineSlots(
      tx,
      budgetId,
      envelopes,
      orderedRules,
      periodRows,
      { current: currentPeriod, next: nextPeriod },
      actor,
    );
    for (const proposal of suggested) {
      const key = lineKey(proposal.envelopeId, proposal.periodId);
      const slot = lines.find((line) => lineMatchesOverride(line, proposal.lineId, key));
      if (slot) slot.amountMinor = proposal.amountMinor;
      else
        lines.push({ ...proposal, queuePosition: null, periodStartsOn: null, periodEndsOn: null });
    }
    // User overrides replace or add lines; remaining and errors are recomputed server-side.
    const overrideStates: FundingPreviewState['overrides'] = [];
    const seenOverrides = new Set<string>();
    for (const override of input.overrides ?? []) {
      const envelope = envelopeById.get(override.envelopeId);
      if (!envelope) throw resourceNotFound();
      if (envelope.archivedAt) {
        throw unprocessable(
          'ENVELOPE_ARCHIVED',
          'Конверт в архиве: в него нельзя распределить деньги.',
        );
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
      if (seenOverrides.has(override.lineId ?? key)) {
        throw validationFailed('Строка конверта указана дважды.', 'overrides');
      }
      seenOverrides.add(override.lineId ?? key);
      const amountMinor = parseDecimalToMinorUnits(override.amount, RUB_SCALE, false);
      overrideStates.push({
        envelopeId: envelope.id,
        periodId,
        amountMinor,
        ...(override.lineId !== undefined ? { lineId: override.lineId } : {}),
      });
      // An unknown lineId falls back to the envelope/period row instead of duplicating it.
      const existing =
        lines.find((line) => lineMatchesOverride(line, override.lineId, key)) ??
        (override.lineId !== undefined
          ? lines.find((line) => lineMatchesOverride(line, undefined, key))
          : undefined);
      if (existing) existing.amountMinor = amountMinor;
      else {
        const lineId =
          periodId === null && envelope.envelopeType === 'MANDATORY_EXPENSES'
            ? mandatoryLineId(envelope.id, 'MANDATORY_CURRENT')
            : undefined;
        lines.push({
          envelopeId: envelope.id,
          periodId,
          amountMinor,
          ...(lineId !== undefined ? { lineId } : {}),
          queuePosition: null,
          periodStartsOn: null,
          periodEndsOn: null,
        });
      }
    }
    const total = lines.reduce((sum, line) => sum + line.amountMinor, 0n);
    let remaining = sourceAvailable - total;
    if (remaining < 0n) {
      errors.push({
        code: 'OVERRIDES_EXCEED_SOURCE',
        detail: 'Сумма распределений больше, чем доступно в источнике.',
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
      mandatoryDueMinor: dueSlices.totalMinor,
      mandatoryDueCurrentMinor: dueSlices.currentSliceMinor,
      mandatoryDueNextMinor: dueSlices.nextSliceMinor,
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
        lines: lines.map((line) => ({
          envelopeId: line.envelopeId,
          periodId: line.periodId,
          lineId: line.lineId ?? null,
          suggestedMinor: formatMinorUnits(line.amountMinor),
          queuePosition: line.queuePosition ?? null,
          periodStartsOn: line.periodStartsOn ?? null,
          periodEndsOn: line.periodEndsOn ?? null,
        })),
        remainingMinor: formatMinorUnits(remaining),
        mandatoryGapMinor: formatMinorUnits(mandatoryGap),
        mandatoryDueCurrentMinor: formatMinorUnits(dueSlices.currentSliceMinor),
        mandatoryDueNextMinor: formatMinorUnits(dueSlices.nextSliceMinor),
        previewHash: computePreviewHash(state),
        errors,
      },
    };
  }

  /**
   * One zero line per active envelope, built before overrides so every override (by lineId or
   * envelope/period) finds its row: the rule queue in suggestFunding order, then envelopes
   * without a queued rule by name. A period envelope outside the queue gets the current period of
   * its slot or, for the other half, the next one (idempotent structural row, like the category
   * target). The mandatory envelope outside the queue keeps its canonical current-slice id.
   */
  private async lineSlots(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopes: PreviewEnvelope[],
    orderedRules: FundingRuleInput[],
    periodRows: Map<string, EnvelopePeriodRecord>,
    ranges: { current: PeriodRange; next: PeriodRange },
    actor: PeriodActor,
  ): Promise<Line[]> {
    const periodById = new Map([...periodRows.values()].map((row) => [row.id, row]));
    const datesOf = (row: EnvelopePeriodRecord | undefined) => ({
      periodStartsOn: row ? isoDate(row.startsOn) : null,
      periodEndsOn: row ? isoDate(row.endsOn) : null,
    });
    const slots: Line[] = [];
    const queued = new Set<string>();
    [...orderedRules].sort(compareFundingRules).forEach((rule, index) => {
      queued.add(rule.envelopeId);
      slots.push({
        envelopeId: rule.envelopeId,
        periodId: rule.periodId,
        amountMinor: 0n,
        ...(rule.lineId !== undefined ? { lineId: rule.lineId } : {}),
        queuePosition: index + 1,
        ...datesOf(rule.periodId === null ? undefined : periodById.get(rule.periodId)),
      });
    });
    const rest = envelopes
      .filter((envelope) => !envelope.archivedAt && !queued.has(envelope.id))
      .sort(
        (a, b) => a.name.localeCompare(b.name, 'ru') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    for (const envelope of rest) {
      let period: EnvelopePeriodRecord | undefined;
      if (envelope.periodSlot) {
        const isCurrent = envelope.periodSlot === ranges.current.id;
        const range = isCurrent ? ranges.current : ranges.next;
        period =
          (isCurrent ? periodRows.get(envelope.id) : undefined) ??
          (await this.rules.getOrCreatePeriod(
            tx,
            budgetId,
            envelope.id,
            range.start,
            range.end,
            actor,
          ));
      }
      slots.push({
        envelopeId: envelope.id,
        periodId: period?.id ?? null,
        amountMinor: 0n,
        ...(envelope.envelopeType === 'MANDATORY_EXPENSES' && !envelope.periodSlot
          ? { lineId: mandatoryLineId(envelope.id, 'MANDATORY_CURRENT') }
          : {}),
        queuePosition: null,
        ...datesOf(period),
      });
    }
    return slots;
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
