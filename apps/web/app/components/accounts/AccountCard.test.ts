import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AccountCard from './AccountCard.vue';
import EnvelopeCard from '../envelopes/EnvelopeCard.vue';

describe('reference data cards', () => {
  it('renders account server values with localized account type', () => {
    const wrapper = mount(AccountCard, {
      props: {
        account: {
          id: 'account-id',
          budgetId: 'budget-id',
          name: 'Основной счёт',
          accountType: 'BANK_CARD',
          bankName: 'Банк',
          lastFourDigits: '1234',
          currency: 'RUB',
          scale: 2,
          startingBalanceMinor: '10000',
          currentBalanceMinor: '12345',
          accountingStartDate: '2026-09-03',
          comment: null,
          archivedAt: null,
        },
      },
    });

    expect(wrapper.text()).toContain('Банковская карта');
    expect(wrapper.text()).not.toContain('BANK_CARD');
    expect(wrapper.text()).toContain('Активен');
  });

  it('renders envelope server values with localized envelope type', () => {
    const wrapper = mount(EnvelopeCard, {
      props: {
        envelope: {
          id: 'envelope-id',
          budgetId: 'budget-id',
          templateKey: null,
          name: 'Ремонт',
          envelopeType: 'SAVINGS_GOAL',
          periodSlot: null,
          currency: 'RUB',
          scale: 2,
          startingBalanceMinor: '0',
          currentBalanceMinor: '12345',
          monthlyPlannedAmountMinor: null,
          targetAmountMinor: '500000',
          targetDate: '2027-01-01',
          displayOrder: 0,
          comment: null,
          archivedAt: '2026-09-03T00:00:00.000Z',
        },
      },
    });

    expect(wrapper.text()).toContain('Цель накоплений');
    expect(wrapper.text()).not.toContain('SAVINGS_GOAL');
    expect(wrapper.text()).toContain('В архиве');
  });
});
