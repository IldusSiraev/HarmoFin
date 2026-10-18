import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SecuritySection from './SecuritySection.vue';

describe('SecuritySection', () => {
  it('describes access, isolation and audit guarantees', () => {
    const wrapper = mount(SecuritySection);

    expect(wrapper.get('section').attributes('id')).toBe('security');
    expect(wrapper.get('h2').text()).toBe('Ваши финансовые данные — только ваши.');
    const headings = wrapper.findAll('h3').map((heading) => heading.text());
    expect(headings).toHaveLength(6);
    expect(headings).toEqual(
      expect.arrayContaining([
        'Защищённый доступ',
        'Ваш бюджет — только ваш',
        'История изменений',
        'Без привязки банка',
        'Данные хранятся в России',
        'Выгрузка и удаление',
      ]),
    );
  });

  it('renders an icon for each card', () => {
    const wrapper = mount(SecuritySection);
    const cardIcons = wrapper.findAll('svg');
    expect(cardIcons).toHaveLength(6);
  });
});
