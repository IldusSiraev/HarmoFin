import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiAmountHero from './AmountHero.vue';

describe('UiAmountHero', () => {
  it('показывает подпись, сумму, пояснение и слот aside', () => {
    const wrapper = mount(UiAmountHero, {
      props: { label: 'Осталось', amountMinor: '3335000', note: 'до 24 октября' },
      slots: { aside: '<span data-testid="aside">ok</span>' },
    });
    expect(wrapper.text()).toContain('Осталось');
    expect(wrapper.text()).toMatch(/33\s350,00/);
    expect(wrapper.text()).toContain('до 24 октября');
    expect(wrapper.find('[data-testid="aside"]').exists()).toBe(true);
  });
});
