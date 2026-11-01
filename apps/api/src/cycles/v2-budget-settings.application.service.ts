import { createHash } from 'node:crypto';

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { BudgetAccessPolicy } from '../common/policies/budget-access.policy.js';
import { forbidden } from '../common/reference-data/reference-data.errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { AssignmentRepository } from '../envelope-plans/assignment.repository.js';
import { resetUnconfirmedPeriods } from '../envelope-plans/reset-unconfirmed-periods.js';
import { todayInTimezone } from './cycle-period.domain.js';
import { shiftWallClock } from './timezone-change.js';
import {
  V2BudgetSettingsRepository,
  type V2BudgetSettingsView,
} from './v2-budget-settings.repository.js';
import type { V2BudgetSettingsInput } from './v2-budget-settings.schemas.js';

const UPDATE_BUDGET_SETTINGS_OPERATION = 'UPDATE_V2_BUDGET_SETTINGS';
const AUDITED_KEYS = ['name', 'allowNegativeAccountBalance', 'timezone'] as const;

function budgetNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'RESOURCE_NOT_FOUND',
    detail: 'Бюджет не найден или недоступен для этого пользователя.',
  });
}

/**
 * Owner-only update of v2 budget settings (T02b). Name and the account negative-balance flag map
 * onto the Budget fields and never replan. The timezone changes at any time except when a stored
 * fact date would land after "today" in the new zone; unreferenced UNSET/DRAFT period rows are
 * dropped (rebuilt lazily in the new zone) and timed calendar events are shifted per `timedEvents`
 * in the same transaction. Stored dates are never rewritten.
 */
@Injectable()
export class V2BudgetSettingsApplicationService {
  private readonly repository = new V2BudgetSettingsRepository();
  private readonly assignments = new AssignmentRepository();
  private readonly access = new BudgetAccessPolicy();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {}

  async update(
    userId: string,
    budgetId: string,
    input: V2BudgetSettingsInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<{ status: number; body: V2BudgetSettingsView }> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const workspaceId = model.workspaceId;
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          name: input.name ?? null,
          allowNegativeAccountBalance: input.allowNegativeAccountBalance ?? null,
          timezone: input.timezone ?? null,
          timedEvents: input.timedEvents ?? null,
        }),
      )
      .digest('hex');

    return this.prisma.$transaction(async (tx) => {
      // The role is checked before the lock and before any idempotency replay.
      const role = await this.repository.findMemberRole(tx, workspaceId, userId);
      if (!role || !this.access.canManageBudgetSettings({ userId, role, isCreator: false })) {
        throw forbidden();
      }
      await this.assignments.lockBudget(tx, budgetId);
      return this.idempotency.execute(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: UPDATE_BUDGET_SETTINGS_OPERATION,
          requestHash,
        },
        async () => {
          const before = await this.repository.find(tx, workspaceId, budgetId);
          if (!before) throw budgetNotFound();

          const timezoneChanges =
            input.timezone !== undefined && input.timezone !== before.timezone;
          let shiftedEvents = 0;
          if (timezoneChanges && input.timezone) {
            const newToday = todayInTimezone(new Date(), input.timezone);
            if (await this.repository.hasFactsAfter(tx, budgetId, newToday)) {
              throw new ConflictException({
                code: 'TIMEZONE_CHANGE_WOULD_FUTURE_DATE_FACTS',
                detail:
                  'Часовой пояс сейчас менять нельзя: часть записей оказалась бы датирована «завтра» по новому поясу. Повторите после полуночи по новому поясу.',
              });
            }
            const events = await this.repository.listTimedEvents(tx, workspaceId, budgetId);
            if (events.length > 0 && !input.timedEvents) {
              throw new UnprocessableEntityException({
                code: 'TIMED_EVENTS_MODE_REQUIRED',
                detail: 'Выберите, как сдвинуть события календаря со временем при смене пояса.',
              });
            }
            if (input.timedEvents === 'KEEP_WALL_CLOCK') {
              for (const event of events) {
                if (!event.startsAt) continue;
                await this.repository.updateEventInstants(
                  tx,
                  workspaceId,
                  budgetId,
                  event.id,
                  shiftWallClock(event.startsAt, before.timezone, input.timezone),
                  event.endsAt
                    ? shiftWallClock(event.endsAt, before.timezone, input.timezone)
                    : null,
                );
                shiftedEvents += 1;
              }
            }
            await resetUnconfirmedPeriods(tx, budgetId);
          }
          const patch = {
            name: input.name !== undefined && input.name !== before.name ? input.name : undefined,
            allowNegativeAccountBalance:
              input.allowNegativeAccountBalance !== undefined &&
              input.allowNegativeAccountBalance !== before.allowNegativeAccountBalance
                ? input.allowNegativeAccountBalance
                : undefined,
            timezone: timezoneChanges ? input.timezone : undefined,
          };
          if (Object.values(patch).every((value) => value === undefined)) {
            return { status: 200, body: { ...before } };
          }

          const after = await this.repository.update(tx, workspaceId, budgetId, patch);
          if (!after) throw budgetNotFound();
          const changedKeys = AUDITED_KEYS.filter((key) => before[key] !== after[key]);
          const pick = (view: V2BudgetSettingsView) =>
            Object.fromEntries(changedKeys.map((key) => [key, view[key]]));
          await this.repository.createAudit(tx, {
            workspaceId,
            budgetId,
            actorUserId: userId,
            requestId,
            oldValues: pick(before),
            newValues: {
              ...pick(after),
              ...(timezoneChanges ? { timedEvents: input.timedEvents ?? null, shiftedEvents } : {}),
            },
          });
          return { status: 200, body: { ...after } };
        },
      );
    });
  }
}
