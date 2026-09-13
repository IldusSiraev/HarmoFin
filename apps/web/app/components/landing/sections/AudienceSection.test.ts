import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AudienceSection from './AudienceSection.vue';

describe('AudienceSection', () => {
  it('uses the features anchor and lists all three audiences', () => {
    const wrapper = mount(AudienceSection);

    expect(wrapper.get('section').attributes('id')).toBe('features');
    expect(wrapper.get('h2').text()).toBe(
      'HarmoFin подходит тем, кто хочет управлять деньгами осознанно.',
    );
    expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual([
      'Семья',
      'Пара',
      'Один человек',
    ]);
  });

  it('does not promise shared family access in the MVP', () => {
    const wrapper = mount(AudienceSection);

    expect(wrapper.text()).toContain(
      'Сегодня HarmoFin помогает вам управлять собственным бюджетом. В дальнейшем — бюджетом всей семьи.',
    );
  });
});
