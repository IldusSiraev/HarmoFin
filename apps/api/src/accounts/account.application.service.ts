import { Injectable } from '@nestjs/common';

import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { RolePolicy } from '../common/policies/role-policy.js';
import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import type { ReferenceDataStatus } from '../common/reference-data/reference-data.types.js';
import {
  AccountRepository,
  type AccountCreateData,
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
}

@Injectable()
export class AccountApplicationService {
  constructor(
    private readonly repository: AccountRepository,
    private readonly rolePolicy: RolePolicy,
  ) {}

  async list(
    userId: string,
    budgetId: string,
    status: ReferenceDataStatus,
  ): Promise<AccountView[]> {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    return (await this.repository.list(userId, budgetId, status)).map((account) =>
      this.toView(account),
    );
  }

  async get(userId: string, budgetId: string, accountId: string): Promise<AccountView> {
    const account = await this.repository.find(userId, budgetId, accountId);
    if (!account) throw resourceNotFound();
    return this.toView(account);
  }

  async create(
    userId: string,
    budgetId: string,
    input: CreateAccountInput,
    requestId?: string,
  ): Promise<AccountView> {
    const budget = await this.requireOwnerBudget(userId, budgetId);
    const account = await this.repository.create(
      userId,
      this.createData(budgetId, input, budget.allowNegativeBalance),
      requestId,
    );
    if (!account) throw resourceNotFound();
    return this.toView(account);
  }

  async update(
    userId: string,
    budgetId: string,
    accountId: string,
    input: UpdateAccountInput,
    requestId?: string,
  ): Promise<AccountView> {
    const budget = await this.requireOwnerBudget(userId, budgetId);
    const account = await this.repository.update(
      userId,
      budgetId,
      accountId,
      this.updateData(input, budget.allowNegativeBalance),
      requestId,
    );
    if (!account) throw resourceNotFound();
    return this.toView(account);
  }

  async archive(
    userId: string,
    budgetId: string,
    accountId: string,
    requestId?: string,
  ): Promise<AccountView> {
    await this.requireOwnerBudget(userId, budgetId);
    const account = await this.repository.archive(userId, budgetId, accountId, requestId);
    if (!account) throw resourceNotFound();
    return this.toView(account);
  }

  toView(account: AccountRecord): AccountView {
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
      currentBalanceMinor: startingBalanceMinor,
      accountingStartDate: formatDate(account.accountingStartDate),
      comment: account.comment,
      archivedAt: account.archivedAt?.toISOString() ?? null,
    };
  }

  private async requireOwnerBudget(userId: string, budgetId: string) {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const role = budget.workspace.memberships[0]?.role;
    if (!role || !this.rolePolicy.canManage(role)) throw forbidden();
    return budget;
  }

  private createData(
    budgetId: string,
    input: CreateAccountInput,
    allowNegativeBalance: boolean,
  ): AccountCreateData {
    return {
      budgetId,
      name: input.name,
      accountType: input.accountType,
      bankName: input.bankName ?? null,
      lastFourDigits: input.lastFourDigits ?? null,
      currency: input.currency,
      startingBalanceMinor: parseDecimalToMinorUnits(
        input.startingBalance,
        2,
        allowNegativeBalance,
      ),
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
            startingBalanceMinor: parseDecimalToMinorUnits(
              input.startingBalance,
              2,
              allowNegativeBalance,
            ),
          }
        : {}),
      ...(input.accountingStartDate !== undefined
        ? { accountingStartDate: parseDate(input.accountingStartDate) }
        : {}),
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
    };
  }
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
