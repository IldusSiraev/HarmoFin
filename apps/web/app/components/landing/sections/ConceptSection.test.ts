import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ConceptSection from './ConceptSection.vue';

describe('ConceptSection', () => {
  it('separates where money is from what it is meant for', () => {
    const wrapper = mount(ConceptSection);

    expect(wrapper.get('section').attributes('id')).toBe('concept');
    expect(wrapper.get('h2').text()).toBe('Где деньги? И на что они предназначены?');

    const accounts = wrapper.get('[data-testid="concept-accounts"]');
    const envelopes = wrapper.get('[data-testid="concept-envelopes"]');

    expect(accounts.text()).toContain('Где находятся деньги?');
    expect(accounts.text()).toContain('Наличные');
    expect(envelopes.text()).toContain('На что нужны деньги?');
    expect(envelopes.text()).toContain('Свободные');
    expect(wrapper.text()).toContain(
      'Деньги на карте не означают, что все деньги на карте можно потратить.',
    );
  });
});
