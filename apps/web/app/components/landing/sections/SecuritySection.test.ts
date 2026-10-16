import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SecuritySection from './SecuritySection.vue';

describe('SecuritySection', () => {
  it('describes access, isolation and audit guarantees', () => {
    const wrapper = mount(SecuritySection);

    expect(wrapper.get('section').attributes('id')).toBe('security');
    expect(wrapper.get('h2').text()).toBe('Ваши финансовые данные — только ваши.');
    expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual([
      'Защищённый доступ',
      'Ваш бюджет — только ваш',
      'История изменений',
    ]);
  });
});
