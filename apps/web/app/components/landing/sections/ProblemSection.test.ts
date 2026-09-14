import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ProblemSection from './ProblemSection.vue';

describe('ProblemSection', () => {
  it('frames the problem with the copy from the brief', () => {
    const wrapper = mount(ProblemSection);

    expect(wrapper.get('section').attributes('id')).toBe('problem');
    expect(wrapper.get('h2').text()).toBe(
      'Деньги вроде есть. Но сколько из них действительно можно потратить?',
    );
    expect(wrapper.findAll('h3')).toHaveLength(3);
    expect(wrapper.text()).toContain('На карте 120 000 ₽');
    expect(wrapper.text()).toContain(
      'HarmoFin разделяет деньги не только по счетам, но и по назначению.',
    );
  });
});
