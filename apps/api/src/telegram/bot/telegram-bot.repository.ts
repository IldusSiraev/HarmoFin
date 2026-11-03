import type { Prisma, WorkspaceMembershipRole } from '@prisma/client';

import { createUuidV7 } from '../../common/identifiers/uuid-v7.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { Choice, DialogData, DialogKind, DialogStep } from './dialog.types.js';

const LIST_LIMIT = 200;

export type ChatAccess = { userId: string; active: boolean; commandsEnabled: boolean };

export type CurrentBudget = {
  budgetId: string;
  budgetName: string;
  timezone: string;
  role: WorkspaceMembershipRole;
};

export type StoredDialog = {
  id: string;
  chatId: bigint;
  userId: string;
  budgetId: string;
  kind: DialogKind;
  step: DialogStep;
  version: number;
  data: DialogData;
  messageId: number | null;
  expiresAt: Date;
};

type DialogRow = Prisma.TelegramDialogGetPayload<object>;

function toDialog(row: DialogRow): StoredDialog {
  return {
    id: row.id,
    chatId: row.chatId,
    userId: row.userId,
    budgetId: row.budgetId,
    kind: row.kind as DialogKind,
    step: row.step as DialogStep,
    version: row.version,
    data: (row.data ?? {}) as DialogData,
    messageId: row.messageId,
    expiresAt: row.expiresAt,
  };
}

const named = (rows: Array<{ id: string; name: string }>): Choice[] =>
  rows.map((row) => ({ id: row.id, label: row.name }));

/**
 * Data access of the bot: who the chat belongs to, which budget the user works in, the dialog
 * state and the choice lists. Every list query filters by budget_id in the database; ownership,
 * roles and money are re-checked by the application services that save.
 */
export class TelegramBotRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findChat(chatId: bigint): Promise<ChatAccess | null> {
    const link = await this.prisma.telegramLink.findUnique({
      where: { chatId },
      select: { userId: true, commandsEnabledAt: true, user: { select: { status: true } } },
    });
    if (!link) return null;
    return {
      userId: link.userId,
      active: link.user.status === 'ACTIVE',
      commandsEnabled: link.commandsEnabledAt !== null,
    };
  }

  /** Same order as the web: last selected membership first, never-selected by join date. */
  async findCurrentBudget(userId: string): Promise<CurrentBudget | null> {
    const membership = await this.prisma.workspaceMembership.findFirst({
      where: { userId, isActive: true, workspace: { status: 'ACTIVE' } },
      orderBy: [{ lastSelectedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
      select: {
        role: true,
        workspace: {
          select: {
            budgets: {
              where: { status: 'ACTIVE', planModelVersion: 2 },
              orderBy: { createdAt: 'asc' },
              take: 1,
              select: { id: true, name: true, timezone: true },
            },
          },
        },
      },
    });
    const budget = membership?.workspace.budgets[0];
    if (!membership || !budget) return null;
    return {
      budgetId: budget.id,
      budgetName: budget.name,
      timezone: budget.timezone,
      role: membership.role,
    };
  }

  async findDialog(chatId: bigint): Promise<StoredDialog | null> {
    const row = await this.prisma.telegramDialog.findUnique({ where: { chatId } });
    return row ? toDialog(row) : null;
  }

  /** Replaces whatever dialog the chat had with a new one (a new id, so a new idempotency key). */
  startDialog(input: {
    chatId: bigint;
    userId: string;
    budgetId: string;
    kind: DialogKind;
    step: DialogStep;
    version: number;
    data: DialogData;
    expiresAt: Date;
  }): Promise<StoredDialog> {
    return this.prisma.$transaction(async (tx) => {
      await tx.telegramDialog.deleteMany({ where: { chatId: input.chatId } });
      const row = await tx.telegramDialog.create({
        data: {
          id: createUuidV7(),
          chatId: input.chatId,
          userId: input.userId,
          budgetId: input.budgetId,
          kind: input.kind,
          step: input.step,
          version: input.version,
          data: input.data as Prisma.InputJsonValue,
          expiresAt: input.expiresAt,
        },
      });
      return toDialog(row);
    });
  }

  /** Optimistic: saves only over the version the caller read. False when another update won. */
  async saveStep(
    id: string,
    expectedVersion: number,
    values: { step: DialogStep; version: number; data: DialogData; expiresAt: Date },
  ): Promise<boolean> {
    const result = await this.prisma.telegramDialog.updateMany({
      where: { id, version: expectedVersion },
      data: {
        step: values.step,
        version: values.version,
        data: values.data as Prisma.InputJsonValue,
        expiresAt: values.expiresAt,
      },
    });
    return result.count === 1;
  }

  async setMessage(id: string, messageId: number): Promise<void> {
    await this.prisma.telegramDialog.updateMany({ where: { id }, data: { messageId } });
  }

  async deleteDialog(chatId: bigint): Promise<void> {
    await this.prisma.telegramDialog.deleteMany({ where: { chatId } });
  }

  /** Accounts the user may spend from: requireAccountOwner allows only their own. */
  async ownAccounts(budgetId: string, userId: string): Promise<Choice[]> {
    return named(
      await this.prisma.account.findMany({
        where: { budgetId, ownerUserId: userId, archivedAt: null, currency: 'RUB' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: LIST_LIMIT,
        select: { id: true, name: true },
      }),
    );
  }

  async budgetAccounts(budgetId: string): Promise<Choice[]> {
    return named(
      await this.prisma.account.findMany({
        where: { budgetId, archivedAt: null, currency: 'RUB' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: LIST_LIMIT,
        select: { id: true, name: true },
      }),
    );
  }

  async categories(budgetId: string, type: 'INCOME' | 'EXPENSE'): Promise<Choice[]> {
    return named(
      await this.prisma.category.findMany({
        where: { budgetId, categoryType: type, archivedAt: null },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        take: LIST_LIMIT,
        select: { id: true, name: true },
      }),
    );
  }

  /** Mandatory-payment envelopes are paid through their plan in the app, never from the bot. */
  async envelopes(budgetId: string): Promise<Choice[]> {
    return named(
      await this.prisma.envelope.findMany({
        where: {
          budgetId,
          archivedAt: null,
          currency: 'RUB',
          envelopeType: { not: 'MANDATORY_EXPENSES' },
        },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        take: LIST_LIMIT,
        select: { id: true, name: true },
      }),
    );
  }

  /** Names of every account of the budget, archived included: the journal shows old rows too. */
  async accountNames(budgetId: string): Promise<Map<string, string>> {
    const rows = await this.prisma.account.findMany({
      where: { budgetId },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async categoryNames(budgetId: string): Promise<Map<string, string>> {
    const rows = await this.prisma.category.findMany({
      where: { budgetId },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
