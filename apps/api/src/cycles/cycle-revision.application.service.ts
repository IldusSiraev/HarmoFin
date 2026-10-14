import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { RolePolicy } from '../common/policies/role-policy.js';
import { forbidden } from '../common/reference-data/reference-data.errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { AssignmentRepository } from '../envelope-plans/assignment.repository.js';
import { FundingRuleRepository } from '../envelope-plans/funding-rule.repository.js';
import {
  type CycleRange,
  type CycleSettings,
  cycleAndPeriodFor,
  todayInTimezone,
} from './cycle-period.domain.js';
import { type CycleRevisionPreview, previewCycleRevision } from './cycle-revision.domain.js';
import { CycleRevisionRepository } from './cycle-revision.repository.js';
import type { CycleChangeConfirmInput, CycleChangePreviewInput } from './cycle-revision.schemas.js';

const RUB_SCALE = 2;
const CONFIRM_CYCLE_CHANGE_OPERATION = 'CONFIRM_CYCLE_CHANGE';

export type CycleChangePreviewBody = {
  effectiveOn: string;
  transitionRanges: CycleRange[];
  previewHash: string;
};

export type CycleChangeConfirmBody = {
  effectiveOn: string;
  baselineCreated: boolean;
  transitionRanges: CycleRange[];
  createdPeriods: number;
};

type Computation = {
  body: CycleChangePreviewBody;
  preview: CycleRevisionPreview;
  oldSettings: CycleSettings;
  newSettings: CycleSettings;
  hasRevisions: boolean;
  planModelActivatedOn: string;
};

function previewStale(): ConflictException {
  return new ConflictException({
    code: 'PREVIEW_STALE',
    detail: 'Данные изменились после предпросмотра. Обновите предпросмотр и подтвердите снова.',
  });
}

function validationFailed(detail: string, field: string): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_FAILED',
    detail,
    fieldErrors: [{ field, message: detail, code: 'invalid' }],
  });
}

/**
 * Owner-confirmed change of the cycle boundaries (T02). History is never rewritten: the previous
 * settings stay as a baseline revision, the new ones start on a future revision, and only the
 * short transition intervals of the old settings are (re)created as unconfirmed period rows.
 * Budget fields, confirmed periods, assignments and transaction dates are untouched.
 */
@Injectable()
export class CycleRevisionApplicationService {
  private readonly repository = new CycleRevisionRepository();
  private readonly assignments = new AssignmentRepository();
  private readonly periods = new FundingRuleRepository();
  private readonly rolePolicy = new RolePolicy();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {}

  async preview(
    userId: string,
    budgetId: string,
    input: CycleChangePreviewInput,
  ): Promise<CycleChangePreviewBody> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    return this.prisma.$transaction(
      async (tx) => {
        await this.requireOwner(tx, model.workspaceId, userId);
        return (await this.compute(tx, model.workspaceId, budgetId, input)).body;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async confirm(
    userId: string,
    budgetId: string,
    input: CycleChangeConfirmInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<{ status: number; body: CycleChangeConfirmBody }> {
    const targets = new Map<string, bigint | null>();
    for (const item of input.transitionTargets) {
      if (targets.has(item.periodStart)) {
        throw validationFailed('Дата переходного интервала указана дважды.', 'transitionTargets');
      }
      let minor: bigint | null = null;
      if (item.target != null) {
        minor = parseDecimalToMinorUnits(item.target, RUB_SCALE, false);
        if (minor <= 0n) throw validationFailed('Цель должна быть положительной.', 'target');
      }
      targets.set(item.periodStart, minor);
    }
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          previewHash: input.previewHash,
          cycleStartDay: input.cycleStartDay,
          periodBoundaryOffset: input.periodBoundaryOffset,
          targets: [...targets].map(([start, minor]) => [start, minor?.toString() ?? null]).sort(),
        }),
      )
      .digest('hex');
    const workspaceId = model.workspaceId;

    return this.prisma.$transaction(async (tx) => {
      await this.assignments.lockBudget(tx, budgetId);
      return this.idempotency.execute(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: CONFIRM_CYCLE_CHANGE_OPERATION,
          requestHash,
        },
        async (): Promise<{ status: number; body: CycleChangeConfirmBody }> => {
          await this.requireOwner(tx, workspaceId, userId);
          const current = await this.compute(tx, workspaceId, budgetId, input);
          if (current.body.previewHash !== input.previewHash) throw previewStale();
          const { preview, oldSettings, newSettings } = current;

          const rangeStarts = new Set(preview.transitionRanges.map((range) => range.start));
          for (const start of targets.keys()) {
            if (!rangeStarts.has(start)) {
              throw validationFailed(
                'Цель можно задать только для переходного интервала из предпросмотра.',
                'transitionTargets',
              );
            }
          }

          // Baseline: the settings that applied until now, recorded before the future revision.
          let baselineCreated = false;
          if (!current.hasRevisions && current.planModelActivatedOn < preview.effectiveOn) {
            await this.repository.createRevision(tx, budgetId, userId, {
              ...oldSettings,
              effectiveOn: current.planModelActivatedOn,
            });
            baselineCreated = true;
          }
          const revisionId = await this.repository.createRevision(tx, budgetId, userId, {
            ...newSettings,
            effectiveOn: preview.effectiveOn,
          });

          // Unconfirmed structural rows overlapping the transition or later are rebuilt.
          const floor = preview.transitionRanges[0]?.start ?? preview.effectiveOn;
          const removedIds = await this.repository.deleteUnconfirmedPeriodsEndingFrom(
            tx,
            budgetId,
            floor,
          );
          const envelopes = await this.repository.listPeriodEnvelopes(tx, budgetId);
          const actor = { workspaceId, userId, requestId };
          let createdPeriods = 0;
          const appliedTargets: Array<{ periodStart: string; targetMinor: string | null }> = [];
          for (const range of preview.transitionRanges) {
            const slot = cycleAndPeriodFor(oldSettings, range.start).period.id;
            const hasTarget = targets.has(range.start);
            const targetMinor = targets.get(range.start) ?? null;
            if (hasTarget) {
              appliedTargets.push({
                periodStart: range.start,
                targetMinor: targetMinor?.toString() ?? null,
              });
            }
            for (const envelope of envelopes) {
              if (envelope.periodSlot !== slot) continue;
              const opened = await this.periods.getOrCreatePeriod(
                tx,
                budgetId,
                envelope.id,
                range.start,
                range.end,
                actor,
              );
              if (opened.created) createdPeriods += 1;
              // A shortened interval never inherits the full-period suggestion silently.
              if (targetMinor !== null) {
                await this.periods.applyTarget(tx, {
                  budgetId,
                  workspaceId,
                  actorUserId: userId,
                  period: opened,
                  targetMinor,
                  requestId,
                });
              } else if (opened.targetStatus === 'DRAFT') {
                await this.periods.rejectDraft(tx, {
                  budgetId,
                  workspaceId,
                  actorUserId: userId,
                  period: opened,
                  requestId,
                });
              }
            }
          }

          await this.repository.createAudit(tx, {
            budgetId,
            workspaceId,
            actorUserId: userId,
            revisionId,
            requestId,
            newValues: {
              effectiveOn: preview.effectiveOn,
              cycleStartDay: newSettings.cycleStartDay,
              periodBoundaryOffset: newSettings.periodBoundaryOffset,
              timezone: newSettings.timezone,
              previous: {
                cycleStartDay: oldSettings.cycleStartDay,
                periodBoundaryOffset: oldSettings.periodBoundaryOffset,
              },
              baselineCreated,
              baselineEffectiveOn: baselineCreated ? current.planModelActivatedOn : null,
              transitionRanges: preview.transitionRanges.map((range) => ({ ...range })),
              transitionTargets: appliedTargets,
              removedUnconfirmedPeriods: removedIds.length,
              createdPeriods,
            },
          });

          return {
            status: 200,
            body: {
              effectiveOn: preview.effectiveOn,
              baselineCreated,
              transitionRanges: preview.transitionRanges,
              createdPeriods,
            },
          };
        },
      );
    });
  }

  /** Read-only: recomputes the T01 preview of the current state; hash binds state and input. */
  private async compute(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    budgetId: string,
    input: CycleChangePreviewInput,
  ): Promise<Computation> {
    const budget = await this.repository.budgetState(tx, workspaceId, budgetId);
    if (!budget) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        detail: 'Бюджет не найден или недоступен для этого пользователя.',
      });
    }
    const asOf = todayInTimezone(new Date(), budget.timezone);
    const revisions = await this.repository.listRevisions(tx, budgetId);
    if (revisions.some((revision) => revision.effectiveOn > asOf)) {
      throw new ConflictException({
        code: 'CYCLE_CHANGE_PENDING',
        detail: 'Предыдущая смена цикла ещё не вступила в силу. Дождитесь её начала.',
      });
    }
    const oldSettings = (await this.repository.settingsAt(tx, budgetId, asOf)) ?? budget;
    const current: CycleSettings = {
      cycleStartDay: oldSettings.cycleStartDay,
      periodBoundaryOffset: oldSettings.periodBoundaryOffset,
      timezone: oldSettings.timezone,
    };
    const newSettings: CycleSettings = {
      cycleStartDay: input.cycleStartDay,
      periodBoundaryOffset: input.periodBoundaryOffset,
      timezone: current.timezone,
    };
    if (
      newSettings.cycleStartDay === current.cycleStartDay &&
      newSettings.periodBoundaryOffset === current.periodBoundaryOffset
    ) {
      throw new UnprocessableEntityException({
        code: 'CYCLE_SETTINGS_UNCHANGED',
        detail: 'Новые границы цикла совпадают с действующими.',
      });
    }
    const confirmed = await this.repository.listConfirmedPeriods(tx, budgetId);
    const preview = previewCycleRevision({
      oldSettings: current,
      newSettings,
      asOf,
      confirmedPeriodEnds: confirmed,
    });
    const previewHash = createHash('sha256')
      .update(
        JSON.stringify({
          budgetId,
          asOf,
          current,
          input: newSettings,
          revisions,
          confirmed,
          preview,
        }),
      )
      .digest('hex');
    if (!budget.planModelActivatedOn) throw previewStale();
    return {
      body: {
        effectiveOn: preview.effectiveOn,
        transitionRanges: preview.transitionRanges,
        previewHash,
      },
      preview,
      oldSettings: current,
      newSettings,
      hasRevisions: revisions.length > 0,
      planModelActivatedOn: budget.planModelActivatedOn,
    };
  }

  private async requireOwner(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    const role = await this.repository.findMemberRole(tx, workspaceId, userId);
    if (!role || !this.rolePolicy.canManage(role)) throw forbidden();
  }
}
