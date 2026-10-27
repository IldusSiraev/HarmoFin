import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { BudgetAccessPolicy } from '../common/policies/budget-access.policy.js';
import { forbidden } from '../common/reference-data/reference-data.errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { TemplatePreviewRepository } from './template-preview.repository.js';
import {
  type CategoryMatch,
  type EnvelopeMatch,
  type TemplateRole,
  V2_ENVELOPE_TEMPLATES,
  V2_TEMPLATE_CATEGORIES,
  matchCategory,
  matchEnvelope,
} from './v2-template.definitions.js';
import {
  type TemplatePreviewState,
  V2_TEMPLATE_VERSION,
  computeTemplatePreviewHash,
} from './v2-template.state.js';

export type TemplateCategoryPreview = CategoryMatch & {
  templateKey: string;
  name: string;
  categoryType: string;
  parentTemplateKey: string | null;
};

export type TemplateEnvelopePreview = EnvelopeMatch & {
  role: TemplateRole;
  templateKey: string;
  name: string;
  type: string;
  periodSlot: string | null;
  selectable: boolean;
  suggestedRuleType: string;
  existingRuleType: string | null;
  /** Optional period target; the template never proposes an amount. */
  suggestedTargetMinor: string | null;
};

export type TemplatePreviewBody = {
  cycle: { cycleStartDay: number; periodBoundaryOffset: number };
  categories: TemplateCategoryPreview[];
  envelopes: TemplateEnvelopePreview[];
  isComplete: boolean;
  previewHash: string;
};

export type TemplatePreviewComputation = { body: TemplatePreviewBody; state: TemplatePreviewState };

/**
 * Reference-template preview (R05, GET). Strictly read-only: no INSERT/UPDATE/audit and no budget
 * lock. The hash covers current elements and settings so R06 apply can detect a stale preview.
 *
 * Authority: OWNER only, because the preview drives apply and shows the whole structure of the
 * budget. Non-members get 404, VIEWER/EDITOR 403, a v1 budget 409 MODEL_VERSION_MISMATCH.
 */
@Injectable()
export class TemplatePreviewApplicationService {
  private readonly repository = new TemplatePreviewRepository();
  private readonly access = new BudgetAccessPolicy();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {}

  async preview(userId: string, budgetId: string): Promise<TemplatePreviewBody> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    return this.prisma.$transaction(
      async (tx) => {
        const role = await this.repository.findMemberRole(tx, model.workspaceId, userId);
        if (!role || !this.access.canManageBudgetSettings({ userId, role, isCreator: false })) {
          throw forbidden();
        }
        return (await this.compute(tx, { budgetId, workspaceId: model.workspaceId })).body;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /** Read-only computation; R06 calls it under its own transaction and budget lock. */
  async compute(
    tx: Prisma.TransactionClient,
    params: { budgetId: string; workspaceId: string },
  ): Promise<TemplatePreviewComputation> {
    const { budgetId, workspaceId } = params;
    const settings = await this.repository.cycleSettings(tx, workspaceId, budgetId);
    if (!settings) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        detail: 'Бюджет не найден или недоступен для этого пользователя.',
      });
    }
    const categoryRows = await this.repository.listCategories(tx, budgetId);
    const envelopeRows = await this.repository.listEnvelopes(tx, budgetId);
    const ruleRows = await this.repository.listRules(tx, budgetId);

    const categories: TemplateCategoryPreview[] = V2_TEMPLATE_CATEGORIES.map((definition) => ({
      templateKey: definition.templateKey,
      name: definition.name,
      categoryType: definition.categoryType,
      parentTemplateKey: definition.parentTemplateKey,
      ...matchCategory(definition, categoryRows),
    }));
    const ruleTypeByEnvelope = new Map<string, string>();
    for (const rule of ruleRows) {
      if (!ruleTypeByEnvelope.has(rule.envelopeId))
        ruleTypeByEnvelope.set(rule.envelopeId, rule.type);
    }
    const envelopes: TemplateEnvelopePreview[] = V2_ENVELOPE_TEMPLATES.map((definition) => {
      const match = matchEnvelope(definition, envelopeRows);
      return {
        role: definition.role,
        templateKey: definition.templateKey,
        name: definition.name,
        type: definition.envelopeType,
        periodSlot: definition.periodSlot,
        selectable: definition.selectable,
        suggestedRuleType: definition.suggestedRuleType,
        existingRuleType: match.existingId
          ? (ruleTypeByEnvelope.get(match.existingId) ?? null)
          : null,
        suggestedTargetMinor: null,
        ...match,
      };
    });

    const state: TemplatePreviewState = {
      templateVersion: V2_TEMPLATE_VERSION,
      budgetId,
      cycleStartDay: settings.cycleStartDay,
      periodBoundaryOffset: settings.periodBoundaryOffset,
      categories: categoryRows.map((row) => ({
        id: row.id,
        templateKey: row.templateKey,
        name: row.name,
        categoryType: row.categoryType,
        parentId: row.parentId,
        archived: row.archivedAt !== null,
      })),
      envelopes: envelopeRows.map((row) => ({
        id: row.id,
        templateKey: row.templateKey,
        name: row.name,
        envelopeType: row.envelopeType,
        periodSlot: row.periodSlot,
        archived: row.archivedAt !== null,
      })),
      rules: ruleRows,
    };

    // Complete only when every category and every base (non-savings) envelope already exists.
    const isComplete =
      categories.every((row) => row.status === 'EXISTING') &&
      envelopes.filter((row) => !row.selectable).every((row) => row.status === 'EXISTING');

    return {
      state,
      body: {
        cycle: {
          cycleStartDay: settings.cycleStartDay,
          periodBoundaryOffset: settings.periodBoundaryOffset,
        },
        categories,
        envelopes,
        isComplete,
        previewHash: computeTemplatePreviewHash(state),
      },
    };
  }
}
