import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AccountTypeIcon from './AccountTypeIcon.vue';
import { accountTone, accountToneColor } from './account-type.js';

describe('AccountTypeIcon', () => {
  it.each([
    ['BANK_ACCOUNT', 'bank'],
    ['BANK_CARD', 'card'],
    ['CASH', 'cash'],
  ] as const)('тип %s получает тон %s', (accountType, tone) => {
    const wrapper = mount(AccountTypeIcon, { props: { accountType } });
    expect(wrapper.classes()).toContain(`account-type-icon--${tone}`);
    expect(wrapper.classes()).toContain('account-type-icon--md');
    expect(wrapper.attributes('aria-hidden')).toBe('true');
    expect(wrapper.find('svg').exists()).toBe(true);
    expect(accountTone(accountType)).toBe(tone);
    expect(accountToneColor(accountType)).toBe(`var(--hf-color-account-${tone})`);
  });

  it('малый размер', () => {
    const wrapper = mount(AccountTypeIcon, { props: { accountType: 'CASH', size: 'sm' } });
    expect(wrapper.classes()).toContain('account-type-icon--sm');
  });
});
