import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AccountRow from './AccountRow.vue';
import type { AccountDto } from '../../composables/useBudgetReferenceData.js';

const account: AccountDto = {
  id: 'account-id',
  budgetId: 'budget-id',
  name: 'Основная карта',
  accountType: 'BANK_CARD',
  bankName: 'Банк',
  lastFourDigits: '1234',
  currency: 'RUB',
  scale: 2,
  startingBalanceMinor: '1000000',
  currentBalanceMinor: '245000',
  accountingStartDate: '2026-09-01',
  comment: null,
  archivedAt: null,
  owner: { userId: 'owner-id', displayName: 'Алия', isActiveMember: true },
  canEdit: true,
};

const mountRow = (
  overrides: Partial<AccountDto> = {},
  props: { showOwner?: boolean; userId?: string | null } = {},
) => mount(AccountRow, { props: { account: { ...account, ...overrides }, ...props } });

const normalize = (value: string): string => value.replace(/[\u00a0\u202f]/g, ' ');

describe('AccountRow', () => {
  it('leads with the name and says what kind of account it is', () => {
    const text = normalize(mountRow().text());

    expect(text).toContain('Основная карта');
    expect(text).toContain('Банковская карта');
    expect(text).toContain('Банк');
    expect(text).toContain('1234');
    expect(text).toContain('2 450,00 ₽');
  });

  it('marks a negative balance in words, not only in colour', () => {
    expect(mountRow().find('[data-testid="account-row-negative"]').exists()).toBe(false);

    const negative = mountRow({ currentBalanceMinor: '-1000' });

    expect(negative.get('[data-testid="account-row-negative"]').text()).toBe('Ниже нуля');
  });

  it('marks an archived account', () => {
    expect(
      mountRow({ archivedAt: '2026-09-10T00:00:00.000Z' })
        .get('[data-testid="account-row-archived"]')
        .text(),
    ).toBe('В архиве');
  });

  it('carries the balance and status in the accessible name, since role=button hides visible content from assistive tech', () => {
    const plainLabel = normalize(
      mountRow().get('[data-testid="account-card-select"]').attributes('aria-label') ?? '',
    );
    expect(plainLabel).toContain('Основная карта');
    expect(plainLabel).toContain('2 450,00 ₽');
    expect(plainLabel).not.toContain('ниже нуля');
    expect(plainLabel).not.toContain('в архиве');

    const negativeLabel = normalize(
      mountRow({ currentBalanceMinor: '-1000' })
        .get('[data-testid="account-card-select"]')
        .attributes('aria-label') ?? '',
    );
    expect(negativeLabel).toContain('-10,00 ₽');
    expect(negativeLabel).toContain('ниже нуля');

    const archivedLabel = normalize(
      mountRow({ archivedAt: '2026-09-10T00:00:00.000Z' })
        .get('[data-testid="account-card-select"]')
        .attributes('aria-label') ?? '',
    );
    expect(archivedLabel).toContain('в архиве');
  });

  it('shows the owner label in the subtitle only with the showOwner prop', () => {
    const cash = { accountType: 'CASH' as const, bankName: null, lastFourDigits: null };

    const plain = mountRow(cash);
    expect(plain.text()).not.toContain('Алия');
    expect(plain.text()).not.toContain('Мой');

    const aliyas = mountRow(cash, { showOwner: true, userId: 'u-me' });
    expect(normalize(aliyas.text())).toContain('Наличные · Алия');

    const mine = mountRow(cash, { showOwner: true, userId: 'owner-id' });
    expect(normalize(mine.text())).toContain('Наличные · Мой');
  });

  it('selects the account when the row is pressed', async () => {
    const wrapper = mountRow();

    await wrapper.get('[data-testid="account-card-select"]').trigger('click');

    expect(wrapper.emitted('select')).toHaveLength(1);
  });
});
