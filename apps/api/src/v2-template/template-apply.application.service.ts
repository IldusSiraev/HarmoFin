import { createHash } from 'node:crypto';

import {
  ConflictException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { cycleAndPeriodFor, todayInTimezone } from '../cycles/cycle-period.domain.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { RolePolicy } from '../common/policies/role-policy.js';
import { forbidden } from '../common/reference-data/reference-data.errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { AssignmentRepository } from '../envelope-plans/assignment.repository.js';
import { FundingRuleRepository } from '../envelope-plans/funding-rule.repository.js';
import {
  hasConfirmedPlanHistory,
  resetUnconfirmedPeriods,
} from '../envelope-plans/reset-unconfirmed-periods.js';
import {
  type NewTemplateCategory,
  type NewTemplateRule,
  TemplateApplyRepository,
} from './template-apply.repository.js';
import {
  type TemplateEnvelopePreview,
  TemplatePreviewApplicationService,
} from './template-preview.application.service.js';
import { TemplatePreviewRepository } from './template-preview.repository.js';
import {
  type TemplateRole,
  V2_ENVELOPE_TEMPLATES,
  V2_TEMPLATE_CATEGORIES,
  type V2EnvelopeTemplate,
  replacementTemplateKey,
} from './v2-template.definitions.js';
import type { TemplateApplyInput } from './template.schemas.js';

const RUB_SCALE = 2;
const APPLY_TEMPLATE_OPERATION = 'APPLY_REFERENCE_TEMPLATE';

export type TemplateSkippedRow = {
  kind: 'CATEGORY' | 'ENVELOPE';
  role: TemplateRole | null;
  templateKey: string;
  reason: 'USER_SKIPPED' | 'COLLISION' | 'ARCHIVED' | 'NOT_AVAILABLE';
};

export type TemplateApplyResult = {
  status: number;
  body: {
    created: {
      categories: Array<{ id: string; templateKey: string; name: string }>;
      envelopes: Array<{ id: string; role: TemplateRole; templateKey: string; name: string }>;
    };
    adopted: Array<{ id: string; role: TemplateRole; templateKey: string | null; name: string }>;
    skipped: TemplateSkippedRow[];
    rules: Array<{ envelopeId: string; type: string; priority: number }>;
    cycle: {
      cycleStartDay: number;
      periodBoundaryOffset: number;
      changed: boolean;
      resetPeriods: number;
    };
    isComplete: boolean;
    previewHash: string;
  };
};

type Choice = {
  role: TemplateRole;
  action: 'CREATE' | 'ADOPT' | 'SKIP';
  name?: string | undefined;
  target?: string | null | undefined;
  ruleChoice?: 'SUGGESTED' | 'MANUAL' | undefined;
};

type EnvelopePlanEntry =
  | {
      mode: 'ADOPT';
      definition: V2EnvelopeTemplate;
      existingId: string;
      existingName: string;
      existingKey: string | null;
      choice: Choice;
      contribution: bigint | null;
    }
  | {
      mode: 'CREATE';
      definition: V2EnvelopeTemplate;
      id: string;
      name: string;
      templateKey: string;
      choice: Choice;
      contribution: bigint | null;
    };

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function unprocessable(code: string, detail: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ code, detail });
}

function previewStale(): ConflictException {
  return new ConflictException({
    code: 'PREVIEW_STALE',
    detail: 'Данные изменились после предпросмотра. Обновите предпросмотр и примените снова.',
  });
}

function cycleChangeBlocked(): ConflictException {
  return new ConflictException({
    code: 'CYCLE_CHANGE_REQUIRES_FLOW',
    detail:
      'В бюджете есть подтверждённые факты, назначения или цели. Границы цикла меняются отдельным подтверждаемым переходом.',
  });
}

/**
 * Apply of the individually configured reference template (R06). One transaction: budget row lock
 * -> idempotency advisory lock -> role/model check -> recomputation of the R05 preview hash.
 * Reuses compatible existing rows, creates only missing ones with non-conflicting keys and never
 * overwrites an existing rule, priority, target or name. Creates no account, income, expense,
 * assignment or FREE_MONEY envelope. OWNER only. Parallel calls serialise on the budget lock; the
 * later one sees a changed state and gets 409 PREVIEW_STALE, so no duplicates are possible.
 */
@Injectable()
export class TemplateApplyApplicationService {
  private readonly previewRepository = new TemplatePreviewRepository();
  private readonly repository = new TemplateApplyRepository();
  private readonly assignments = new AssignmentRepository();
  private readonly rules = new FundingRuleRepository();
  private readonly rolePolicy = new RolePolicy();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy: PlanModelPolicy,
    private readonly preview: TemplatePreviewApplicationService,
  ) {}

  async apply(
    userId: string,
    budgetId: string,
    input: TemplateApplyInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<TemplateApplyResult> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const early = await this.previewRepository.findMemberRole(
      this.prisma,
      model.workspaceId,
      userId,
    );
    if (!early || !this.rolePolicy.canManage(early)) throw forbidden();

    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const workspaceId = model.workspaceId;

    return this.prisma.$transaction(async (tx) => {
      await this.assignments.lockBudget(tx, budgetId);
      return this.idempotency.execute(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: APPLY_TEMPLATE_OPERATION,
          requestHash,
        },
        async (): Promise<TemplateApplyResult> => {
          const role = await this.previewRepository.findMemberRole(tx, workspaceId, userId);
          if (!role || !this.rolePolicy.canManage(role)) throw forbidden();

          const current = await this.preview.compute(tx, { budgetId, workspaceId });
          if (current.body.previewHash !== input.previewHash) throw previewStale();

          const envelopeRows = await this.previewRepository.listEnvelopes(tx, budgetId);
          const plan = this.planEnvelopes(input, current.body.envelopes, envelopeRows);
          const skipped: TemplateSkippedRow[] = plan.skipped;

          // Cycle: editable only while no confirmed fact fixes the calendar.
          const wantsCycle =
            input.cycle !== undefined &&
            (input.cycle.startDay !== current.body.cycle.cycleStartDay ||
              input.cycle.boundaryOffset !== current.body.cycle.periodBoundaryOffset);
          if (wantsCycle && (await hasConfirmedPlanHistory(tx, budgetId))) {
            throw cycleChangeBlocked();
          }

          // Categories: only missing ones; archived and colliding rows are reported, not touched.
          const categoryIdByKey = new Map<string, string>();
          const newCategories: NewTemplateCategory[] = [];
          for (const row of current.body.categories) {
            if (row.existingId) categoryIdByKey.set(row.templateKey, row.existingId);
            if (row.status === 'MISSING') {
              categoryIdByKey.set(row.templateKey, createUuidV7());
            } else if (row.status === 'ARCHIVED' || row.status === 'COLLISION') {
              skipped.push({
                kind: 'CATEGORY',
                role: null,
                templateKey: row.templateKey,
                reason: row.status,
              });
            }
          }
          for (const row of current.body.categories) {
            if (row.status !== 'MISSING') continue;
            const definition = V2_TEMPLATE_CATEGORIES.find(
              (item) => item.templateKey === row.templateKey,
            )!;
            newCategories.push({
              id: categoryIdByKey.get(row.templateKey)!,
              templateKey: row.templateKey,
              name: row.name,
              categoryType: definition.categoryType,
              parentId: definition.parentTemplateKey
                ? (categoryIdByKey.get(definition.parentTemplateKey) ?? null)
                : null,
              displayOrder: definition.displayOrder,
              comment: definition.comment,
              icon: definition.icon,
            });
          }
          await this.repository.createCategories(tx, budgetId, newCategories);

          // Envelopes and rules.
          const createdEnvelopes: TemplateApplyResult['body']['created']['envelopes'] = [];
          const adopted: TemplateApplyResult['body']['adopted'] = [];
          const createdRules: TemplateApplyResult['body']['rules'] = [];
          for (const entry of plan.entries) {
            let envelopeId: string;
            if (entry.mode === 'CREATE') {
              envelopeId = entry.id;
              await this.repository.createEnvelope(tx, budgetId, {
                id: entry.id,
                templateKey: entry.templateKey,
                name: entry.name,
                envelopeType: entry.definition.envelopeType,
                periodSlot: entry.definition.periodSlot,
                displayOrder: entry.definition.displayOrder,
              });
              createdEnvelopes.push({
                id: entry.id,
                role: entry.definition.role,
                templateKey: entry.templateKey,
                name: entry.name,
              });
            } else {
              envelopeId = entry.existingId;
              adopted.push({
                id: entry.existingId,
                role: entry.definition.role,
                templateKey: entry.existingKey,
                name: entry.existingName,
              });
              // Never overwrite an existing rule, priority or target.
              if (await this.rules.findRule(tx, budgetId, envelopeId)) continue;
            }
            const rule = this.ruleFor(entry, envelopeId);
            await this.repository.createRule(tx, budgetId, userId, rule);
            createdRules.push({
              envelopeId,
              type: rule.type,
              priority: rule.priority,
            });
          }

          // Cycle change: rebuild structural UNSET/DRAFT periods by the current rules.
          let resetPeriods = 0;
          let cycleStartDay = current.body.cycle.cycleStartDay;
          let periodBoundaryOffset = current.body.cycle.periodBoundaryOffset;
          if (wantsCycle && input.cycle) {
            cycleStartDay = input.cycle.startDay;
            periodBoundaryOffset = input.cycle.boundaryOffset;
            await this.repository.updateCycle(
              tx,
              budgetId,
              workspaceId,
              cycleStartDay,
              periodBoundaryOffset,
            );
            resetPeriods = await resetUnconfirmedPeriods(tx, budgetId);
            await this.rebuildCurrentDrafts(tx, {
              budgetId,
              workspaceId,
              userId,
              requestId,
              cycleStartDay,
              periodBoundaryOffset,
            });
          }

          const after = await this.preview.compute(tx, { budgetId, workspaceId });
          await this.repository.createAudit(tx, {
            budgetId,
            workspaceId,
            actorUserId: userId,
            requestId,
            newValues: {
              templateVersion: after.state.templateVersion,
              createdCategoryKeys: newCategories.map((row) => row.templateKey),
              createdEnvelopeKeys: createdEnvelopes.map((row) => row.templateKey),
              adoptedEnvelopeIds: adopted.map((row) => row.id),
              ruleEnvelopeIds: createdRules.map((row) => row.envelopeId),
              skipped: skipped.map((row) => ({
                kind: row.kind,
                templateKey: row.templateKey,
                reason: row.reason,
              })),
              cycleChanged: wantsCycle,
              resetPeriods,
            },
          });

          return {
            status: 200,
            body: {
              created: {
                categories: newCategories.map((row) => ({
                  id: row.id,
                  templateKey: row.templateKey,
                  name: row.name,
                })),
                envelopes: createdEnvelopes,
              },
              adopted,
              skipped,
              rules: createdRules,
              cycle: { cycleStartDay, periodBoundaryOffset, changed: wantsCycle, resetPeriods },
              isComplete: after.body.isComplete,
              previewHash: after.body.previewHash,
            },
          };
        },
      );
    });
  }

  /** Pure validation of the owner's choices against the preview; no writes. */
  private planEnvelopes(
    input: TemplateApplyInput,
    previewRows: TemplateEnvelopePreview[],
    envelopeRows: Array<{
      id: string;
      templateKey: string | null;
      name: string;
      archivedAt: Date | null;
    }>,
  ): { entries: EnvelopePlanEntry[]; skipped: TemplateSkippedRow[] } {
    const entries: EnvelopePlanEntry[] = [];
    const skipped: TemplateSkippedRow[] = [];
    const usedNames = new Set(
      envelopeRows
        .filter((row) => row.archivedAt === null)
        .map((row) => row.name.trim().toLowerCase()),
    );

    const choices: Choice[] = [
      ...input.periods.map((item) => ({ ...item, role: item.role as TemplateRole })),
      { role: 'MANDATORY', ...input.mandatory },
    ];
    for (const choice of choices) {
      const definition = V2_ENVELOPE_TEMPLATES.find((item) => item.role === choice.role)!;
      const row = previewRows.find((item) => item.templateKey === definition.templateKey)!;
      const entry = this.resolve(definition, row, choice, envelopeRows, usedNames, skipped);
      if (entry) entries.push(entry);
    }

    for (const selection of input.savings) {
      const definition = V2_ENVELOPE_TEMPLATES.find(
        (item) => item.selectable && sameName(item.name, selection.name),
      );
      if (!definition) {
        throw unprocessable(
          'TEMPLATE_SAVINGS_UNKNOWN',
          `Накопление «${selection.name}» отсутствует в шаблоне.`,
        );
      }
      const contribution =
        selection.requestedContribution == null
          ? null
          : parseDecimalToMinorUnits(selection.requestedContribution, RUB_SCALE, false);
      const row = previewRows.find((item) => item.templateKey === definition.templateKey)!;
      const choice: Choice = { role: 'SAVINGS', action: 'CREATE' };
      if (row.status === 'EXISTING') {
        entries.push({
          mode: 'ADOPT',
          definition,
          existingId: row.existingId!,
          existingName: row.existingName ?? definition.name,
          existingKey: null,
          choice,
          contribution,
        });
      } else if (row.status === 'MISSING') {
        usedNames.add(definition.name.trim().toLowerCase());
        entries.push({
          mode: 'CREATE',
          definition,
          id: createUuidV7(),
          name: definition.name,
          templateKey: definition.templateKey,
          choice,
          contribution,
        });
      } else {
        skipped.push({
          kind: 'ENVELOPE',
          role: 'SAVINGS',
          templateKey: definition.templateKey,
          reason: row.status === 'ARCHIVED' ? 'ARCHIVED' : 'COLLISION',
        });
      }
    }
    return { entries, skipped };
  }

  private resolve(
    definition: V2EnvelopeTemplate,
    row: TemplateEnvelopePreview,
    choice: Choice,
    envelopeRows: Array<{ id: string; templateKey: string | null; archivedAt: Date | null }>,
    usedNames: Set<string>,
    skipped: TemplateSkippedRow[],
  ): EnvelopePlanEntry | null {
    const label = definition.name;
    if (choice.action === 'SKIP') {
      skipped.push({
        kind: 'ENVELOPE',
        role: definition.role,
        templateKey: definition.templateKey,
        reason:
          row.status === 'COLLISION'
            ? 'COLLISION'
            : row.status === 'ARCHIVED'
              ? 'ARCHIVED'
              : 'USER_SKIPPED',
      });
      return null;
    }
    if (choice.action === 'ADOPT') {
      if (row.status !== 'EXISTING' || !row.existingId) {
        throw unprocessable(
          'TEMPLATE_ADOPT_UNAVAILABLE',
          `Для «${label}» нет совместимого действующего элемента: выберите CREATE с новым именем или SKIP.`,
        );
      }
      const existing = envelopeRows.find((item) => item.id === row.existingId);
      return {
        mode: 'ADOPT',
        definition,
        existingId: row.existingId,
        existingName: row.existingName ?? definition.name,
        existingKey: existing?.templateKey ?? null,
        choice,
        contribution: null,
      };
    }
    // CREATE
    if (row.status === 'EXISTING') {
      throw unprocessable(
        'TEMPLATE_ELEMENT_EXISTS',
        `«${label}» уже существует: выберите ADOPT или SKIP.`,
      );
    }
    if (row.status === 'COLLISION' && !choice.name) {
      throw unprocessable(
        'TEMPLATE_NAME_REQUIRED',
        `Имя «${label}» занято несовместимым элементом: укажите другое имя или выберите SKIP.`,
      );
    }
    const name = (choice.name ?? definition.name).trim();
    if (usedNames.has(name.toLowerCase())) {
      throw unprocessable(
        'TEMPLATE_NAME_CONFLICT',
        `Имя «${name}» уже занято: укажите другое имя или выберите SKIP.`,
      );
    }
    usedNames.add(name.toLowerCase());

    const keys = new Set([definition.templateKey, ...definition.legacyKeys]);
    let templateKey = definition.templateKey;
    if (row.status === 'ARCHIVED' && row.replacementTemplateKey) {
      templateKey = row.replacementTemplateKey;
    } else if (row.status === 'COLLISION') {
      const holder = envelopeRows.find((item) => keys.has(item.templateKey ?? ''));
      if (holder) templateKey = replacementTemplateKey(definition.role, holder.id);
    }
    return {
      mode: 'CREATE',
      definition,
      id: createUuidV7(),
      name,
      templateKey,
      choice,
      contribution: null,
    };
  }

  private ruleFor(entry: EnvelopePlanEntry, envelopeId: string): NewTemplateRule {
    const { definition, choice } = entry;
    const priority = definition.suggestedRulePriority;
    const manual = { envelopeId, type: 'MANUAL' as const, priority, fixedMinor: null };
    if (choice.ruleChoice === 'MANUAL') return manual;
    if (definition.role === 'FIRST' || definition.role === 'SECOND') {
      const target =
        choice.target == null ? null : parseDecimalToMinorUnits(choice.target, RUB_SCALE, false);
      return target === null
        ? manual
        : { envelopeId, type: 'FIXED_PER_PERIOD', priority, fixedMinor: target };
    }
    if (definition.role === 'SAVINGS') {
      return entry.contribution === null
        ? manual
        : { envelopeId, type: 'SUGGESTED_FIXED', priority, fixedMinor: entry.contribution };
    }
    return { envelopeId, type: definition.suggestedRuleType, priority, fixedMinor: null };
  }

  private async rebuildCurrentDrafts(
    tx: Prisma.TransactionClient,
    params: {
      budgetId: string;
      workspaceId: string;
      userId: string;
      requestId: string | undefined;
      cycleStartDay: number;
      periodBoundaryOffset: number;
    },
  ): Promise<void> {
    const timezone = await this.repository.budgetTimezone(tx, params.budgetId);
    const { period } = cycleAndPeriodFor(
      {
        cycleStartDay: params.cycleStartDay,
        periodBoundaryOffset: params.periodBoundaryOffset,
        timezone,
      },
      todayInTimezone(new Date(), timezone),
    );
    const envelopes = await this.previewRepository.listEnvelopes(tx, params.budgetId);
    const rules = await this.previewRepository.listRules(tx, params.budgetId);
    const fixed = new Set(
      rules
        .filter((rule) => rule.type === 'FIXED_PER_PERIOD' && rule.fixedMinor !== null)
        .map((rule) => rule.envelopeId),
    );
    for (const envelope of envelopes) {
      if (envelope.archivedAt || envelope.periodSlot !== period.id || !fixed.has(envelope.id)) {
        continue;
      }
      await this.rules.getOrCreatePeriod(
        tx,
        params.budgetId,
        envelope.id,
        period.start,
        period.end,
        { workspaceId: params.workspaceId, userId: params.userId, requestId: params.requestId },
      );
    }
  }
}
