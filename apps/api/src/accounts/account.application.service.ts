import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { WorkspaceMembershipRole } from '@prisma/client';

import { FinancialBalanceRepository } from '../common/finance/financial-balance.repository.js';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { personRefOf, type PersonRef } from '../common/people/person-ref.repository.js';
import { requireAccessActor } from '../common/policies/access-actor.repository.js';
import { BudgetAccessPolicy, type AccessActor } from '../common/policies/budget-access.policy.js';
import { resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import type { ReferenceDataStatus } from '../common/reference-data/reference-data.types.js';
import { AssignmentBalanceRepository } from '../envelope-plans/assignment-balance.repository.js';
import {
  AccountRepository,
  type AccountCreateData,
  type AccountMutationGuard,
  type AccountRecord,
  type AccountUpdateData,
} from './account.repository.js';
import type { CreateAccountInput, UpdateAccountInput } from './account.schemas.js';

export interface AccountView {
  id: string;
  budgetId: string;
  name: string;
  accountType: 'BANK_ACCOUNT' | 'BANK_CARD' | 'CASH';
  bankName: string | null;
  lastFourDigits: string | null;
  currency: 'RUB';
  scale: 2;
  startingBalanceMinor: string;
  currentBalanceMinor: string;
  accountingStartDate: string;
  comment: string | null;
  archivedAt: string | null;
  owner: PersonRef;
  canEdit: boolean;
}

type BudgetWithRole = {
  id: string;
  workspaceId: string;
  allowNegativeBalance: boolean;
  planModelVersion: number;
  workspace: { memberships: Array<{ role: WorkspaceMembershipRole }> };
};

export interface AccountSummaryView {
  currency: 'RUB';
  scale: 2;
  totalMinor: string;
  count: number;
}

@Injectable()
export class AccountApplicationService {
  constructor(
    private readonly repository: AccountRepository,
    private readonly access = new BudgetAccessPolicy(),
    private readonly assignments = new AssignmentBalanceRepository(),
    private readonly balances = new FinancialBalanceRepository(),
  ) {}

  async list(
    userId: string,
    budgetId: string,
    status: ReferenceDataStatus,
    ownerUserId?: string,
  ): Promise<AccountView[]> {
    const budget = await this.requireBudget(userId, budgetId);
    const rows = await this.repository.list(userId, budgetId, status, ownerUserId);
    return this.toViews(rows, budget, userId);
  }

  // The total is the sum of the very balances the list hands out, computed by
  // the same repository call inside one transaction: a second SQL formula would
  // drift away from the rows and nobody would notice.
  async summary(
    userId: string,
    budgetId: string,
    status: ReferenceDataStatus,
    ownerUserId?: string,
  ): Promise<AccountSummaryView> {
    await this.requireBudget(userId, budgetId);
    const accounts = await this.repository.list(userId, budgetId, status, ownerUserId);
    const totalMinor = accounts.reduce((sum, account) => sum + account.currentBalanceMinor, 0n);
    return {
      currency: 'RUB',
      scale: 2,
      totalMinor: formatMinorUnits(totalMinor),
      count: accounts.length,
    };
  }

  async get(userId: string, budgetId: string, accountId: string): Promise<AccountView> {
    const budget = await this.requireBudget(userId, budgetId);
    const account = await this.repository.find(userId, budgetId, accountId);
    if (!account) throw resourceNotFound();
    return (await this.toViews([account], budget, userId))[0]!;
  }

  async create(
    userId: string,
    budgetId: string,
    input: CreateAccountInput,
    requestId?: string,
  ): Promise<AccountView> {
    const budget = await this.requireBudget(userId, budgetId);
    const account = await this.repository.create(
      userId,
      this.createData(budgetId, userId, input, budget.allowNegativeBalance),
      requestId,
      this.unbackedGuard(budget),
      async (tx) => {
        this.access.requireWriter(await requireAccessActor(tx, budget.workspaceId, userId));
      },
    );
    if (!account) throw resourceNotFound();
    return (await this.toViews([account], budget, userId))[0]!;
  }

  async update(
    userId: string,
    budgetId: string,
    accountId: string,
    input: UpdateAccountInput,
    requestId?: string,
  ): Promise<AccountView> {
    const budget = await this.requireBudget(userId, budgetId);
    const guard =
      input.startingBalance !== undefined || input.accountingStartDate !== undefined
        ? this.unbackedGuard(budget)
        : undefined;
    const account = await this.repository.update(
      userId,
      budgetId,
      accountId,
      this.updateData(input, budget.allowNegativeBalance),
      requestId,
      guard,
      async (current, tx) => {
        const actor = await requireAccessActor(tx, budget.workspaceId, userId);
        this.access.requireObjectOwner(actor, current);
      },
    );
    if (!account) throw resourceNotFound();
    return (await this.toViews([account], budget, userId))[0]!;
  }

  async archive(
    userId: string,
    budgetId: string,
    accountId: string,
    requestId?: string,
  ): Promise<AccountView> {
    const budget = await this.requireBudget(userId, budgetId);
    const guard: AccountMutationGuard | undefined =
      budget.planModelVersion === 2
        ? {
            before: async (tx) => {
              const balance = await this.balances.accountBalanceAsOf(
                tx,
                budget.id,
                accountId,
                new Date(),
              );
              if (balance !== 0n) {
                throw new ConflictException({
                  code: 'ACCOUNT_HAS_BALANCE',
                  detail: 'Счёт нельзя архивировать: на нём есть остаток.',
                });
              }
            },
          }
        : undefined;
    const account = await this.repository.archive(
      userId,
      budgetId,
      accountId,
      requestId,
      guard,
      async (current, tx) => {
        const actor = await requireAccessActor(tx, budget.workspaceId, userId);
        this.access.requireObjectOwner(actor, current);
      },
    );
    if (!account) throw resourceNotFound();
    return (await this.toViews([account], budget, userId))[0]!;
  }

  async restore(
    userId: string,
    budgetId: string,
    accountId: string,
    requestId?: string,
  ): Promise<AccountView> {
    const budget = await this.requireBudget(userId, budgetId);
    if (budget.planModelVersion !== 2) {
      throw new ConflictException({
        code: 'MODEL_VERSION_MISMATCH',
        detail: 'Восстановление счёта доступно только в модели плана v2.',
      });
    }
    const account = await this.repository.find(userId, budgetId, accountId);
    if (!account) throw resourceNotFound();
    const role = budget.workspace.memberships[0]?.role;
    this.access.requireObjectOwner({ userId, role: role!, isCreator: false }, account);
    if (!account.archivedAt) {
      throw new ConflictException({
        code: 'ACCOUNT_NOT_ARCHIVED',
        detail: 'Счёт не был архивирован, восстановление не требуется.',
      });
    }
    const restored = await this.repository.restore(
      userId,
      budgetId,
      accountId,
      requestId,
      async (current, tx) => {
        const actor = await requireAccessActor(tx, budget.workspaceId, userId);
        this.access.requireObjectOwner(actor, current);
      },
    );
    if (!restored) throw resourceNotFound();
    return (await this.toViews([restored], budget, userId))[0]!;
  }

  toView(account: AccountRecord): Omit<AccountView, 'owner' | 'canEdit'> {
    const startingBalanceMinor = formatMinorUnits(account.startingBalanceMinor);
    return {
      id: account.id,
      budgetId: account.budgetId,
      name: account.name,
      accountType: account.accountType,
      bankName: account.bankName,
      lastFourDigits: account.lastFourDigits,
      currency: 'RUB',
      scale: 2,
      startingBalanceMinor,
      currentBalanceMinor: formatMinorUnits(account.currentBalanceMinor),
      accountingStartDate: formatDate(account.accountingStartDate),
      comment: account.comment,
      archivedAt: account.archivedAt?.toISOString() ?? null,
    };
  }

  private async toViews(
    rows: AccountRecord[],
    budget: BudgetWithRole,
    userId: string,
  ): Promise<AccountView[]> {
    const people = await this.repository.personRefs(
      budget.workspaceId,
      rows.map((row) => row.ownerUserId),
    );
    const role = budget.workspace.memberships[0]?.role;
    const actor: AccessActor | null = role ? { userId, role, isCreator: false } : null;
    return rows.map((row) => ({
      ...this.toView(row),
      owner: personRefOf(people, row.ownerUserId),
      canEdit: actor !== null && this.access.canEditObject(actor, row),
    }));
  }

  // v2 invariant: a mutation must not increase the unbacked part of the
  // assignments (positive balances the budget's accounts cannot cover).
  // The before/after values are read inside the repository transaction under
  // the budget lock, after the candidate change is applied.
  private unbackedGuard(budget: {
    id: string;
    planModelVersion: number;
  }): AccountMutationGuard | undefined {
    if (budget.planModelVersion !== 2) return undefined;
    let supported = 0n;
    let unbackedBefore = 0n;
    return {
      before: async (tx) => {
        for (const row of await this.assignments.allBalances(tx, budget.id, new Date())) {
          supported += row.balance > 0n ? row.balance : 0n;
        }
        const cashBefore = await this.balances.totalCashAsOf(tx, budget.id, new Date());
        unbackedBefore = supported - cashBefore > 0n ? supported - cashBefore : 0n;
      },
      after: async (tx) => {
        const cashAfter = await this.balances.totalCashAsOf(tx, budget.id, new Date());
        const unbackedAfter = supported - cashAfter > 0n ? supported - cashAfter : 0n;
        if (unbackedAfter > unbackedBefore) {
          throw new ConflictException({
            code: 'ASSIGNMENT_UNBACKED',
            detail: 'После изменения на счетах не хватит денег для уже распределённых сумм.',
          });
        }
      },
    };
  }

  private async requireBudget(userId: string, budgetId: string): Promise<BudgetWithRole> {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    return budget;
  }

  private createData(
    budgetId: string,
    ownerUserId: string,
    input: CreateAccountInput,
    allowNegativeBalance: boolean,
  ): AccountCreateData {
    return {
      budgetId,
      ownerUserId,
      name: input.name,
      accountType: input.accountType,
      bankName: input.bankName ?? null,
      lastFourDigits: input.lastFourDigits ?? null,
      currency: input.currency,
      startingBalanceMinor: parseStartingBalance(input.startingBalance, allowNegativeBalance),
      accountingStartDate: parseDate(input.accountingStartDate),
      comment: input.comment ?? null,
    };
  }

  private updateData(input: UpdateAccountInput, allowNegativeBalance: boolean): AccountUpdateData {
    return {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.accountType !== undefined ? { accountType: input.accountType } : {}),
      ...(input.bankName !== undefined ? { bankName: input.bankName } : {}),
      ...(input.lastFourDigits !== undefined ? { lastFourDigits: input.lastFourDigits } : {}),
      ...(input.startingBalance !== undefined
        ? {
            startingBalanceMinor: parseStartingBalance(input.startingBalance, allowNegativeBalance),
          }
        : {}),
      ...(input.accountingStartDate !== undefined
        ? { accountingStartDate: parseDate(input.accountingStartDate) }
        : {}),
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
    };
  }
}

function parseStartingBalance(value: string, allowNegativeBalance: boolean): bigint {
  try {
    return parseDecimalToMinorUnits(value, 2, allowNegativeBalance);
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;

    const response = error.getResponse();
    const detail =
      typeof response === 'object' && response !== null && 'detail' in response
        ? String(response.detail)
        : 'Денежное значение недопустимо.';
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      detail: 'Проверьте денежное значение.',
      fieldErrors: [{ field: 'startingBalance', message: detail, code: 'invalid' }],
    });
  }
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
